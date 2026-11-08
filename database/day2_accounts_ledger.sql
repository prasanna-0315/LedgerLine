-- LedgerLine Day 2: accounts, transactions, ledger entries
-- Run this once on the "ledgerline" database.

USE ledgerline;

-- 1) ACCOUNTS: one row per account. balance is DECIMAL (never FLOAT) for money.
CREATE TABLE accounts (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    owner_id     INT NULL,                       -- NULL only for the system account
    account_name VARCHAR(100) NOT NULL,
    balance      DECIMAL(15,2) NOT NULL DEFAULT 0.00,
    is_system    TINYINT(1) NOT NULL DEFAULT 0,  -- 1 = the bank's EXTERNAL_CASH account
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_accounts_owner FOREIGN KEY (owner_id) REFERENCES users(id),
    -- Safety net: the database itself refuses a negative balance on customer accounts
    CONSTRAINT chk_no_overdraft CHECK (is_system = 1 OR balance >= 0)
) ENGINE=InnoDB;

-- 2) TRANSACTIONS: one row per attempt (COMPLETED or REFUSED).
CREATE TABLE transactions (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    type            ENUM('DEPOSIT','WITHDRAWAL','TRANSFER') NOT NULL,
    status          ENUM('COMPLETED','REFUSED') NOT NULL,
    amount          DECIMAL(15,2) NOT NULL,
    from_account_id INT NOT NULL,                -- money leaves this account (DEBIT)
    to_account_id   INT NOT NULL,                -- money arrives here (CREDIT)
    initiated_by    INT NOT NULL,                -- which user asked for it
    refusal_reason  VARCHAR(255) NULL,
    created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_tx_from FOREIGN KEY (from_account_id) REFERENCES accounts(id),
    CONSTRAINT fk_tx_to   FOREIGN KEY (to_account_id)   REFERENCES accounts(id),
    CONSTRAINT fk_tx_user FOREIGN KEY (initiated_by)    REFERENCES users(id),
    CONSTRAINT chk_tx_amount CHECK (amount > 0)
) ENGINE=InnoDB;

-- 3) LEDGER_ENTRIES: the double-entry ledger. Rows are only ever INSERTED.
CREATE TABLE ledger_entries (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    transaction_id BIGINT NOT NULL,
    account_id     INT NOT NULL,
    entry_type     ENUM('DEBIT','CREDIT') NOT NULL,
    amount         DECIMAL(15,2) NOT NULL,
    balance_after  DECIMAL(15,2) NOT NULL,       -- running balance after this entry
    created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_le_tx      FOREIGN KEY (transaction_id) REFERENCES transactions(id),
    CONSTRAINT fk_le_account FOREIGN KEY (account_id)     REFERENCES accounts(id),
    CONSTRAINT chk_le_amount CHECK (amount > 0),
    INDEX idx_le_account (account_id, id)
) ENGINE=InnoDB;

-- 4) The bank's own cash account. MUST get id = 1 (the code relies on this).
INSERT INTO accounts (id, owner_id, account_name, balance, is_system)
VALUES (1, NULL, 'EXTERNAL_CASH', 0.00, 1);
