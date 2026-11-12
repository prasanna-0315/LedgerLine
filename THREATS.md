# LedgerLine Security Threats

## 1. Unauthorized Access
Risk: Users may access accounts belonging to others.
Mitigation: Server-side authorization.

## 2. Password Exposure
Risk: Passwords may be exposed if stored as plain text.
Mitigation: bcrypt password hashing.

## 3. Token Misuse
Risk: Unauthorized users may attempt to access protected APIs.
Mitigation: JWT verification and expiration.

## 4. Role Manipulation
Risk: Users may attempt to register as administrators.
Mitigation: Public registration always assigns ACCOUNT_HOLDER.

## 5. IDOR (other customers' accounts)
Risk: guessing account IDs. Mitigation: every account/statement/transaction query checks ownership on the server (`loadAccountForUser`, `mustOwnId` inside the money transaction); system account is hidden; list endpoints filter by owner.

## 6. Double-spending / race conditions
Risk: parallel withdrawals overspend. Mitigation: SERIALIZABLE transactions, `SELECT ... FOR UPDATE` on both accounts in id order, retry on 40001/40P01, and a database CHECK (balance >= 0) as last defence.

## 7. Replay and idempotency attacks
Risk: duplicated or altered replays. Mitigation: mandatory `Idempotency-Key`, unique (user, key) row claimed in the same DB transaction as the money movement, stored response replayed, different payload -> 409.

## 8. Ledger tampering
Risk: edited/deleted history. Mitigation: triggers reject UPDATE/DELETE/TRUNCATE for everyone, runtime role has no UPDATE/DELETE grant, deferred trigger enforces debit = credit, corrections are compensating REVERSAL transactions, admin actions are in an append-only audit log.

## 9. SQL injection
Mitigation: Prisma and parameterized tagged-template raw SQL only; no string concatenation of input.

## 10. Rate-limit bypass / brute force
Mitigation: Redis-backed limits on login/register and money routes, shared across instances; fails open if Redis is down (documented trade-off); bcrypt cost 12; uniform login error and timing.

## 11. Account takeover / token misuse
Mitigation: 1-hour HS256 JWT, user re-checked in DB per request, `tokenVersion` bump on logout, role change and deactivation invalidates tokens at once. Residual risk: token in sessionStorage is exposed to XSS (helmet and no HTML injection reduce it).

## 12. Secrets exposure
Mitigation: secrets only in environment variables; `.env` gitignored; logs never print passwords/tokens/URLs; bootstrap never prints the password. Rotate the DB password and JWT secret that were in the original ZIP's `.env`.
