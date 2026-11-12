# AI usage disclosure

**Tool:** Claude (Anthropic) via claude.ai, used as a coding assistant.

**Human-written (by the project owner, earlier commits):** the original MySQL/Express implementation: auth, accounts, double-entry ledger service, idempotency, concurrency and overdraft logic, and the Jest test suite (commits before `postgres-migration`). Please confirm/edit this line to match what you actually wrote yourself or generated with other tools.

**AI-generated in the PostgreSQL migration (branch `postgres-migration`):**
- Prisma schema, SQL migrations (CHECK constraints, append-only triggers, deferred double-entry trigger, partial unique reversal index), `prisma/sql/roles.sql`
- Port of `ledgerService.js` to Prisma + Serializable transactions with retry; admin reversal
- Port of auth/accounts controllers, admin API, bootstrap script, Redis rate limiting, `/health` and `/ready`
- React/Vite frontend, `render.yaml`, `vercel.json`, `DEPLOYMENT.md`

**Main prompt (summary):** "Inspect my partially complete LedgerLine ZIP, preserve existing logic, migrate to PostgreSQL + Prisma, add Redis rate limiting, onboarding, DB roles, admin bootstrap, React frontend, tests, docs and deployment config; do not claim anything works unless tested."

**Review status:** AI-generated code in the migration has NOT been executed by the assistant (no database/network in its sandbox). The owner must run the migrations and tests and review the code before relying on it.
