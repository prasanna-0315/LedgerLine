const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
// A real hash to compare against when the email is unknown, so login takes the same time either way.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

exports.register = async (req, res) => {
    try {
        const { name, email, password } = req.body || {};
        if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string'
            || !name.trim() || name.length > 100 || !EMAIL_RE.test(email.trim()) || email.length > 255) {
            return res.status(400).json({ message: 'Valid name, email and password are required' });
        }
        if (password.length < 8 || password.length > 72) {
            return res.status(400).json({ message: 'Password must be 8-72 characters' });
        }
        // The role is NEVER read from the request: public registration is always ACCOUNT_HOLDER.
        const user = await prisma.user.create({
            data: {
                name: name.trim(), email: email.trim().toLowerCase(),
                passwordHash: await bcrypt.hash(password, 12), role: 'ACCOUNT_HOLDER'
            }
        });
        res.status(201).json({ message: 'Registration successful', userId: user.id, role: user.role });
    } catch (error) {
        if (error.code === 'P2002') return res.status(409).json({ message: 'Email already registered' });
        console.error('register error:', error.message);
        res.status(500).json({ message: 'Registration failed' });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }
        const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
        const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
        if (!user || !ok || !user.isActive) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        const token = jwt.sign({ id: user.id, role: user.role, tv: user.tokenVersion },
            process.env.JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
        res.json({ message: 'Login successful', token, user: publicUser(user) });
    } catch (error) {
        console.error('login error:', error.message);
        res.status(500).json({ message: 'Login failed' });
    }
};

// Logout = bump tokenVersion, which invalidates every token issued before.
exports.logout = async (req, res) => {
    await prisma.user.update({ where: { id: req.user.id }, data: { tokenVersion: { increment: 1 } } });
    res.json({ message: 'Logged out' });
};

exports.profile = async (req, res) => {
    const u = await prisma.user.findUnique({ where: { id: req.user.id } });
    res.json({ user: { ...publicUser(u), createdAt: u.createdAt } });
};
