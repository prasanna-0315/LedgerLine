const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

// Verifies the JWT, then re-checks the user in the database on every request, so that
// deactivated users, role changes and logouts (tokenVersion bump) take effect immediately.
exports.verifyToken = async (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Access denied. Token required.' });
    }
    try {
        const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
        const user = await prisma.user.findUnique({ where: { id: Number(decoded.id) } });
        if (!user || !user.isActive || user.tokenVersion !== decoded.tv) {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }
        // Identity and role come from the DATABASE, never from the request body.
        req.user = { id: user.id, role: user.role, name: user.name, email: user.email };
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError' || error.name === 'NotBeforeError') {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }
        console.error('auth error:', error.message);
        return res.status(500).json({ message: 'Authentication failed' });
    }
};

exports.allowRoles = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({ message: 'You do not have permission' });
    }
    next();
};
