# API (all JSON; money endpoints need `Idempotency-Key: <8-64 chars [A-Za-z0-9_-]>`)
Auth header: `Authorization: Bearer <token>`. Amounts are strings/numbers with max 2 decimals.

| Method & URL | Role | Body | Notes |
|---|---|---|---|
| POST /api/auth/register | public | name,email,password(8-72) | always ACCOUNT_HOLDER; 409 duplicate email |
| POST /api/auth/login | public | email,password | returns token (1h) |
| POST /api/auth/logout | any | - | invalidates all issued tokens |
| GET /api/auth/profile | any | - | |
| POST /api/accounts | HOLDER, ADMIN | accountName (+ownerId for admin) | |
| GET /api/accounts | any | - | holders: own only |
| GET /api/accounts/:id | owner/ADMIN/AUDITOR | - | 403 other customers |
| GET /api/accounts/:id/statement | owner/ADMIN/AUDITOR | - | running balance + refused attempts |
| PATCH /api/accounts/:id/status | ADMIN | status ACTIVE/FROZEN/CLOSED | audited |
| POST /api/transactions/deposit | HOLDER | accountId, amount | 201 / 422 refused |
| POST /api/transactions/withdraw | HOLDER | accountId, amount | 422 insufficient funds |
| POST /api/transactions/transfer | HOLDER | fromAccountId,toAccountId,amount | |
| POST /api/transactions/:id/reverse | ADMIN | - | compensating entries; once only |
| GET /api/transactions?limit&offset | any | - | holders: own; staff: all |
| GET/POST /api/admin/users, PATCH /api/admin/users/:id | ADMIN | role/isActive | audited, invalidates tokens |
| GET /api/admin/audit-logs, /api/admin/integrity | ADMIN, AUDITOR | - | read-only |
| GET /health, /ready | public | - | ready: DB must be up; Redis reported |

Errors: 400 validation, 401 auth, 403 forbidden, 404, 409 idempotency conflict, 422 refused, 429 rate limit.
Replays return the original result with header `Idempotent-Replay: true`.
