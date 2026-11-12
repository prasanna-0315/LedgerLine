const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const Redis = require('ioredis');

// Shared Redis client (also used by /ready). Null when REDIS_URL is not set.
let redis = null;
if (process.env.REDIS_URL) {
    redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: true,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 1000, 5000)
});
    redis.on('error', (e) => console.error('Redis error:', e.code || e.message)); // never log the URL
} else if (process.env.NODE_ENV === 'production') {
    console.error('WARNING: REDIS_URL not set: rate limiting is per-instance only');
}

// If Redis is down we FAIL OPEN (passOnStoreError): requests are still served, so a Redis outage
// cannot take the bank offline. Money safety never depends on Redis (idempotency lives in PostgreSQL).
function limiter(prefix, windowMs, limit) {
    return rateLimit({
        windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, passOnStoreError: true,
        message: { message: 'Too many requests, please try again later' },
        ...(redis ? { store: new RedisStore({ prefix: `rl:${prefix}:`, sendCommand: (...args) => redis.call(...args) }) } : {})
    });
}

module.exports = {
    redis,
    authLimiter: limiter('auth', 15 * 60 * 1000, 20),   // login/register: 20 per 15 min per IP
    moneyLimiter: limiter('money', 60 * 1000, 30)       // money: 30 per minute per IP
};
