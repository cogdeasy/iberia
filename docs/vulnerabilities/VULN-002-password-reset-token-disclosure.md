# VULN-002 — Password-reset token disclosed in response and logs

| Field | Value |
|-------|-------|
| ID | VULN-002 |
| Domain | identity |
| CWE | CWE-640 (Weak Password Recovery Mechanism), CWE-532 (Insertion of Sensitive Information into Log File) |
| OWASP Top 10 (2021) | A07:2021 – Identification and Authentication Failures |
| Severity | Critical |
| Location | `backend/app/routers/identity.py:128-149` |
| Introduced by | Workstream 1 — Identity (devin/iberia-identity) |

## Description

`POST /api/auth/password-reset` generates a reset token and returns it directly in the JSON
response (`reset_token`) as well as writing it into the application logs. A reset token is a
bearer credential for the account: anyone who can read the HTTP response or the logs can call
`.../password-reset/confirm` and take over the account, completely bypassing email possession.

## Reproduction

```bash
# Request a reset for any known account and read the token straight out of the response.
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/password-reset \
  -H 'Content-Type: application/json' -d '{"email":"customer@iberia.demo"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["reset_token"])')

# Use it to set a new password without ever seeing the victim's inbox.
curl -s -X POST http://127.0.0.1:8000/api/auth/password-reset/confirm \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"new_password\":\"Pwned2026!\"}"
# -> {"status":"reset"}
```

Expected insecure result: full account takeover of any account whose email is known.

## Blast radius

Every account is takeover-able by anyone who can trigger a reset and observe the response body
or the logs (log aggregation, shared dashboards, etc.).

## Intended remediation

Never return the token in the response; deliver it only out-of-band (email) and never log it.
The endpoint should return an opaque `{"status": "sent"}` regardless of whether the email
exists.

## Detection hints

* `reset_token` present in a JSON response schema.
* `log_event(..., reset_token=...)` — secret in a log field.
