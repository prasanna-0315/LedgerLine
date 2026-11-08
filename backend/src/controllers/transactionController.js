const ledger = require('../services/ledgerService');

// Runs a money operation and turns the result (or error) into an HTTP response.
async function respond(res, operation) {
    try {
        const result = await operation();

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
        console.error(error);
        return res.status(500).json({ message: 'Transaction failed' });
    }
}

// POST /api/transactions/deposit      body: { accountId, amount }
exports.deposit = (req, res) =>
    respond(res, () => ledger.deposit(req.user.id, req.body.accountId, req.body.amount));

// POST /api/transactions/withdraw     body: { accountId, amount }
exports.withdraw = (req, res) =>
    respond(res, () => ledger.withdraw(req.user.id, req.body.accountId, req.body.amount));

// POST /api/transactions/transfer     body: { fromAccountId, toAccountId, amount }
exports.transfer = (req, res) =>
    respond(res, () => ledger.transfer(
        req.user.id, req.body.fromAccountId, req.body.toAccountId, req.body.amount));
