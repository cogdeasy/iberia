# VULN-004 — Missing function-level authorization on user listing

| Field | Value |
|-------|-------|
| ID | VULN-004 |
| Domain | identity |
| CWE | CWE-862 (Missing Authorization) |
| OWASP Top 10 (2021) | A01:2021 – Broken Access Control |
| Severity | High |
| Location | `backend/app/routers/identity.py:213-218` |
| Introduced by | Workstream 1 — Identity (devin/iberia-identity) |

## Description

The API contract marks `GET /api/users` as admin/agent-only, but the handler depends only on
`current_user` (authentication), not on `require_roles("admin", "agent")`. Any authenticated
user — including a plain customer — can list every user account, harvesting emails, roles and
Iberia Plus numbers.

## Reproduction

```bash
# Log in as an ordinary customer.
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# A customer can still dump the entire user directory.
curl -s http://127.0.0.1:8000/api/users -H "Authorization: Bearer $TOKEN"
# -> [ {id,email,role,...}, ... all users ]
```

Expected insecure result: full user directory (emails + roles) exposed to any logged-in user.

## Blast radius

PII disclosure (emails, names, loyalty numbers) for every account; useful reconnaissance for
targeting the other identity vulnerabilities.

## Intended remediation

Guard the endpoint with `Depends(require_roles("admin", "agent"))` (function-level authorization)
so only privileged roles can enumerate users.

## Detection hints

* A `/api/users` list route depending on `current_user` instead of `require_roles(...)`.
* Contract says admin/agent but no role dependency is present.
