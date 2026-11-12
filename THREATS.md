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
