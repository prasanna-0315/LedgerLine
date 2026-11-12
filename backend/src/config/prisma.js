require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

// One shared client for the whole process. DATABASE_URL must use the
// least-privilege runtime role (ledgerline_app), never the owner/migration role.
const prisma = new PrismaClient();

module.exports = prisma;
