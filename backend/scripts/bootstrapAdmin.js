// First-admin bootstrap. Safe to run many times.
//   ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME (optional)  +  DATABASE_URL (use the ledgerline_bootstrap role)
// Creates the admin ONLY if no ADMIN exists yet. Never prints the password.
require('dotenv').config();
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

(async () => {
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';
    if (!email || !email.includes('@') || password.length < 12) {
        console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD (min 12 characters) in the environment.');
        process.exit(1);
    }
    const prisma = new PrismaClient();
    try {
        const existing = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
        if (existing) { console.log('An admin already exists. Nothing to do.'); return; }
        const taken = await prisma.user.findUnique({ where: { email } });
        if (taken) { console.error('That email is already registered as a non-admin; refusing to promote it here.'); process.exit(1); }
        const admin = await prisma.user.create({
            data: { name: process.env.ADMIN_NAME || 'Administrator', email, passwordHash: await bcrypt.hash(password, 12), role: 'ADMIN' }
        });
        await prisma.auditLog.create({ data: { actorId: admin.id, action: 'ADMIN_BOOTSTRAPPED', targetType: 'user', targetId: String(admin.id) } });
        console.log(`Admin created (id ${admin.id}).`);
    } finally {
        await prisma.$disconnect();
    }
})().catch((e) => { console.error('Bootstrap failed:', e.code || e.message); process.exit(1); });
