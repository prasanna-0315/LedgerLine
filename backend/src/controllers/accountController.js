const pool = require('../config/db');

// Loads an account and checks that this user may see it.
// Returns { account } on success or { status, message } on failure.
async function loadAccountForUser(user, accountId) {
    const [rows] = await pool.query(
        `SELECT id, owner_id, account_name, balance, created_at
           FROM accounts
          WHERE id = ? AND is_system = 0`,
        [accountId]
    );

    if (rows.length === 0) {
        return { status: 404, message: 'Account not found' };
    }

    const account = rows[0];
    const isStaff = user.role === 'ADMIN' || user.role === 'AUDITOR';

    // Account holders may only see their own accounts.
    if (!isStaff && account.owner_id !== user.id) {
        return { status: 403, message: 'You do not have access to this account' };
    }

    return { account };
}

function formatAccount(a) {
    return {
        id: a.id,
        ownerId: a.owner_id,
        accountName: a.account_name,
        balance: a.balance,        // string like "100.00" (DECIMAL stays a string)
        createdAt: a.created_at
    };
}

// POST /api/accounts
exports.createAccount = async (req, res) => {
    try {
        const accountName = req.body.accountName.trim();
        let ownerId = req.user.id;

        // An ADMIN opens accounts on behalf of a customer.
        if (req.user.role === 'ADMIN') {
            if (!req.body.ownerId) {
                return res.status(400).json({ message: 'ownerId is required for admins' });
            }
            const [owners] = await pool.query(
                "SELECT id FROM users WHERE id = ? AND role = 'ACCOUNT_HOLDER'",
                [req.body.ownerId]
            );
            if (owners.length === 0) {
                return res.status(404).json({ message: 'Account holder not found' });
            }
            ownerId = req.body.ownerId;
        }

        const [result] = await pool.query(
            'INSERT INTO accounts (owner_id, account_name) VALUES (?, ?)',
            [ownerId, accountName]
        );

        res.status(201).json({
            message: 'Account created',
            account: { id: result.insertId, ownerId, accountName, balance: '0.00' }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Could not create account' });
    }
};

// GET /api/accounts
exports.listAccounts = async (req, res) => {
    try {
        let rows;

        if (req.user.role === 'ACCOUNT_HOLDER') {
            [rows] = await pool.query(
                `SELECT id, owner_id, account_name, balance, created_at
                   FROM accounts WHERE owner_id = ? AND is_system = 0 ORDER BY id`,
                [req.user.id]
            );
        } else {
            [rows] = await pool.query(
                `SELECT id, owner_id, account_name, balance, created_at
                   FROM accounts WHERE is_system = 0 ORDER BY id`
            );
        }

        res.json({ accounts: rows.map(formatAccount) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Could not load accounts' });
    }
};

// GET /api/accounts/:id   (details + balance)
exports.getAccount = async (req, res) => {
    try {
        const result = await loadAccountForUser(req.user, req.params.id);
        if (!result.account) {
            return res.status(result.status).json({ message: result.message });
        }
        res.json({ account: formatAccount(result.account) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Could not load account' });
    }
};

// GET /api/accounts/:id/statement
// Completed entries (debits and credits, with running balance) + refused attempts.
exports.getStatement = async (req, res) => {
    try {
        const result = await loadAccountForUser(req.user, req.params.id);
        if (!result.account) {
            return res.status(result.status).json({ message: result.message });
        }
        const accountId = result.account.id;

        const [rows] = await pool.query(
            `SELECT le.created_at        AS date,
                    t.id                 AS transactionId,
                    t.type               AS type,
                    t.status             AS status,
                    le.entry_type        AS entryType,
                    le.amount            AS amount,
                    le.balance_after     AS balanceAfter,
                    u.id                 AS initiatedById,
                    u.name               AS initiatedByName,
                    NULL                 AS refusalReason
               FROM ledger_entries le
               JOIN transactions t ON t.id = le.transaction_id
               JOIN users u        ON u.id = t.initiated_by
              WHERE le.account_id = ?

             UNION ALL

             SELECT t.created_at, t.id, t.type, t.status,
                    NULL, t.amount, NULL,
                    u.id, u.name, t.refusal_reason
               FROM transactions t
               JOIN users u ON u.id = t.initiated_by
              WHERE t.status = 'REFUSED' AND t.from_account_id = ?

              ORDER BY date, transactionId`,
            [accountId, accountId]
        );

        res.json({
            account: formatAccount(result.account),
            statement: rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Could not load statement' });
    }
};
