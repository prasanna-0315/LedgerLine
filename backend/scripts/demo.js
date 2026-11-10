// LedgerLine live demo: attacks the RUNNING server with parallel requests.
// Usage (server must be running):  node scripts/demo.js
// Optional: BASE_URL=http://localhost:5000 node scripts/demo.js

const crypto = require('crypto');
const BASE = process.env.BASE_URL || 'http://localhost:5000';

async function call(method, path, token, body, key) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (key) headers['Idempotency-Key'] = key;
    const res = await fetch(BASE + path, {
        method, headers, body: body ? JSON.stringify(body) : undefined
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json, replay: res.headers.get('Idempotent-Replay') };
}

const newKey = () => crypto.randomUUID();

(async () => {
    // A throwaway user, so the demo can be run again and again.
    const email = `demo_${Date.now()}@example.com`;
    await call('POST', '/api/auth/register', null, { name: 'Demo User', email, password: 'Password123' });
    const login = await call('POST', '/api/auth/login', null, { email, password: 'Password123' });
    const token = login.body.token;
    if (!token) { console.log('Login failed:', login); process.exit(1); }

    const acc = await call('POST', '/api/accounts', token, { accountName: 'Demo Account' });
    const id = acc.body.account.id;
    await call('POST', '/api/transactions/deposit', token, { accountId: id, amount: '500.00' }, newKey());
    console.log(`Account ${id} created with balance 500.00\n`);

    // DEMO 1: double spending
    console.log('DEMO 1: 20 withdrawals of 100.00 fired AT THE SAME TIME from a 500.00 balance');
    const results = await Promise.all(Array.from({ length: 20 }, () =>
        call('POST', '/api/transactions/withdraw', token, { accountId: id, amount: '100.00' }, newKey())));
    const done = results.filter(r => r.status === 201).length;
    const refused = results.filter(r => r.status === 422).length;
    const after = await call('GET', `/api/accounts/${id}`, token);
    console.log(`  succeeded: ${done}   refused: ${refused}   other: ${20 - done - refused}`);
    console.log(`  final balance: ${after.body.account.balance}`);
    console.log(done === 5 && after.body.account.balance === '0.00'
        ? '  RESULT: PASS (exactly 5 withdrawals, balance never went negative)\n'
        : '  RESULT: FAIL\n');

    // DEMO 2: the same request sent twice
    console.log('DEMO 2: the same deposit sent 2 times with the same Idempotency-Key');
    const key = newKey();
    const first = await call('POST', '/api/transactions/deposit', token, { accountId: id, amount: '75.00' }, key);
    const second = await call('POST', '/api/transactions/deposit', token, { accountId: id, amount: '75.00' }, key);
    console.log(`  1st: ${first.status} transaction ${first.body.transactionId}`);
    console.log(`  2nd: ${second.status} transaction ${second.body.transactionId} (replay header: ${second.replay})`);
    console.log(first.body.transactionId === second.body.transactionId && second.replay === 'true'
        ? '  RESULT: PASS (same result returned, money moved once)\n'
        : '  RESULT: FAIL\n');

    // DEMO 3: 10 identical requests at once
    console.log('DEMO 3: the same deposit sent 10 times IN PARALLEL with one key');
    const k2 = newKey();
    const par = await Promise.all(Array.from({ length: 10 }, () =>
        call('POST', '/api/transactions/deposit', token, { accountId: id, amount: '10.00' }, k2)));
    const ids = new Set(par.map(r => r.body.transactionId));
    const bal = await call('GET', `/api/accounts/${id}`, token);
    console.log(`  distinct transactions created: ${ids.size}   balance: ${bal.body.account.balance} (expected 85.00)`);
    console.log(ids.size === 1 && bal.body.account.balance === '85.00'
        ? '  RESULT: PASS\n' : '  RESULT: FAIL\n');

    // DEMO 4: key reuse with a different amount
    console.log('DEMO 4: same key, different amount');
    const bad = await call('POST', '/api/transactions/deposit', token, { accountId: id, amount: '76.00' }, key);
    console.log(`  status: ${bad.status} -> ${bad.body.message}`);
    console.log(bad.status === 409 ? '  RESULT: PASS\n' : '  RESULT: FAIL\n');
})();
