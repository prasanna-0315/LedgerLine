# LedgerLine deployment (Neon + Upstash + Render + Vercel)

Do these in order. **Run migrations and role setup from your own computer** (needs `psql` and Node 20+).
Never commit any URL or password below.

## 0. Local prerequisites
```bash
cd backend && npm install && npx prisma generate
```

## 1. PostgreSQL (Neon)
1. neon.tech -> New project (pick a region near your Render region).
2. Copy the **direct** (non-pooled) connection string of the owner role. Save it as `MIGRATION_DATABASE_URL`.

## 2. Migrations (as owner role)
```bash
cd backend
DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy
DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "<a scratch DB url>" --exit-code   # optional drift check
```
Expect: 2 migrations applied, system account `EXTERNAL_CASH` created.

## 3. Least-privilege roles
```bash
psql "$MIGRATION_DATABASE_URL" -v app_pw="'<strong pw 1>'" -v auditor_pw="'<strong pw 2>'" -v bootstrap_pw="'<strong pw 3>'" -f prisma/sql/roles.sql
```
Build URLs by replacing user/password in the Neon string:
- `DATABASE_URL` = user `ledgerline_app` (used by Render)
- `BOOTSTRAP_DATABASE_URL` = user `ledgerline_bootstrap` (used once, locally)

## 4. First admin (once, locally)
```bash
cd backend
DATABASE_URL="$BOOTSTRAP_DATABASE_URL" ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="<12+ chars>" npm run bootstrap:admin
```
Safe to re-run: it does nothing if an admin exists. The password is never printed.

## 5. Redis (Upstash)
Create a Redis database -> copy the **`rediss://`** URL (TLS) from the Redis connect tab. That is `REDIS_URL`.

## 6. Backend (Render)
New -> Blueprint (uses `render.yaml`) or New Web Service: root dir `backend`, build `npm install && npx prisma generate`, start `node src/server.js`.
Environment variables: `DATABASE_URL` (ledgerline_app), `JWT_SECRET` (>=32 random chars: `openssl rand -hex 48`), `REDIS_URL`, `NODE_ENV=production`, `CORS_ORIGIN` (set after step 7).
Test: `https://<service>.onrender.com/health` -> `{"status":"ok"}` and `/ready` -> `{"ready":true,"database":"up","redis":"up"}`.
(Free Render services sleep; the first request can take ~50 s.)

## 7. Frontend (Vercel)
Import the repo, **Root Directory = `frontend`**, framework Vite. Environment variable `VITE_API_URL` = Render URL (no trailing slash). `vercel.json` already rewrites all routes to `index.html` so page refresh works.

## 8. CORS
Back in Render set `CORS_ORIGIN` = your Vercel URL (e.g. `https://ledgerline.vercel.app`), redeploy.

## 9. Live test checklist
Admin login -> Users: create AUDITOR -> register a customer in a private window -> open account -> deposit -> withdraw too much (refused, shown in statement) -> second customer + transfer -> Audit page shows "Books balanced: YES" -> log in as auditor: no deposit/withdraw links, API returns 403.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Browser CORS error | `CORS_ORIGIN` must exactly equal the Vercel origin (https, no trailing slash); redeploy |
| `/ready` database down | wrong `DATABASE_URL`, or roles.sql not run, or Neon sleeping (retry) |
| `permission denied for table` | run roles.sql after migrations |
| `JWT_SECRET must be set` | set >=32 chars |
| Login works, every call 401 | JWT_SECRET changed after login; log in again |
| Redis `down` in /ready | use the `rediss://` TLS URL; API still works (rate limit fails open) |
| 404 on page refresh | Vercel root dir must be `frontend` (vercel.json) |
