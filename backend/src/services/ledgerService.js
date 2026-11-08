const pool = require('../config/db');
const { parseAmountToCents, decimalToCents, centsToString } = require('../utils/money');

// Account id 1 is the bank's EXTERNAL_CASH account (created by the SQL file).
// Deposits come FROM it, withdrawals go TO it. This keeps every transaction balanced.
const SYSTEM_ACCOUNT_ID = 1;

// An error that carries the HTTP status code we want to send back.
class LedgerError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

/*
 * moveMoney: the ONE function that changes balances.
 * Deposit, withdrawal and transfer are all "move money from account A to account B".
 *
 *   type      - 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER'
 *   fromId    - account that is debited
 *   toId      - account that is credited
 *   amount    - what the user sent (validated here again)
 *   actorId   - id of the logged-in user
 *   mustOwnId - the customer account the actor must own
 */
async function moveMoney({ type, fromId, toId, amount, actorId, mustOwnId }) {
    const cents = parseAmountToCents(amount);
    if (cents === null) {
        throw new LedgerError(400, 'Invalid amount');
    }
    if (type === 'TRANSFER' && fromId === toId) {
        throw new LedgerError(400, 'Cannot transfer to the same account');
    }

    const amountText = centsToString(cents);
    const connection = await pool.getConnection();

    try {
        // Everything below succeeds together or not at all.
        await connection.beginTransaction();

        // LOCK both accounts, always lowest id first. Two transfers going in
        // opposite directions therefore lock in the same order and cannot deadlock.
        // Anyone else touching these rows must wait until we COMMIT.
        const [rows] = await connection.query(
            `SELECT id, owner_id, balance, is_system
               FROM accounts
              WHERE id IN (?, ?)
              ORDER BY id
              FOR UPDATE`,
            [fromId, toId]
        );

        const from = rows.find(r => r.id === fromId);
        const to = rows.find(r => r.id === toId);

        if (!from || !to) {
            throw new LedgerError(404, 'Account not found');
        }

        // Customers can never use the system account as a transfer target.
        if (type === 'TRANSFER' && (from.is_system || to.is_system)) {
            throw new LedgerError(404, 'Account not found');
        }

        // AUTHORIZATION on the server: the actor must own the customer-side account.
        const ownedAccount = mustOwnId === fromId ? from : to;
        if (ownedAccount.is_system || ownedAccount.owner_id !== actorId) {
            throw new LedgerError(403, 'You do not have access to this account');
        }

        const fromBalance = decimalToCents(from.balance);
        const toBalance = decimalToCents(to.balance);

        // NO OVERDRAFT: refuse if the debited account does not have enough.
        // (The system account is allowed to go negative: it represents "cash in the world".)
        if (!from.is_system && fromBalance < cents) {
            const [refused] = await connection.query(
                `INSERT INTO transactions
                   (type, status, amount, from_account_id, to_account_id, initiated_by, refusal_reason)
                 VALUES (?, 'REFUSED', ?, ?, ?, ?, 'INSUFFICIENT_FUNDS')`,
                [type, amountText, fromId, toId, actorId]
            );
            await connection.commit(); // we keep the record of the refused attempt; no balance changed
            return { status: 'REFUSED', transactionId: refused.insertId };
        }

        const newFromBalance = fromBalance - cents;
        const newToBalance = toBalance + cents;

        const [created] = await connection.query(
            `INSERT INTO transactions
               (type, status, amount, from_account_id, to_account_id, initiated_by)
             VALUES (?, 'COMPLETED', ?, ?, ?, ?)`,
            [type, amountText, fromId, toId, actorId]
        );
        const transactionId = created.insertId;

        await connection.query('UPDATE accounts SET balance = ? WHERE id = ?',
            [centsToString(newFromBalance), fromId]);
        await connection.query('UPDATE accounts SET balance = ? WHERE id = ?',
            [centsToString(newToBalance), toId]);

        // DOUBLE ENTRY: one DEBIT and one CREDIT of the same amount.
        await connection.query(
            `INSERT INTO ledger_entries
               (transaction_id, account_id, entry_type, amount, balance_after)
             VALUES (?, ?, 'DEBIT',  ?, ?),
                    (?, ?, 'CREDIT', ?, ?)`,
            [
                transactionId, fromId, amountText, centsToString(newFromBalance),
                transactionId, toId,   amountText, centsToString(newToBalance)
            ]
        );

        await connection.commit();

        // Only return the balance of the account the actor owns (never the other party's).
        const myNewBalance = mustOwnId === fromId ? newFromBalance : newToBalance;
        return {
            status: 'COMPLETED',
            transactionId,
            balance: centsToString(myNewBalance)
        };

    } catch (error) {
        await connection.rollback(); // undo everything if anything went wrong
        throw error;
    } finally {
        connection.release();
    }
}

exports.LedgerError = LedgerError;

exports.deposit = (actorId, accountId, amount) =>
    moveMoney({ type: 'DEPOSIT', fromId: SYSTEM_ACCOUNT_ID, toId: accountId,
                amount, actorId, mustOwnId: accountId });

exports.withdraw = (actorId, accountId, amount) =>
    moveMoney({ type: 'WITHDRAWAL', fromId: accountId, toId: SYSTEM_ACCOUNT_ID,
                amount, actorId, mustOwnId: accountId });

exports.transfer = (actorId, fromAccountId, toAccountId, amount) =>
    moveMoney({ type: 'TRANSFER', fromId: fromAccountId, toId: toAccountId,
                amount, actorId, mustOwnId: fromAccountId });
