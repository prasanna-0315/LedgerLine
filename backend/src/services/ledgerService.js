const crypto = require('crypto');
const { Prisma } = require('@prisma/client');
const prisma = require('../config/prisma');
const { parseAmountToCents, decimalToCents, centsToString } = require('../utils/money');

class LedgerError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const MAX_ATTEMPTS = 6;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// PostgreSQL asks us to retry when two SERIALIZABLE transactions conflict (40001)
// or when it breaks a deadlock (40P01). Nothing was committed, so retrying is safe.
function isRetryable(error) {
    return error?.code === 'P2034' ||
        ['40001', '40P01'].includes(error?.meta?.code) ||
        /could not serialize|deadlock detected/i.test(error?.message || '');
}

// A fingerprint of WHAT the request asks for. Same key + same fingerprint = same request.
// Amounts are compared in cents, so "100" and "100.00" are equal.
function fingerprint(type, fromId, toId, cents, reverses) {
    return crypto.createHash('sha256')
        .update(`${type}|${fromId}|${toId}|${cents}|${reverses ?? ''}`)
        .digest('hex');
}

async function getSystemAccountId(tx) {
    const rows = await tx.$queryRaw`SELECT id FROM accounts WHERE is_system = true`;
    if (rows.length !== 1) throw new Error('System account missing: run the database migrations');
    return rows[0].id;
}

/*
 * postEntry: the ONE place balances change. Runs inside an already-open transaction.
 * Moves `cents` from account `from` (DEBIT) to account `to` (CREDIT) and writes the
 * transaction row + exactly one DEBIT and one CREDIT ledger entry.
 */
async function postEntry(tx, { type, from, to, cents, actorId, reverses = null }) {
    const amountText = centsToString(cents);
    const fromBalance = decimalToCents(from.balance);
    const toBalance = decimalToCents(to.balance);

    const refuse = async (reason) => {
        const rows = await tx.$queryRaw`
            INSERT INTO transactions (type, status, amount, from_account_id, to_account_id, initiated_by, refusal_reason, reverses_transaction_id)
            VALUES (${type}::"TxType", 'REFUSED', ${amountText}::numeric, ${from.id}, ${to.id}, ${actorId}, ${reason}, ${reverses})
            RETURNING id::text AS id`;
        return { status: 'REFUSED', reason, transactionId: Number(rows[0].id) };
    };

    // Frozen / closed accounts cannot move money.
    if ((!from.is_system && from.status !== 'ACTIVE') || (!to.is_system && to.status !== 'ACTIVE')) {
        return refuse('ACCOUNT_NOT_ACTIVE');
    }
    // NO OVERDRAFT. (The system account is "cash in the world" and may go negative.)
    if (!from.is_system && fromBalance < cents) {
        return refuse('INSUFFICIENT_FUNDS');
    }

    const newFrom = fromBalance - cents;
    const newTo = toBalance + cents;

    const created = await tx.$queryRaw`
        INSERT INTO transactions (type, status, amount, from_account_id, to_account_id, initiated_by, reverses_transaction_id)
        VALUES (${type}::"TxType", 'COMPLETED', ${amountText}::numeric, ${from.id}, ${to.id}, ${actorId}, ${reverses})
        RETURNING id::text AS id`;
    const transactionId = created[0].id; // text -> bound back as bigint below

    await tx.$executeRaw`UPDATE accounts SET balance = ${centsToString(newFrom)}::numeric WHERE id = ${from.id}`;
    await tx.$executeRaw`UPDATE accounts SET balance = ${centsToString(newTo)}::numeric WHERE id = ${to.id}`;

    // DOUBLE ENTRY: one DEBIT and one CREDIT of the same amount (the database re-checks this at COMMIT).
    await tx.$executeRaw`
        INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, balance_after)
        VALUES (${transactionId}::bigint, ${from.id}, 'DEBIT',  ${amountText}::numeric, ${centsToString(newFrom)}::numeric),
               (${transactionId}::bigint, ${to.id},   'CREDIT', ${amountText}::numeric, ${centsToString(newTo)}::numeric)`;

    return {
        status: 'COMPLETED',
        transactionId: Number(transactionId),
        fromBalance: centsToString(newFrom),
        toBalance: centsToString(newTo)
    };
}

/*
 * moveMoney: runs one money operation exactly once, atomically.
 *   mustOwnId - the customer account the actor must own (null for admin reversals)
 */
async function moveMoney({ type, fromId, toId, amount, actorId, mustOwnId, idempotencyKey, reverses = null }) {
    const cents = parseAmountToCents(amount);
    if (cents === null) throw new LedgerError(400, 'Invalid amount');
    if (fromId === toId) throw new LedgerError(400, 'Cannot use the same account on both sides');

    const requestHash = fingerprint(type, fromId, toId, cents, reverses);

    for (let attempt = 1; ; attempt++) {
        try {
            return await prisma.$transaction(
                (tx) => executeOnce(tx, { type, fromId, toId, cents, actorId, mustOwnId, idempotencyKey, requestHash, reverses }),
                { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 }
            );
        } catch (error) {
            if (isRetryable(error) && attempt < MAX_ATTEMPTS) {
                await sleep(15 * 2 ** attempt + Math.random() * 25); // back off, then try again
                continue;
            }
            if (isRetryable(error)) throw new LedgerError(409, 'Conflict, please retry with the same Idempotency-Key');
            throw error;
        }
    }
}

async function executeOnce(tx, { type, fromId, toId, cents, actorId, mustOwnId, idempotencyKey, requestHash, reverses }) {
    // STEP 1: claim the idempotency key. ON CONFLICT DO NOTHING + unique index means only ONE
    // of several parallel identical requests gets the row; the others wait, then see the result.
    const claimed = await tx.$queryRaw`
        INSERT INTO idempotency_keys (user_id, idempotency_key, operation, request_hash)
        VALUES (${actorId}, ${idempotencyKey}, ${type}, ${requestHash})
        ON CONFLICT (user_id, idempotency_key) DO NOTHING
        RETURNING id`;

    if (claimed.length === 0) {
        const existing = await tx.$queryRaw`
            SELECT request_hash, response_json FROM idempotency_keys
             WHERE user_id = ${actorId} AND idempotency_key = ${idempotencyKey}`;
        if (existing.length === 0 || existing[0].response_json === null) {
            throw new LedgerError(409, 'Request is still being processed. Please retry.');
        }
        if (existing[0].request_hash !== requestHash) {
            throw new LedgerError(409, 'Idempotency key was already used with a different request');
        }
        return { ...existing[0].response_json, replayed: true };
    }

    // STEP 2: LOCK both accounts, lowest id first (same order for everyone => no deadlock).
    const rows = await tx.$queryRaw`
        SELECT id, owner_id, balance::text AS balance, is_system, status::text AS status
          FROM accounts
         WHERE id IN (${Prisma.join([fromId, toId])})
         ORDER BY id
         FOR UPDATE`;
    const from = rows.find(r => r.id === fromId);
    const to = rows.find(r => r.id === toId);
    if (!from || !to) throw new LedgerError(404, 'Account not found');

    if (type === 'TRANSFER' && (from.is_system || to.is_system)) {
        throw new LedgerError(404, 'Account not found');
    }

    // STEP 3: AUTHORIZATION on the server: the actor must own the customer-side account.
    if (mustOwnId !== null) {
        const owned = mustOwnId === fromId ? from : to;
        if (owned.is_system || owned.owner_id !== actorId) {
            throw new LedgerError(403, 'You do not have access to this account');
        }
    }

    // STEP 4: move the money, then remember the answer — all in this same transaction.
    const posted = await postEntry(tx, { type, from, to, cents, actorId, reverses });

    const result = { status: posted.status, transactionId: posted.transactionId };
    if (posted.status === 'REFUSED') result.reason = posted.reason;
    if (mustOwnId !== null && posted.status === 'COMPLETED') {
        result.balance = mustOwnId === fromId ? posted.fromBalance : posted.toBalance;
    }

    await tx.$executeRaw`
        UPDATE idempotency_keys SET response_json = ${JSON.stringify(result)}::jsonb
         WHERE user_id = ${actorId} AND idempotency_key = ${idempotencyKey}`;
    return result;
}

exports.LedgerError = LedgerError;

exports.deposit = async (actorId, accountId, amount, idempotencyKey) => {
    const systemId = await prisma.$transaction(getSystemAccountId);
    return moveMoney({ type: 'DEPOSIT', fromId: systemId, toId: accountId, amount, actorId, mustOwnId: accountId, idempotencyKey });
};

exports.withdraw = async (actorId, accountId, amount, idempotencyKey) => {
    const systemId = await prisma.$transaction(getSystemAccountId);
    return moveMoney({ type: 'WITHDRAWAL', fromId: accountId, toId: systemId, amount, actorId, mustOwnId: accountId, idempotencyKey });
};

exports.transfer = (actorId, fromAccountId, toAccountId, amount, idempotencyKey) =>
    moveMoney({ type: 'TRANSFER', fromId: fromAccountId, toId: toAccountId, amount, actorId, mustOwnId: fromAccountId, idempotencyKey });

// ADMIN ONLY (enforced by the route). History is never edited: a mistake is corrected by a NEW
// transaction that moves the money back (compensating entries). A transaction can be reversed once
// (partial unique index one_completed_reversal_per_tx) and a reversal itself cannot be reversed.
exports.reverse = async (adminId, transactionId, idempotencyKey) => {
    const orig = await prisma.$queryRaw`
        SELECT id::text AS id, type::text AS type, status::text AS status, amount::text AS amount,
               from_account_id, to_account_id
          FROM transactions WHERE id = ${transactionId}::bigint`;
    if (orig.length === 0) throw new LedgerError(404, 'Transaction not found');
    const t = orig[0];
    if (t.status !== 'COMPLETED') throw new LedgerError(422, 'Only completed transactions can be reversed');
    if (t.type === 'REVERSAL') throw new LedgerError(422, 'A reversal cannot be reversed');

    try {
        return await moveMoney({
            type: 'REVERSAL', fromId: t.to_account_id, toId: t.from_account_id, amount: t.amount,
            actorId: adminId, mustOwnId: null, idempotencyKey, reverses: BigInt(t.id)
        });
    } catch (error) {
        // Unique index on reverses_transaction_id: someone already reversed it.
        if (error?.code === 'P2010' && error?.meta?.code === '23505' || /one_completed_reversal_per_tx|reverses_transaction_id/.test(error?.message || '')) {
            throw new LedgerError(409, 'Transaction was already reversed');
        }
        throw error;
    }
};

exports._internals = { isRetryable, fingerprint };
