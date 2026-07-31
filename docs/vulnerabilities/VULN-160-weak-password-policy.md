# VULN-160 — No password policy on self-service registration

| Field | Value |
|-------|-------|
| ID | VULN-160 |
| Domain | identity |
| CWE | CWE-521 (Weak Password Requirements) |
| OWASP Top 10 (2021) | A07:2021 – Identification and Authentication Failures |
| Severity | Low |
| Location | `backend/app/routers/identity.py:104-120 (register)`, `backend/app/schemas/identity.py:29-32 (RegisterRequest.password)` |
| Introduced by | Baseline scaffold |

## Description

`RegisterRequest.password` is a bare `str` and `register()` hashes whatever arrives with no
length, complexity, breach-list or repetition check. A single character — or the account's own
email address — is an acceptable password. Combined with VULN-001 (no rate limiting on login)
this makes online guessing against self-registered accounts cheap.

## Reproduction

```bash
curl -s -X POST http://127.0.0.1:8000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"weak@iberia.demo","password":"a","full_name":"Weak Password"}'
```

Expected insecure result: `201 Created`. The account then authenticates with
`POST /api/auth/login` using the one-character password.

## Blast radius

Limited to accounts created through self-service registration (role `customer`), but those
accounts hold bookings, passport data and Avios balances, and they are the entry point for
several escalation findings (VULN-003 mass assignment, VULN-004 user listing).

## Intended remediation

Validate the password in `RegisterRequest` (Pydantic `constr(min_length=12)` plus a complexity
or breach-list check), reject passwords equal to the email or full name, and return `422` with
a non-enumerating message. Apply the same rule to the password-reset completion path.

## Detection hints

- Grep for `password: str` in `backend/app/schemas/` with no `Field`/`constr` constraint.
- A registration test that posts `"password": "a"` and asserts `201` is a positive signal.
