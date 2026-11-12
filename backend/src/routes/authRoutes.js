const express = require('express');
const router = express.Router();
const { register, login, logout, profile } = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');
const { authLimiter } = require('../middleware/rateLimit');

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/logout', verifyToken, logout);
router.get('/profile', verifyToken, profile);

module.exports = router;
