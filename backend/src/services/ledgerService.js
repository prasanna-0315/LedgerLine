const crypto = require('crypto');
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

// A fingerprint of WHAT the request asks for. Two requests with the same
// fingerprint are "the same request". Amounts are compared in cents, so
// "100" and "100.00" count as equal.
function fingerprint(type, fromId, toId, cents) {
    return crypto
        .createHash('sha256')
        .update(`${type}|${fromId}|${toId}|${cents}`)
        .digest('hex');
}

/*
 * moveMoney: the ONE function that changes balances.
 * Deposit, withdrawal and transfer are all "move money from account A to account B".
 *
 *   type           - 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER'
 *   fromId         - account that is debited
 *   toId           - account that is credited
 *   amount         - what the user sent (validated here again)
 *   actorId        - id of the logged-in user
 *   mustOwnId      - the customer account the actor must own
 *   idempotencyKey - unique key sent by the client for this request
 */
async function moveMoney({ type, fromId, toId, amount, actorId, mustOwnId, idempotencyKey }) {
    const cents = parseAmountToCents(amount);
    if (cents === null) {
        throw new LedgerError(400, 'Invalid amount');
    }
    if (type === 'TRANSFER' && fromId === toId) {
        throw new LedgerError(400, 'Cannot transfer to the same account');
    }

    const requestHash = fingerprint(type, fromId, toId, cents);

    try {
        return await executeOnce({
            type, fromId, toId, cents, actorId, mustOwnId, idempotencyKey, requestHash
        });

    } catch (error) {
        // The unique (user_id, idempotency_key) index rejected our INSERT:
        // this key was already used. Do NOT move money again.
        if (error.code === 'ER_DUP_ENTRY') {
            return await replayPreviousResult(actorId, idempotencyKey, requestHash);
        }
        throw error;
    }
}

// Duplicate request: look up the original answer and return it.
async function replayPreviousResult(actorId, idempotencyKey, requestHash) {
    // Fresh read (outside the rolled-back transaction) so we see the committed row.
    const [rows] = await pool.query(
        `SELECT request_hash, response_json
           FROM idempotency_keys
          WHERE user_id = ? AND idempotency_key = ?`,
        [actorId, idempotencyKey]
    );

    if (rows.length === 0 || rows[0].response_json === null) {
        throw new LedgerError(409, 'Request is still being processed. Please retry.');
    }

    // Same key but a DIFFERENT request: reject, it is either a bug or an attack.
    if (rows[0].request_hash !== requestHash) {
        throw new LedgerError(409, 'Idempotency key was already used with a different request');
    }

    const original = typeof rows[0].response_json === 'string'
        ? JSON.parse(rows[0].response_json)
        : rows[0].response_json;

    return { ...original, replayed: true };
}

// The real work. Runs inside ONE database transaction.
async function executeOnce({ type, fromId, toId, cents, actorId, mustOwnId, idempotencyKey, requestHash }) {
    const amountText = centsToString(cents);
    const connection = await pool.getConnection();

    try {
        // Everything below succeeds together or not at all.
        await connection.beginTransaction();

        // STEP 1: claim the idempotency key.
        // If the key already exists, MySQL throws ER_DUP_ENTRY and we stop.
        // If another request with the same key is still running, this INSERT
        // WAITS until that request commits, so two parallel copies can never both run.
        await connection.query(
            `INSERT INTO idempotency_keys (user_id, idempotency_key, request_hash)
             VALUES (?, ?, ?)`,
            [actorId, idempotencyKey, requestHash]
        );

        // STEP 2: LOCK both accounts, always lowest id first. Two transfers going in
        // opposite directions therefore lock in the same order and cannot deadlock.
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

            const result = { status: 'REFUSED', transactionId: refused.insertId };
            await saveResponse(connection, actorId, idempotencyKey, result);
            await connection.commit(); // refused attempt is kept; no balance changed
            return result;
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

        // Only return the balance of the account the actor owns (never the other party's).
        const myNewBalance = mustOwnId === fromId ? newFromBalance : newToBalance;
        const result = {
            status: 'COMPLETED',
            transactionId,
            balance: centsToString(myNewBalance)
        };

        // Save the answer in the SAME transaction as the money movement,
        // so "money moved" and "answer remembered" can never get out of sync.
        await saveResponse(connection, actorId, idempotencyKey, result);
        await connection.commit();
        return result;

    } catch (error) {
        await connection.rollback(); // undo everything if anything went wrong
        throw error;
    } finally {
        connection.release();
    }
}

async function saveResponse(connection, actorId, idempotencyKey, result) {
    await connection.query(
        `UPDATE idempotency_keys
            SET response_json = ?
          WHERE user_id = ? AND idempotency_key = ?`,
        [JSON.stringify(result), actorId, idempotencyKey]
    );
}

exports.LedgerError = LedgerError;

exports.deposit = (actorId, accountId, amount, idempotencyKey) =>
    moveMoney({ type: 'DEPOSIT', fromId: SYSTEM_ACCOUNT_ID, toId: accountId,
                amount, actorId, mustOwnId: accountId, idempotencyKey });

exports.withdraw = (actorId, accountId, amount, idempotencyKey) =>
    moveMoney({ type: 'WITHDRAWAL', fromId: accountId, toId: SYSTEM_ACCOUNT_ID,
                amount, actorId, mustOwnId: accountId, idempotencyKey });

exports.transfer = (actorId, fromAccountId, toAccountId, amount, idempotencyKey) =>
    moveMoney({ type: 'TRANSFER', fromId: fromAccountId, toId: toAccountId,
                amount, actorId, mustOwnId: fromAccountId, idempotencyKey });
