-- LedgerLine database roles (least privilege).  Run ONCE per database, AFTER `prisma migrate deploy`,
-- as the owner/admin role that ran the migrations. Passwords come from psql variables, never from this file:
--
--   psql "$MIGRATION_DATABASE_URL" \
--     -v app_pw="'...'" -v auditor_pw="'...'" -v bootstrap_pw="'...'" \
--     -v dbname="neondb" -f prisma/sql/roles.sql
--
-- Roles:
--   ledgerline_app        runtime API. Can INSERT ledger rows; CANNOT update/delete them. Not owner. Not superuser.
--   ledgerline_auditor    read-only; cannot read password hashes.
--   ledgerline_bootstrap  one-time first-admin script: create/read users + write audit log only.
-- The migration/owner role is whatever role you ran `prisma migrate deploy` with.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerline_app')       THEN CREATE ROLE ledgerline_app       LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerline_auditor')   THEN CREATE ROLE ledgerline_auditor   LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledgerline_bootstrap') THEN CREATE ROLE ledgerline_bootstrap LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF;
END $$;

ALTER ROLE ledgerline_app       PASSWORD :app_pw;
ALTER ROLE ledgerline_auditor   PASSWORD :auditor_pw;
ALTER ROLE ledgerline_bootstrap PASSWORD :bootstrap_pw;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC, ledgerline_app, ledgerline_auditor, ledgerline_bootstrap;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, ledgerline_app, ledgerline_auditor, ledgerline_bootstrap;
REVOKE CREATE ON SCHEMA public FROM PUBLIC, ledgerline_app, ledgerline_auditor, ledgerline_bootstrap;
GRANT USAGE ON SCHEMA public TO ledgerline_app, ledgerline_auditor, ledgerline_bootstrap;

-- Runtime app --------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON users, accounts TO ledgerline_app;     -- role/status changes, balance updates
GRANT SELECT, INSERT ON transactions, ledger_entries, audit_logs TO ledgerline_app;   -- NO update/delete
GRANT SELECT, INSERT, UPDATE ON idempotency_keys TO ledgerline_app;    -- response_json is filled after claim
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledgerline_app;
-- (Even the owner is blocked from changing ledger rows by triggers; the missing grants are a second lock.)

-- Auditor (read-only; never password hashes) ---------------------------------
GRANT SELECT (id, name, email, role, is_active, created_at) ON users TO ledgerline_auditor;
GRANT SELECT ON accounts, transactions, ledger_entries, audit_logs TO ledgerline_auditor;

-- Bootstrap (first admin) ---------------------------------------------------
GRANT SELECT, INSERT ON users TO ledgerline_bootstrap;
GRANT SELECT, INSERT ON audit_logs TO ledgerline_bootstrap;
GRANT USAGE, SELECT ON SEQUENCE users_id_seq, audit_logs_id_seq TO ledgerline_bootstrap;

-- Future tables created by the migration role stay locked down until granted explicitly.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
