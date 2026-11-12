// REQUIREMENT: money conservation and double-entry accounting
const { pool, createUser, createAccount, deposit, post, get, balanceOf } = require('./helpers');

afterAll(() => pool.end());

describe('Money conservation and double-entry', () => {
    let alice, bob, a, b;

    beforeAll(async () => {
        alice = await createUser();
        bob = await createUser();
        a = await createAccount(alice, 'Alice Main');
        b = await createAccount(bob, 'Bob Main');
    });

    test('deposit, withdrawal and transfer produce exact balances', async () => {
        const d = await deposit(alice, a, '1000.00');
        expect(d.body.balance).toBe('1000.00');

        const w = await post(alice, '/api/transactions/withdraw', { accountId: a, amount: '200' });
        expect(w.status).toBe(201);
        expect(w.body.balance).toBe('800.00');

        const t = await post(alice, '/api/transactions/transfer',
            { fromAccountId: a, toAccountId: b, amount: '300.10' });
        expect(t.status).toBe(201);
        expect(t.body.balance).toBe('499.90');

        expect(await balanceOf(bob, b)).toBe('300.10');
    });

    test('transfer: what leaves the sender equals what the receiver gets', async () => {
        const before = {
            a: Number((await balanceOf(alice, a)).replace('.', '')),
            b: Number((await balanceOf(bob, b)).replace('.', ''))
        };
        await post(alice, '/api/transactions/transfer', { fromAccountId: a, toAccountId: b, amount: '12.34' });
        const after = {
            a: Number((await balanceOf(alice, a)).replace('.', '')),
            b: Number((await balanceOf(bob, b)).replace('.', ''))
        };
        expect(before.a - after.a).toBe(1234);
        expect(after.b - before.b).toBe(1234);
    });

    test('no floating-point errors: 0.10 + 0.20 is exactly 0.30', async () => {
        const x = await createUser();
        const acc = await createAccount(x);
        await deposit(x, acc, '0.10');
        await deposit(x, acc, '0.20');
        expect(await balanceOf(x, acc)).toBe('0.30');
    });

    test.each(['10.999', '-5', '0', 'abc', '', '1e3', null, true, [5]])(
        'invalid amount %p is rejected with 400',
        async (bad) => {
            const res = await post(alice, '/api/transactions/deposit', { accountId: a, amount: bad });
            expect(res.status).toBe(400);
        }
    );

    test('every transaction has exactly one DEBIT and one CREDIT of equal amount', async () => {
        const [bad] = await pool.query(
            `SELECT transaction_id
               FROM ledger_entries
              GROUP BY transaction_id
             HAVING COUNT(*) <> 2
                 OR SUM(entry_type = 'DEBIT')  <> 1
                 OR SUM(entry_type = 'CREDIT') <> 1
                 OR SUM(CASE WHEN entry_type = 'DEBIT' THEN amount ELSE -amount END) <> 0`
        );
        expect(bad).toEqual([]);
    });

    test('total debits equal total credits across the whole ledger', async () => {
        const [[row]] = await pool.query(
            `SELECT SUM(CASE WHEN entry_type = 'DEBIT'  THEN amount ELSE 0 END) AS debits,
                    SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE 0 END) AS credits
               FROM ledger_entries`
        );
        expect(row.debits).toBe(row.credits);
    });

    test('the sum of ALL account balances is exactly 0.00 (money never created or lost)', async () => {
        const [[row]] = await pool.query('SELECT SUM(balance) AS total FROM accounts');
        expect(row.total).toBe('0.00');
    });

    test('every account balance equals the sum of its ledger entries', async () => {
        const [[row]] = await pool.query(
            `SELECT COUNT(*) AS mismatches
               FROM accounts a
              WHERE a.balance <> COALESCE((
                    SELECT SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END)
                      FROM ledger_entries WHERE account_id = a.id), 0)`
        );
        expect(Number(row.mismatches)).toBe(0);
    });

    test('statement running balance matches a recalculation from the entries', async () => {
        const res = await get(alice, `/api/accounts/${a}/statement`);
        expect(res.status).toBe(200);

        let running = 0;
        for (const row of res.body.statement.filter(r => r.entryType)) {
            const cents = Math.round(parseFloat(row.amount) * 100);
            running += row.entryType === 'CREDIT' ? cents : -cents;
            expect(Math.round(parseFloat(row.balanceAfter) * 100)).toBe(running);
        }
    });

    test('statement shows who initiated each entry', async () => {
        const res = await get(alice, `/api/accounts/${a}/statement`);
        expect(res.body.statement.length).toBeGreaterThan(0);
        for (const row of res.body.statement) {
            expect(row.initiatedById).toBeDefined();
            expect(row.initiatedByName).toBeTruthy();
        }
    });
});
