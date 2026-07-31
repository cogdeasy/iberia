# VULN-161 — Authenticated PII responses are cacheable (no `Cache-Control: no-store`)

| Field | Value |
|-------|-------|
| ID | VULN-161 |
| Domain | platform |
| CWE | CWE-525 (Use of Web Browser Cache Containing Sensitive Information) |
| OWASP Top 10 (2021) | A05:2021 – Security Misconfiguration |
| Severity | Low |
| Location | `backend/app/core/observability.py` (response middleware — no cache headers set) |
| Introduced by | Baseline scaffold |

## Description

No response in the API sets `Cache-Control`, `Pragma` or `Expires`. Authenticated endpoints
that return personal data — bookings with passenger names and passport numbers, boarding
passes, loyalty balances, the user list — are therefore stored by browsers and any
intermediary proxy under default heuristics. On a shared or kiosk machine (a realistic airport
scenario) the data survives sign-out and is recoverable from the browser cache and the
back button.

## Reproduction

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

curl -si http://127.0.0.1:8000/api/booking/bookings -H "authorization: Bearer $TOKEN" | head -20
```

Expected insecure result: the response carries passenger PII and contains no `Cache-Control`
header at all.

## Blast radius

Local disclosure only: it requires access to the client machine or a caching proxy in the
path. Amplifies any of the PII findings (VULN-031, VULN-072) by extending the lifetime of the
data beyond the session.

## Intended remediation

Add `Cache-Control: no-store, private` and `Pragma: no-cache` to every authenticated response
in the shared response middleware, and keep them off only for genuinely public, static
content.

## Detection hints

- Grep for `Cache-Control` under `backend/app/` — no hits today.
- Any authenticated 200 response whose headers lack `Cache-Control` is a positive signal.
