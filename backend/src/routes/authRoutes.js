const express = require('express');

const router = express.Router();

const {
    register,
    login
} = require('../controllers/authController');

const {
    verifyToken,
    allowRoles
} = require('../middleware/authMiddleware');

router.post('/register', register);

router.post('/login', login);

// Protected route
router.get('/profile', verifyToken, (req, res) => {

    res.json({
        message: 'User authenticated successfully',
        user: req.user
    });

});

// Admin-only example route
router.get(
    '/admin',
    verifyToken,
    allowRoles('ADMIN'),
    (req, res) => {
        res.json({
            message: 'Welcome Admin'
        });
    }
);

// Auditor-only example route
router.get(
    '/auditor',
    verifyToken,
    allowRoles('AUDITOR'),
    (req, res) => {
        res.json({
            message: 'Welcome Auditor'
        });
    }
);

module.exports = router;