# LedgerLine (BalanceVault)
*Money Movement with a Ledger You Can Prove.*

Double-entry ledger, idempotent money APIs, overdraft and concurrency protection, append-only audit trail, role-based access (ADMIN / ACCOUNT_HOLDER / AUDITOR).

**Stack:** React + Vite (Vercel) · Node/Express (Render) · PostgreSQL + Prisma (Neon) · Redis rate limiting (Upstash) · Jest + Supertest.

## Layout
`backend/src` (routes, controllers, services/ledgerService.js, middleware) · `backend/prisma` (schema, migrations, sql/roles.sql) · `backend/scripts/bootstrapAdmin.js` · `frontend/src` · `DEPLOYMENT.md` · `THREATS.md` · `PROMPTS.md` · `API.md`

## Accounting model
Every money movement is `DEBIT from-account / CREDIT to-account` of equal amount. Deposits debit the system account `EXTERNAL_CASH`; withdrawals credit it; so all balances sum to exactly 0.00 and money is conserved. The database re-checks debit = credit at COMMIT. Corrections are REVERSAL transactions, never edits.

## Local development
```bash
cp backend/.env.example backend/.env   # fill in; needs local Postgres + Redis (docker run -p 5432:5432 -e POSTGRES_PASSWORD=pw postgres:16 ; docker run -p 6379:6379 redis:7)
cd backend && npm install && npx prisma migrate deploy && npm run dev
cd frontend && cp .env.example .env && npm install && npm run dev
```
Create the first admin: `ADMIN_EMAIL=.. ADMIN_PASSWORD=.. npm run bootstrap:admin` (see DEPLOYMENT.md).

## Status
See the completion report delivered with this project. The test suite from the MySQL version has **not** yet been ported to PostgreSQL.
