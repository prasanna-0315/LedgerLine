const express = require('express');
const { body, header } = require('express-validator');

const router = express.Router();

const { verifyToken, allowRoles } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { parseAmountToCents } = require('../utils/money');
const { deposit, withdraw, transfer, reverse } = require('../controllers/transactionController');
const { listTransactions } = require('../controllers/accountController');
const { moneyLimiter } = require('../middleware/rateLimit');

const amountRule = () =>
    body('amount')
        .custom(value => parseAmountToCents(value) !== null)
        .withMessage('amount must be positive with at most 2 decimal places');

// Every money request must carry a unique key, e.g. a UUID, in the Idempotency-Key header.
const keyRule = () =>
    header('Idempotency-Key')
        .matches(/^[A-Za-z0-9_-]{8,64}$/)
        .withMessage('Idempotency-Key header is required (8-64 letters, digits, - or _)');

const idRule = (field) => body(field).isInt({ min: 1 }).withMessage(`${field} must be a valid id`).toInt();

// Only ACCOUNT_HOLDER may move money. ADMIN and AUDITOR get 403.
router.post('/deposit',  verifyToken, moneyLimiter, allowRoles('ACCOUNT_HOLDER'),
    [keyRule(), idRule('accountId'), amountRule()], validate, deposit);

router.post('/withdraw', verifyToken, moneyLimiter, allowRoles('ACCOUNT_HOLDER'),
    [keyRule(), idRule('accountId'), amountRule()], validate, withdraw);

router.post('/transfer', verifyToken, moneyLimiter, allowRoles('ACCOUNT_HOLDER'),
    [keyRule(), idRule('fromAccountId'), idRule('toAccountId'), amountRule()], validate, transfer);

router.post('/:id/reverse', verifyToken, moneyLimiter, allowRoles('ADMIN'), [keyRule()], validate, reverse);
router.get('/', verifyToken, listTransactions);

module.exports = router;
