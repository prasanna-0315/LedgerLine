const express = require('express');
const { body } = require('express-validator');
const router = express.Router();
const { verifyToken, allowRoles } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const a = require('../controllers/adminController');

router.get('/users', verifyToken, allowRoles('ADMIN'), a.listUsers);
router.post('/users', verifyToken, allowRoles('ADMIN'),
    [body('name').isString().trim().isLength({ min: 1, max: 100 }), body('email').isEmail().isLength({ max: 255 }),
     body('password').isString().isLength({ min: 8, max: 72 }), body('role').isIn(['ADMIN', 'ACCOUNT_HOLDER', 'AUDITOR'])], validate, a.createUser);
router.patch('/users/:id', verifyToken, allowRoles('ADMIN'),
    [body('role').optional().isIn(['ADMIN', 'ACCOUNT_HOLDER', 'AUDITOR']), body('isActive').optional().isBoolean({ strict: true })], validate, a.updateUser);
// Read-only audit views: ADMIN and AUDITOR
router.get('/audit-logs', verifyToken, allowRoles('ADMIN', 'AUDITOR'), a.auditLogs);
router.get('/integrity', verifyToken, allowRoles('ADMIN', 'AUDITOR'), a.integrity);

module.exports = router;
