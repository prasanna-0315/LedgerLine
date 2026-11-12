-- LedgerLine initial schema (PostgreSQL). Matches prisma/schema.prisma.
CREATE TYPE "Role" AS ENUM ('ADMIN', 'ACCOUNT_HOLDER', 'AUDITOR');
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
CREATE TYPE "TxType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'REVERSAL');
CREATE TYPE "TxStatus" AS ENUM ('COMPLETED', 'REFUSED');
CREATE TYPE "EntryType" AS ENUM ('DEBIT', 'CREDIT');

CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(100) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'ACCOUNT_HOLDER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounts" (
    "id" SERIAL NOT NULL,
    "owner_id" INTEGER,
    "account_name" VARCHAR(100) NOT NULL,
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transactions" (
    "id" BIGSERIAL NOT NULL,
    "type" "TxType" NOT NULL,
    "status" "TxStatus" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "from_account_id" INTEGER NOT NULL,
    "to_account_id" INTEGER NOT NULL,
    "initiated_by" INTEGER NOT NULL,
    "refusal_reason" VARCHAR(255),
    "reverses_transaction_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_entries" (
    "id" BIGSERIAL NOT NULL,
    "transaction_id" BIGINT NOT NULL,
    "account_id" INTEGER NOT NULL,
    "entry_type" "EntryType" NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "balance_after" DECIMAL(15,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "idempotency_keys" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(64) NOT NULL,
    "operation" VARCHAR(20) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" INTEGER,
    "action" VARCHAR(60) NOT NULL,
    "target_type" VARCHAR(40) NOT NULL,
    "target_id" VARCHAR(40) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "accounts_owner_id_idx" ON "accounts"("owner_id");
CREATE INDEX "transactions_reverses_transaction_id_idx" ON "transactions"("reverses_transaction_id");
CREATE INDEX "transactions_from_account_id_id_idx" ON "transactions"("from_account_id", "id");
CREATE INDEX "transactions_to_account_id_id_idx" ON "transactions"("to_account_id", "id");
CREATE INDEX "transactions_initiated_by_id_idx" ON "transactions"("initiated_by", "id");
CREATE INDEX "ledger_entries_account_id_id_idx" ON "ledger_entries"("account_id", "id");
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");
CREATE UNIQUE INDEX "uq_user_key" ON "idempotency_keys"("user_id", "idempotency_key");
CREATE INDEX "audit_logs_actor_id_id_idx" ON "audit_logs"("actor_id", "id");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reverses_transaction_id_fkey" FOREIGN KEY ("reverses_transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
