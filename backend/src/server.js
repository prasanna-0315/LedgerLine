require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const prisma = require('./config/prisma');
const { redis } = require('./middleware/rateLimit');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    console.error('FATAL: JWT_SECRET must be set and at least 32 characters');
    if (require.main === module) process.exit(1);
}

const app = express();
app.set('trust proxy', 1); // behind Render's proxy: real client IP for rate limiting
app.use(helmet());

// CORS: only the real frontend origin(s), comma separated in CORS_ORIGIN.
const origins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : false, allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'], exposedHeaders: ['Idempotent-Replay'] }));
app.use(express.json({ limit: '10kb' }));

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/accounts', require('./routes/accountRoutes'));
app.use('/api/transactions', require('./routes/transactionRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

app.get('/', (req, res) => res.json({ message: 'Welcome to LedgerLine API', status: 'Running' }));

// Liveness: the process is up.
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Readiness: PostgreSQL must work; Redis is checked and reported (rate limiting degrades gracefully without it).
app.get('/ready', async (req, res) => {
    const checks = { database: 'down', redis: redis ? 'down' : 'not_configured' };
    try { await prisma.$queryRaw`SELECT 1`; checks.database = 'up'; } catch (e) { /* stays down */ }
    if (redis) { try { checks.redis = (await redis.ping()) === 'PONG' ? 'up' : 'down'; } catch (e) { /* stays down */ } }
    const ready = checks.database === 'up';
    res.status(ready ? 200 : 503).json({ ready, ...checks });
});

app.use((req, res) => res.status(404).json({ message: 'Not found' }));
app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Request too large' });
    console.error('unhandled error:', err.message);
    res.status(500).json({ message: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
if (require.main === module) {
    app.listen(PORT, () => console.log(`LedgerLine running on port ${PORT}`));
}
module.exports = app;
