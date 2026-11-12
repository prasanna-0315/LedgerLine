// REQUIREMENT: idempotency (duplicate requests never execute twice)
const { pool, createUser, createAccount, deposit, post, balanceOf, newKey, countTransactions } = require('./helpers');

afterAll(() => pool.end());

describe('Idempotency', () => {
    let alice, bob, a, b;

    beforeAll(async () => {
        alice = await createUser();
        bob = await createUser();
        a = await createAccount(alice);
        b = await createAccount(bob);
        await deposit(alice, a, '100.00');
    });

    test('a money request without an Idempotency-Key is rejected (400)', async () => {
        const res = await post(alice, '/api/transactions/deposit', { accountId: a, amount: '10' }, null);
        expect(res.status).toBe(400);
    });

    test('a malformed key is rejected (400)', async () => {
        const res = await post(alice, '/api/transactions/deposit', { accountId: a, amount: '10' }, 'short');
        expect(res.status).toBe(400);
    });

    test('a duplicate returns the ORIGINAL result and moves money only once', async () => {
        const key = newKey();
        const before = await countTransactions();

        const first = await post(alice, '/api/transactions/deposit', { accountId: a, amount: '50.00' }, key);
        const second = await post(alice, '/api/transactions/deposit', { accountId: a, amount: '50.00' }, key);
        const third = await post(alice, '/api/transactions/deposit', { accountId: a, amount: '50' }, key);

        expect(first.status).toBe(201);
        expect(first.headers['idempotent-replay']).toBeUndefined();

        for (const dup of [second, third]) {
            expect(dup.status).toBe(201);
            expect(dup.body.transactionId).toBe(first.body.transactionId);
            expect(dup.body.balance).toBe(first.body.balance);
            expect(dup.headers['idempotent-replay']).toBe('true');
        }

        expect(await countTransactions()).toBe(before + 1);
        expect(await balanceOf(alice, a)).toBe('150.00');
    });

    test('same key with a different amount is rejected (409) and changes nothing', async () => {
        const key = newKey();
        await post(alice, '/api/transactions/deposit', { accountId: a, amount: '5.00' }, key);
        const balanceBefore = await balanceOf(alice, a);

        const res = await post(alice, '/api/transactions/deposit', { accountId: a, amount: '6.00' }, key);
        expect(res.status).toBe(409);
        expect(await balanceOf(alice, a)).toBe(balanceBefore);
    });

    test('same key with a different operation is rejected (409)', async () => {
        const key = newKey();
        await post(alice, '/api/transactions/deposit', { accountId: a, amount: '5.00' }, key);
        const res = await post(alice, '/api/transactions/withdraw', { accountId: a, amount: '5.00' }, key);
        expect(res.status).toBe(409);
    });

    test('same key with a different account is rejected (409)', async () => {
        const key = newKey();
        await post(alice, '/api/transactions/transfer', { fromAccountId: a, toAccountId: b, amount: '1' }, key);
        const other = await createAccount(alice, 'Second');
        const res = await post(alice, '/api/transactions/transfer',
            { fromAccountId: a, toAccountId: other, amount: '1' }, key);
        expect(res.status).toBe(409);
    });

    test('keys are per user: another user may use the same key string', async () => {
        const key = newKey();
        const r1 = await post(alice, '/api/transactions/deposit', { accountId: a, amount: '1' }, key);
        const r2 = await post(bob, '/api/transactions/deposit', { accountId: b, amount: '1' }, key);
        expect(r1.status).toBe(201);
        expect(r2.status).toBe(201);
        expect(r2.body.transactionId).not.toBe(r1.body.transactionId);
    });

    test('10 identical requests sent AT THE SAME TIME create exactly one transaction', async () => {
        const key = newKey();
        const before = await countTransactions();
        const balanceBefore = Number((await balanceOf(alice, a)).replace('.', ''));

        const results = await Promise.all(Array.from({ length: 10 }, () =>
            post(alice, '/api/transactions/deposit', { accountId: a, amount: '20.00' }, key)));

        expect(results.every(r => r.status === 201)).toBe(true);
        expect(new Set(results.map(r => r.body.transactionId)).size).toBe(1);
        expect(await countTransactions()).toBe(before + 1);
        expect(Number((await balanceOf(alice, a)).replace('.', ''))).toBe(balanceBefore + 2000);
    });

    test('a refused result is replayed too and stored only once', async () => {
        const key = newKey();
        const before = await countTransactions();
        const r1 = await post(alice, '/api/transactions/withdraw', { accountId: a, amount: '999999' }, key);
        const r2 = await post(alice, '/api/transactions/withdraw', { accountId: a, amount: '999999' }, key);

        expect(r1.status).toBe(422);
        expect(r2.status).toBe(422);
        expect(r2.body.transactionId).toBe(r1.body.transactionId);
        expect(await countTransactions()).toBe(before + 1);
    });

    test('a failed request (403) does not use up the key', async () => {
        const key = newKey();
        const forbidden = await post(bob, '/api/transactions/deposit', { accountId: a, amount: '1' }, key);
        const valid = await post(bob, '/api/transactions/deposit', { accountId: b, amount: '1' }, key);
        expect(forbidden.status).toBe(403);
        expect(valid.status).toBe(201);
    });

    test('the database stores each (user, key) pair only once', async () => {
        const [[row]] = await pool.query(
            `SELECT COUNT(*) AS dups FROM (
                SELECT user_id, idempotency_key FROM idempotency_keys
                 GROUP BY user_id, idempotency_key HAVING COUNT(*) > 1) x`
        );
        expect(Number(row.dups)).toBe(0);
    });
});
