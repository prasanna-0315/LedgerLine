-- LedgerLine Day 3: idempotency table + append-only protection
-- Run once as root on the "ledgerline" database.

USE ledgerline;

-- 1) IDEMPOTENCY_KEYS: remembers every key a user has used, and the answer we gave.
CREATE TABLE idempotency_keys (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    -- utf8mb4_bin = case-sensitive, so "ABC" and "abc" are different keys
    idempotency_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    request_hash    CHAR(64) NOT NULL,      -- fingerprint of the request (type, accounts, amount)
    response_json   JSON NULL,              -- the original result, replayed on duplicates
    created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_idem_user FOREIGN KEY (user_id) REFERENCES users(id),
    -- The database itself guarantees a key can only be stored once per user.
    UNIQUE KEY uq_user_key (user_id, idempotency_key)
) ENGINE=InnoDB;

-- 2) APPEND-ONLY: nobody (not even root) can change or delete history.
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON ledger_entries
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ledger_entries is append-only';

CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON ledger_entries
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ledger_entries is append-only';

CREATE TRIGGER transactions_no_update BEFORE UPDATE ON transactions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'transactions is append-only';

CREATE TRIGGER transactions_no_delete BEFORE DELETE ON transactions
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'transactions is append-only';
