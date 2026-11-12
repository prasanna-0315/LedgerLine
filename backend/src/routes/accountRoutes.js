const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const { verifyToken, allowRoles } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const c = require('../controllers/accountController');

router.post('/', verifyToken, allowRoles('ACCOUNT_HOLDER', 'ADMIN'),
    [body('accountName').isString().trim().isLength({ min: 1, max: 100 }).withMessage('accountName is required (max 100 characters)'),
     body('ownerId').optional().isInt({ min: 1 }).toInt()], validate, c.createAccount);
router.get('/', verifyToken, c.listAccounts);
router.get('/:id', verifyToken, c.getAccount);
router.get('/:id/statement', verifyToken, c.getStatement);
router.patch('/:id/status', verifyToken, allowRoles('ADMIN'),
    [body('status').isIn(['ACTIVE', 'FROZEN', 'CLOSED'])], validate, c.setStatus);

module.exports = router;
