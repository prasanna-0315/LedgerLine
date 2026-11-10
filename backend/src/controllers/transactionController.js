const ledger = require('../services/ledgerService');

// Runs a money operation and turns the result (or error) into an HTTP response.
async function respond(res, operation) {
    try {
        const result = await operation();

        // If this was a repeated request, tell the client (the money did NOT move again).
        if (result.replayed) {
            res.set('Idempotent-Replay', 'true');
        }

        if (result.status === 'REFUSED') {
            return res.status(422).json({
                message: 'Transaction refused: insufficient funds',
                status: 'REFUSED',
                transactionId: result.transactionId
            });
        }

        return res.status(201).json({
            message: 'Transaction completed',
            status: 'COMPLETED',
            transactionId: result.transactionId,
            balance: result.balance
        });

    } catch (error) {
        if (error instanceof ledger.LedgerError) {
            return res.status(error.status).json({ message: error.message });
        }

        // Two requests blocked each other in MySQL; the client can safely retry.
        if (error.code === 'ER_LOCK_DEADLOCK') {
            return res.status(409).json({ message: 'Conflict, please retry with the same Idempotency-Key' });
        }

        console.error(error);
        return res.status(500).json({ message: 'Transaction failed' });
    }
}

const keyOf = (req) => req.get('Idempotency-Key');

// POST /api/transactions/deposit      body: { accountId, amount }
exports.deposit = (req, res) =>
    respond(res, () => ledger.deposit(
        req.user.id, req.body.accountId, req.body.amount, keyOf(req)));

// POST /api/transactions/withdraw     body: { accountId, amount }
exports.withdraw = (req, res) =>
    respond(res, () => ledger.withdraw(
        req.user.id, req.body.accountId, req.body.amount, keyOf(req)));

// POST /api/transactions/transfer     body: { fromAccountId, toAccountId, amount }
exports.transfer = (req, res) =>
    respond(res, () => ledger.transfer(
        req.user.id, req.body.fromAccountId, req.body.toAccountId, req.body.amount, keyOf(req)));
