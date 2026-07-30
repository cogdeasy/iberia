# VULN-153 — Credentials committed to the repository (`ops/legacy/`)

| Field | Value |
|-------|-------|
| ID | VULN-153 |
| Domain | platform |
| CWE | CWE-798 (Use of Hard-coded Credentials) / CWE-540 (Inclusion of Sensitive Information in Source Code) |
| OWASP Top 10 (2021) | A05:2021 – Security Misconfiguration (A07 for the reused break-glass password) |
| Severity | Critical |
| Location | `ops/legacy/.env.backup:1-29`, `ops/legacy/deploy_notes.md:1-45` |
| Introduced by | Workstream 12 — platform (`devin/iberia-platform`) |

## Description

A "temporary" backup of the production environment file was committed during the 2025-11
migration and never removed. `ops/legacy/.env.backup` contains a full production credential set —
PostgreSQL URL and password, the HS256 JWT signing secret, the payment provider live API key and
webhook secret, inventory feed and SMTP credentials, and the Loki push token. The accompanying
`deploy_notes.md` adds hostnames, the shared deploy SSH user and a break-glass admin login,
turning the leak into a complete attack map.

The JWT secret is the sharpest edge: with it, anyone can mint valid tokens for any user and role
(`app/core/security.py` verifies HS256 with `settings.jwt_secret`), so the leak is a direct
authentication bypass wherever that secret is in use.

All values here are obviously fake demo values — this is a planted finding.

## Reproduction

```bash
# the file is in the repository history and in every clone
git log --oneline -- ops/legacy/.env.backup
sed -n '1,20p' ops/legacy/.env.backup

# forge an admin token from the leaked signing secret and use it against the API
cd backend && .venv/bin/python - <<'PY'
import datetime as dt, jwt
secret = "hs256-iberia-prod-3f9a2b7c41d84e0eb6c5a19d7c2e8f01"   # from ops/legacy/.env.backup
now = dt.datetime.now(dt.timezone.utc)
print(jwt.encode({"sub": "admin@iberia.demo", "role": "admin", "iat": now,
                  "exp": now + dt.timedelta(hours=1)}, secret, algorithm="HS256"))
PY

IBERIA_JWT_SECRET=hs256-iberia-prod-3f9a2b7c41d84e0eb6c5a19d7c2e8f01 \
  .venv/bin/uvicorn app.main:app --port 8000 &
curl -s http://127.0.0.1:8000/api/platform/support/messages \
     -H "Authorization: Bearer <token printed above>"
```

Expected insecure result: the forged token is accepted and returns the whole support inbox; the
same secret works for every authenticated endpoint in the estate.

## Blast radius

Full compromise of the environment those credentials belong to: database read/write (all PNRs,
passengers, payments), token forgery for any role including `admin`, the ability to charge and
refund through the payment provider, to send passenger email/SMS, and to poison observability
data. The credentials are in git history, so every fork, clone and CI cache retains them.

## Intended remediation

1. Rotate **every** credential in the file first — treat all of them as compromised.
2. Delete `ops/legacy/` and purge it from history (`git filter-repo`), then add `*.env.backup`
   to `.gitignore`.
3. Move secrets to a secret manager (Vault / AWS Secrets Manager) injected at runtime; keep only
   `.env.example` with placeholder values in the repo.
4. Add secret scanning (`gitleaks`, `trufflehog`, GitHub push protection) as a pre-commit hook
   and a required CI check.
5. Replace the shared deploy user and break-glass account with per-person SSO and short-lived
   credentials.

## Detection hints

* Grep: `PASSWORD=`, `_SECRET=`, `pk_live_`, `whsec_`, `postgresql://.*:.*@` across the repo.
* `gitleaks detect --no-git` flags both files immediately; the high-entropy hex JWT secret and
  the `pk_live_` prefix match standard rules.
* Files named `.env.backup`, `*.bak`, `deploy_notes.md` in an `ops/legacy/` directory are a
  classic review smell.
