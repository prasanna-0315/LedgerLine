// Shared helpers for all test files.
require('dotenv').config();

const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/server');
const pool = require('../src/config/db');

const newKey = () => crypto.randomUUID();

// Creates a brand new user (unique email every run) and logs them in.
// ADMIN / AUDITOR users are promoted directly in the database, because the
// public registration endpoint (correctly) never allows those roles.
async function createUser(role = 'ACCOUNT_HOLDER') {
    const email = `test_${role.toLowerCase()}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}@example.com`;
    const password = 'Password123';

    const reg = await request(app)
        .post('/api/auth/register')
        .send({ name: `Test ${role}`, email, password });
    if (reg.status !== 201) {
        throw new Error('Test setup: register failed ' + JSON.stringify(reg.body));
    }

    if (role !== 'ACCOUNT_HOLDER') {
        await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, reg.body.userId]);
    }

    const login = await request(app).post('/api/auth/login').send({ email, password });
    return { id: login.body.user.id, token: login.body.token, email };
}

const auth = (user) => ({ Authorization: `Bearer ${user.token}` });

// POST helper: money endpoints automatically get a fresh Idempotency-Key.
function post(user, path, body, key = newKey()) {
    const req = request(app).post(path);
    if (user) req.set(auth(user));
    if (path.startsWith('/api/transactions') && key) req.set('Idempotency-Key', key);
    return req.send(body);
}

function get(user, path) {
    const req = request(app).get(path);
    if (user) req.set(auth(user));
    return req;
}

async function createAccount(user, accountName = 'Test Account') {
    const res = await post(user, '/api/accounts', { accountName });
    if (res.status !== 201) throw new Error('Test setup: createAccount failed ' + JSON.stringify(res.body));
    return res.body.account.id;
}

async function deposit(user, accountId, amount) {
    const res = await post(user, '/api/transactions/deposit', { accountId, amount });
    if (res.status !== 201) throw new Error('Test setup: deposit failed ' + JSON.stringify(res.body));
    return res;
}

async function balanceOf(user, accountId) {
    const res = await get(user, `/api/accounts/${accountId}`);
    return res.body.account.balance;
}

async function countTransactions() {
    const [[row]] = await pool.query('SELECT COUNT(*) AS c FROM transactions');
    return Number(row.c);
}

module.exports = {
    app, pool, request, newKey, createUser, auth, post, get,
    createAccount, deposit, balanceOf, countTransactions
};
