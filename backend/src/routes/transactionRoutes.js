const express = require('express');
const { body } = require('express-validator');

const router = express.Router();

const { verifyToken, allowRoles } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { parseAmountToCents } = require('../utils/money');
const { deposit, withdraw, transfer } = require('../controllers/transactionController');

const amountRule = () =>
    body('amount')
        .custom(value => parseAmountToCents(value) !== null)
        .withMessage('amount must be positive with at most 2 decimal places');

const idRule = (field) => body(field).isInt({ min: 1 }).withMessage(`${field} must be a valid id`).toInt();

// Only ACCOUNT_HOLDER may move money. ADMIN and AUDITOR get 403.
router.post('/deposit',  verifyToken, allowRoles('ACCOUNT_HOLDER'),
    [idRule('accountId'), amountRule()], validate, deposit);

router.post('/withdraw', verifyToken, allowRoles('ACCOUNT_HOLDER'),
    [idRule('accountId'), amountRule()], validate, withdraw);

router.post('/transfer', verifyToken, allowRoles('ACCOUNT_HOLDER'),
    [idRule('fromAccountId'), idRule('toAccountId'), amountRule()], validate, transfer);

module.exports = router;
