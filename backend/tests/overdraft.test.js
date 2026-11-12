// REQUIREMENT: overdraft prevention / insufficient balance
const { pool, createUser, createAccount, deposit, post, get, balanceOf } = require('./helpers');

afterAll(() => pool.end());

describe('Overdraft prevention', () => {
    let alice, bob, a, b;

    beforeAll(async () => {
        alice = await createUser();
        bob = await createUser();
        a = await createAccount(alice);
        b = await createAccount(bob);
        await deposit(alice, a, '100.00');
    });

    test('withdrawal above the balance is refused (422) and changes nothing', async () => {
        const res = await post(alice, '/api/transactions/withdraw', { accountId: a, amount: '100.01' });
        expect(res.status).toBe(422);
        expect(res.body.status).toBe('REFUSED');
        expect(await balanceOf(alice, a)).toBe('100.00');
    });

    test('transfer above the balance is refused and neither account changes', async () => {
        const res = await post(alice, '/api/transactions/transfer',
            { fromAccountId: a, toAccountId: b, amount: '500' });
        expect(res.status).toBe(422);
        expect(await balanceOf(alice, a)).toBe('100.00');
        expect(await balanceOf(bob, b)).toBe('0.00');
    });

    test('refused attempts appear in the statement with a reason', async () => {
        const res = await get(alice, `/api/accounts/${a}/statement`);
        const refused = res.body.statement.filter(r => r.status === 'REFUSED');
        expect(refused.length).toBeGreaterThanOrEqual(2);
        expect(refused[0].refusalReason).toBe('INSUFFICIENT_FUNDS');
        expect(refused[0].initiatedByName).toBeTruthy();
    });

    test('refused attempts create NO ledger entries', async () => {
        const [[row]] = await pool.query(
            `SELECT COUNT(*) AS c FROM ledger_entries le
               JOIN transactions t ON t.id = le.transaction_id
              WHERE t.status = 'REFUSED'`
        );
        expect(Number(row.c)).toBe(0);
    });

    test('withdrawing the exact balance is allowed and leaves 0.00', async () => {
        const res = await post(alice, '/api/transactions/withdraw', { accountId: a, amount: '100.00' });
        expect(res.status).toBe(201);
        expect(res.body.balance).toBe('0.00');
    });

    test('withdrawing from an empty account is refused', async () => {
        const res = await post(alice, '/api/transactions/withdraw', { accountId: a, amount: '0.01' });
        expect(res.status).toBe(422);
    });

    test('the DATABASE itself rejects a negative customer balance (last line of defence)', async () => {
        await expect(
            pool.query('UPDATE accounts SET balance = -1.00 WHERE id = ?', [a])
        ).rejects.toThrow();
        expect(await balanceOf(alice, a)).toBe('0.00');
    });
});
