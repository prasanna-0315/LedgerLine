const prisma = require('../config/prisma');

const fmt = (a) => ({
    id: a.id, ownerId: a.ownerId, accountName: a.accountName,
    balance: a.balance.toFixed(2), status: a.status, createdAt: a.createdAt
});

// Loads a customer account and checks that this user may see it (system account is never visible).
async function loadAccountForUser(user, accountId) {
    const account = await prisma.account.findFirst({ where: { id: accountId, isSystem: false } });
    if (!account) return { status: 404, message: 'Account not found' };
    const staff = user.role === 'ADMIN' || user.role === 'AUDITOR';
    if (!staff && account.ownerId !== user.id) return { status: 403, message: 'You do not have access to this account' };
    return { account };
}
const parseId = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null);

exports.createAccount = async (req, res) => {
    try {
        let ownerId = req.user.id;
        if (req.user.role === 'ADMIN') {
            if (!req.body.ownerId) return res.status(400).json({ message: 'ownerId is required for admins' });
            const owner = await prisma.user.findFirst({ where: { id: req.body.ownerId, role: 'ACCOUNT_HOLDER' } });
            if (!owner) return res.status(404).json({ message: 'Account holder not found' });
            ownerId = owner.id;
        }
        const account = await prisma.account.create({ data: { ownerId, accountName: req.body.accountName.trim() } });
        res.status(201).json({ message: 'Account created', account: fmt(account) });
    } catch (e) {
        console.error('createAccount error:', e.message);
        res.status(500).json({ message: 'Could not create account' });
    }
};

exports.listAccounts = async (req, res) => {
    const where = req.user.role === 'ACCOUNT_HOLDER' ? { ownerId: req.user.id, isSystem: false } : { isSystem: false };
    const rows = await prisma.account.findMany({ where, orderBy: { id: 'asc' } });
    res.json({ accounts: rows.map(fmt) });
};

exports.getAccount = async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: 'Invalid account id' });
    const r = await loadAccountForUser(req.user, id);
    if (!r.account) return res.status(r.status).json({ message: r.message });
    res.json({ account: fmt(r.account) });
};

// ADMIN: freeze / unfreeze / close
exports.setStatus = async (req, res) => {
    const id = parseId(req.params.id);
    if (id === null) return res.status(400).json({ message: 'Invalid account id' });
    const acc = await prisma.account.findFirst({ where: { id, isSystem: false } });
    if (!acc) return res.status(404).json({ message: 'Account not found' });
    const [updated] = await prisma.$transaction([
        prisma.account.update({ where: { id }, data: { status: req.body.status } }),
        prisma.auditLog.create({ data: { actorId: req.user.id, action: 'ACCOUNT_STATUS_CHANGED', targetType: 'account', targetId: String(id), metadata: { from: acc.status, to: req.body.status } } })
    ]);
    res.json({ account: fmt(updated) });
};

// Completed entries with running balance + refused attempts.
exports.getStatement = async (req, res) => {
    try {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ message: 'Invalid account id' });
        const r = await loadAccountForUser(req.user, id);
        if (!r.account) return res.status(r.status).json({ message: r.message });

        const rows = await prisma.$queryRaw`
            SELECT * FROM (
              SELECT le.created_at AS "date", t.id::text AS "transactionId", t.type::text AS "type", t.status::text AS "status",
                     le.entry_type::text AS "entryType", le.amount::text AS "amount", le.balance_after::text AS "balanceAfter",
                     u.id AS "initiatedById", u.name AS "initiatedByName", NULL::text AS "refusalReason"
                FROM ledger_entries le
                JOIN transactions t ON t.id = le.transaction_id
                JOIN users u ON u.id = t.initiated_by
               WHERE le.account_id = ${id}
              UNION ALL
              SELECT t.created_at, t.id::text, t.type::text, t.status::text, NULL::text, t.amount::text, NULL::text,
                     u.id, u.name, t.refusal_reason
                FROM transactions t JOIN users u ON u.id = t.initiated_by
               WHERE t.status = 'REFUSED' AND t.from_account_id = ${id}
            ) s ORDER BY "date", "transactionId"::bigint`;
        res.json({ account: fmt(r.account), statement: rows.map(x => ({ ...x, transactionId: Number(x.transactionId) })) });
    } catch (e) {
        console.error('statement error:', e.message);
        res.status(500).json({ message: 'Could not load statement' });
    }
};

// GET /api/transactions : holders see transactions touching their accounts; admin/auditor see all. ?limit=&offset=
exports.listTransactions = async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const own = req.user.role === 'ACCOUNT_HOLDER';
    const rows = await prisma.$queryRaw`
        SELECT t.id::text AS "id", t.type::text AS "type", t.status::text AS "status", t.amount::text AS "amount",
               t.from_account_id AS "fromAccountId", t.to_account_id AS "toAccountId",
               t.initiated_by AS "initiatedBy", t.refusal_reason AS "refusalReason",
               t.reverses_transaction_id::text AS "reversesTransactionId", t.created_at AS "createdAt"
          FROM transactions t
         WHERE (${!own} OR t.initiated_by = ${req.user.id}
                OR EXISTS (SELECT 1 FROM accounts a WHERE a.owner_id = ${req.user.id} AND a.id IN (t.from_account_id, t.to_account_id)))
         ORDER BY t.id DESC LIMIT ${limit} OFFSET ${offset}`;
    res.json({ transactions: rows.map(r => ({ ...r, id: Number(r.id), reversesTransactionId: r.reversesTransactionId && Number(r.reversesTransactionId) })), limit, offset });
};
