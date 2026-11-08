const express = require('express');
const { body } = require('express-validator');

const router = express.Router();

const { verifyToken, allowRoles } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
    createAccount, listAccounts, getAccount, getStatement
} = require('../controllers/accountController');

// Create an account (AUDITOR is read-only, so not allowed)
router.post(
    '/',
    verifyToken,
    allowRoles('ACCOUNT_HOLDER', 'ADMIN'),
    [
        body('accountName').isString().trim().isLength({ min: 1, max: 100 })
            .withMessage('accountName is required (max 100 characters)'),
        body('ownerId').optional().isInt({ min: 1 }).toInt()
    ],
    validate,
    createAccount
);

// Everyone logged in may call these; the controller checks WHICH accounts they may see.
router.get('/', verifyToken, listAccounts);
router.get('/:id', verifyToken, getAccount);
router.get('/:id/statement', verifyToken, getStatement);

module.exports = router;
