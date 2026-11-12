const prisma = require('../config/prisma');
const bcrypt = require('bcrypt');

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, isActive: u.isActive, createdAt: u.createdAt });
const audit = (actorId, action, targetId, metadata) =>
    prisma.auditLog.create({ data: { actorId, action, targetType: 'user', targetId: String(targetId), metadata } });

exports.listUsers = async (req, res) => {
    const users = await prisma.user.findMany({ orderBy: { id: 'asc' } });
    res.json({ users: users.map(publicUser) });
};

// ADMIN creates a privileged (or normal) user through a controlled, audited process.
exports.createUser = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        const u = await prisma.user.create({ data: { name: name.trim(), email: email.trim().toLowerCase(), passwordHash: await bcrypt.hash(password, 12), role } });
        await audit(req.user.id, 'USER_CREATED', u.id, { role });
        res.status(201).json({ user: publicUser(u) });
    } catch (e) {
        if (e.code === 'P2002') return res.status(409).json({ message: 'Email already registered' });
        console.error('createUser error:', e.message);
        res.status(500).json({ message: 'Could not create user' });
    }
};

exports.updateUser = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ message: 'Invalid user id' });
    if (id === req.user.id) return res.status(400).json({ message: 'Admins cannot change their own role or status' });
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'User not found' });
    const data = {};
    if (req.body.role) data.role = req.body.role;
    if (typeof req.body.isActive === 'boolean') data.isActive = req.body.isActive;
    if (!Object.keys(data).length) return res.status(400).json({ message: 'Nothing to update' });
    data.tokenVersion = { increment: 1 }; // existing tokens stop working immediately
    const u = await prisma.user.update({ where: { id }, data });
    await audit(req.user.id, 'USER_UPDATED', id, { from: { role: existing.role, isActive: existing.isActive }, to: { role: u.role, isActive: u.isActive } });
    res.json({ user: publicUser(u) });
};

exports.auditLogs = async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    const logs = await prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: limit });
    res.json({ logs: logs.map(l => ({ ...l, id: Number(l.id) })) });
};

// System-wide proof of money conservation: all balances must sum to 0.00 and debits == credits.
exports.integrity = async (req, res) => {
    const [r] = await prisma.$queryRaw`
        SELECT (SELECT COALESCE(SUM(balance),0) FROM accounts)::text AS "balanceSum",
               (SELECT COALESCE(SUM(amount),0) FROM ledger_entries WHERE entry_type='DEBIT')::text AS "totalDebits",
               (SELECT COALESCE(SUM(amount),0) FROM ledger_entries WHERE entry_type='CREDIT')::text AS "totalCredits",
               (SELECT COUNT(*) FROM transactions)::int AS "transactions",
               (SELECT COUNT(*) FROM accounts a WHERE a.balance <> COALESCE((SELECT SUM(CASE entry_type WHEN 'CREDIT' THEN amount ELSE -amount END) FROM ledger_entries WHERE account_id=a.id),0))::int AS "mismatchedAccounts"`;
    res.json({ ...r, balanced: r.balanceSum === '0.00' && r.totalDebits === r.totalCredits && r.mismatchedAccounts === 0 });
};
