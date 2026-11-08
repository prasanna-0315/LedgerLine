const { validationResult } = require('express-validator');

// Put this AFTER the express-validator rules on a route.
// If any rule failed, stop here and send a 400 with the reasons.
module.exports = (req, res, next) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({
            message: 'Validation failed',
            errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
        });
    }

    next();
};
