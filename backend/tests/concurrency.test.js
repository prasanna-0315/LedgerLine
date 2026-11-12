// REQUIREMENT: concurrency safety (no double spending)
const { pool, createUser, createAccount, deposit, post, balanceOf } = require('./helpers');

afterAll(() => pool.end());

describe('Concurrency safety', () => {
    test('20 simultaneous withdrawals of 100 from a 500 balance: exactly 5 succeed', async () => {
        const user = await createUser();
        const acc = await createAccount(user);
        await deposit(user, acc, '500.00');

        const results = await Promise.all(Array.from({ length: 20 }, () =>
            post(user, '/api/transactions/withdraw', { accountId: acc, amount: '100.00' })));

        const succeeded = results.filter(r => r.status === 201).length;
        const refused = results.filter(r => r.status === 422).length;

        expect(succeeded).toBe(5);
        expect(refused).toBe(15);
        expect(await balanceOf(user, acc)).toBe('0.00');
    });

    test('parallel transfers to different recipients cannot spend the same money twice', async () => {
        const sender = await createUser();
        const r1 = await createUser();
        const r2 = await createUser();
        const from = await createAccount(sender);
        const to1 = await createAccount(r1);
        const to2 = await createAccount(r2);
        await deposit(sender, from, '100.00');

        const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
            post(sender, '/api/transactions/transfer',
                { fromAccountId: from, toAccountId: i % 2 ? to1 : to2, amount: '30.00' })));

        expect(results.filter(r => r.status === 201).length).toBe(3);
        expect(await balanceOf(sender, from)).toBe('10.00');

        const received =
            Number((await balanceOf(r1, to1)).replace('.', '')) +
            Number((await balanceOf(r2, to2)).replace('.', ''));
        expect(received).toBe(9000);
    });

    test('opposite-direction transfers at the same time do not deadlock and conserve money', async () => {
        const u1 = await createUser();
        const u2 = await createUser();
        const a = await createAccount(u1);
        const b = await createAccount(u2);
        await deposit(u1, a, '1000.00');
        await deposit(u2, b, '1000.00');

        const results = await Promise.all(Array.from({ length: 30 }, (_, i) => i % 2 === 0
            ? post(u1, '/api/transactions/transfer', { fromAccountId: a, toAccountId: b, amount: '10.00' })
            : post(u2, '/api/transactions/transfer', { fromAccountId: b, toAccountId: a, amount: '10.00' })));

        expect(results.every(r => r.status === 201)).toBe(true);
        expect(await balanceOf(u1, a)).toBe('1000.00');
        expect(await balanceOf(u2, b)).toBe('1000.00');
    });

    test('after all the parallel chaos the books still balance', async () => {
        const [[row]] = await pool.query('SELECT SUM(balance) AS total FROM accounts');
        expect(row.total).toBe('0.00');
        const [[neg]] = await pool.query(
            'SELECT COUNT(*) AS c FROM accounts WHERE is_system = 0 AND balance < 0');
        expect(Number(neg.c)).toBe(0);
    });
});
