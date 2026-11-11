// REQUIREMENT: append-only audit ledger
// NOTE: we deliberately do NOT test TRUNCATE here. In MySQL, TRUNCATE ignores triggers and
// would wipe the ledger if this suite is run as a powerful user. It is blocked by privileges instead.
const { pool, createUser, createAccount, deposit } = require('./helpers');

afterAll(() => pool.end());

describe('Append-only ledger', () => {
    let ledgerId, transactionId;

    beforeAll(async () => {
        const user = await createUser();
        const acc = await createAccount(user);
        const res = await deposit(user, acc, '10.00');
        transactionId = res.body.transactionId;
        const [[entry]] = await pool.query(
            'SELECT id FROM ledger_entries WHERE transaction_id = ? LIMIT 1', [transactionId]);
        ledgerId = entry.id;
    });

    const blocked = /append-only|denied/i;

    test('ledger entries cannot be updated', async () => {
        await expect(pool.query('UPDATE ledger_entries SET amount = 999.00 WHERE id = ?', [ledgerId]))
            .rejects.toThrow(blocked);
    });

    test('ledger entries cannot be deleted', async () => {
        await expect(pool.query('DELETE FROM ledger_entries WHERE id = ?', [ledgerId]))
            .rejects.toThrow(blocked);
    });

    test('transactions cannot be updated', async () => {
        await expect(pool.query("UPDATE transactions SET status = 'REFUSED' WHERE id = ?", [transactionId]))
            .rejects.toThrow(blocked);
    });

    test('transactions cannot be deleted', async () => {
        await expect(pool.query('DELETE FROM transactions WHERE id = ?', [transactionId]))
            .rejects.toThrow(blocked);
    });

    test('the history is still intact after the tampering attempts', async () => {
        const [rows] = await pool.query(
            'SELECT amount FROM ledger_entries WHERE transaction_id = ?', [transactionId]);
        expect(rows).toHaveLength(2);
        expect(rows.every(r => r.amount === '10.00')).toBe(true);
    });
});
