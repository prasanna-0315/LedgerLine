-- LedgerLine: integrity constraints, append-only triggers, double-entry enforcement.

-- 1) CHECK constraints (the database refuses bad data even if the app has a bug)
ALTER TABLE "accounts"
  ADD CONSTRAINT chk_no_overdraft CHECK (is_system OR balance >= 0),
  ADD CONSTRAINT chk_system_has_no_owner CHECK ((is_system AND owner_id IS NULL) OR (NOT is_system AND owner_id IS NOT NULL));
ALTER TABLE "transactions"
  ADD CONSTRAINT chk_tx_amount CHECK (amount > 0),
  ADD CONSTRAINT chk_tx_different_accounts CHECK (from_account_id <> to_account_id),
  ADD CONSTRAINT chk_tx_refusal_reason CHECK ((status = 'REFUSED') = (refusal_reason IS NOT NULL)),
  ADD CONSTRAINT chk_tx_reversal_link CHECK ((type = 'REVERSAL') = (reverses_transaction_id IS NOT NULL));
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT chk_le_amount CHECK (amount > 0);

-- Only ONE system (EXTERNAL_CASH) account may ever exist.
CREATE UNIQUE INDEX one_system_account ON "accounts" (is_system) WHERE is_system;

-- A transaction can be successfully reversed only once (refused attempts do not count).
-- NOTE: Prisma cannot express partial indexes; keep this index if you ever run `prisma migrate dev`.
CREATE UNIQUE INDEX one_completed_reversal_per_tx ON "transactions" (reverses_transaction_id)
  WHERE type = 'REVERSAL' AND status = 'COMPLETED';

-- 2) APPEND-ONLY: UPDATE / DELETE / TRUNCATE are rejected for EVERYONE, including the table owner.
CREATE FUNCTION ledgerline_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_update_delete BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledgerline_forbid_change();
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION ledgerline_forbid_change();

CREATE TRIGGER transactions_no_update_delete BEFORE UPDATE OR DELETE ON "transactions"
  FOR EACH ROW EXECUTE FUNCTION ledgerline_forbid_change();
CREATE TRIGGER transactions_no_truncate BEFORE TRUNCATE ON "transactions"
  FOR EACH STATEMENT EXECUTE FUNCTION ledgerline_forbid_change();

CREATE TRIGGER audit_logs_no_update_delete BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION ledgerline_forbid_change();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION ledgerline_forbid_change();

-- 3) DOUBLE ENTRY enforced by the database at COMMIT time:
--    every transaction that has ledger entries must have equal DEBIT and CREDIT totals
--    and at least one of each. A bug that writes half a transaction cannot be committed.
CREATE FUNCTION ledgerline_check_balanced() RETURNS trigger AS $$
DECLARE
  d NUMERIC; c NUMERIC; nd INT; nc INT;
BEGIN
  SELECT COALESCE(SUM(amount) FILTER (WHERE entry_type = 'DEBIT'), 0),
         COALESCE(SUM(amount) FILTER (WHERE entry_type = 'CREDIT'), 0),
         COUNT(*) FILTER (WHERE entry_type = 'DEBIT'),
         COUNT(*) FILTER (WHERE entry_type = 'CREDIT')
    INTO d, c, nd, nc
    FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF d <> c OR nd < 1 OR nc < 1 THEN
    RAISE EXCEPTION 'unbalanced ledger entries for transaction %: debit=% credit=%', NEW.transaction_id, d, c
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entries_must_balance
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledgerline_check_balanced();

-- 4) The bank's cash account (deposits come from it, withdrawals go to it).
INSERT INTO "accounts" (account_name, balance, is_system) VALUES ('EXTERNAL_CASH', 0, true);
