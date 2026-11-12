require('dotenv').config();

const express = require('express');
const cors = require('cors');
const pool = require('./config/db');

// Import authentication routes
const authRoutes = require('./routes/authRoutes');
const accountRoutes = require('./routes/accountRoutes');
const transactionRoutes = require('./routes/transactionRoutes');

const app = express();

app.use(cors());
app.use(express.json());

// Register authentication routes
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/transactions', transactionRoutes);

// Home API
app.get('/', (req, res) => {
    res.json({
        message: 'Welcome to LedgerLine API',
        status: 'Running'
    });
});

// Database health check
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');

        res.json({
            server: 'Running',
            database: 'Connected'
        });

    } catch (error) {
        res.status(500).json({
            message: 'Database connection failed'
        });
    }
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`LedgerLine running on port ${PORT}`);
    });
}

module.exports = app;