# VULN-001 — Account enumeration & missing rate limiting on login

| Field | Value |
|-------|-------|
| ID | VULN-001 |
| Domain | identity |
| CWE | CWE-204 (Observable Response Discrepancy), CWE-307 (Improper Restriction of Excessive Authentication Attempts) |
| OWASP Top 10 (2021) | A07:2021 – Identification and Authentication Failures |
| Severity | Medium |
| Location | `backend/app/routers/identity.py:88-101` |
| Introduced by | Workstream 1 — Identity (devin/iberia-identity) |

## Description

`POST /api/auth/login` returns a distinct **404 "No account registered with that email"** when
the email is unknown, versus **401 "Incorrect password"** when the email exists but the password
is wrong. This response discrepancy lets an attacker enumerate valid accounts. There is also no
rate limiting or lockout, so passwords can be brute-forced without throttling.

## Reproduction

```bash
# Unknown account -> 404 (email does NOT exist)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"ghost@iberia.demo","password":"x"}'
# -> 404

# Known account, wrong password -> 401 (email DOES exist)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"customer@iberia.demo","password":"x"}'
# -> 401

# No throttling: repeat thousands of times with no lockout.
```

Expected insecure result: the attacker learns which emails are registered and can brute-force
passwords indefinitely.

## Blast radius

Any valid account email can be discovered; combined with the lack of throttling this enables
credential-stuffing and brute-force attacks against every user on the platform.

## Intended remediation

Return an identical generic 401 ("Invalid credentials") regardless of whether the email exists,
and add rate limiting / exponential backoff / account lockout on repeated failures (e.g. a
per-IP + per-account counter).

## Detection hints

* Grep for `HTTP_404_NOT_FOUND` in a login handler.
* Two different status codes / messages on the failure path of `login`.
* No limiter/lockout dependency on the login route.
