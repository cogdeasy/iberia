# VULN-141 — Log injection and audit forgery via unsanitised actor input

| Field | Value |
|-------|-------|
| ID | VULN-141 |
| Domain | security |
| CWE | CWE-117 (Improper Output Neutralization for Logs) |
| OWASP Top 10 (2021) | A09:2021 – Security Logging and Monitoring Failures |
| Severity | Medium |
| Location | `backend/app/services/audit.py:40`, `backend/app/routers/security.py:63` |
| Status | open |
| Introduced by | Workstream 11 — security console |

## Description

`POST /api/security/audit/events` lets any authenticated caller append an entry to the audit
trail. The `action`, `target` and `outcome` fields are persisted verbatim by `record_audit`
and interpolated straight into the log message:

```python
log_event(logger, logging.INFO, f"audit actor={actor} action={action} target={target} ...")
```

Nothing strips CR/LF or control characters and nothing bounds the field vocabulary, so a
caller can:

1. embed `\n` to emit extra lines into the stdout log stream that a line-oriented shipper
   parses as independent events attributed to a different actor; and
2. write records whose `action`/`outcome` mimic system-generated events
   (`auth.login`, `security.audit.read`, `outcome=success`), so the stored trail and the UI
   show plausible-looking entries that never happened.

The `actor` column is set from the token, but because the forged text can itself contain
`actor=...`, downstream log parsing and the audit table are both poisoned.

## Reproduction

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# forge a log line attributed to the admin, plus a bogus stored record
curl -s -X POST http://127.0.0.1:8000/api/security/audit/events \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"action":"users.role.update\n{\"level\":\"INFO\",\"msg\":\"audit actor=admin@iberia.demo action=users.role.update target=user/9 -> admin outcome=success\"}","target":"user/9 -> admin","outcome":"success"}'

# the forged entry is now in the trail
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8000/api/security/audit?limit=5'
```

Expected insecure result: HTTP 201, the backend stdout contains an extra JSON-looking line
claiming the admin granted a role, and `GET /api/security/audit` returns the forged record
with `outcome=success`.

## Blast radius

Corrupts the integrity of the security console and of any SIEM fed from the JSON logs:
incident timelines can be rewritten, real attacker activity buried under noise, and
innocent staff accounts framed. Unbounded field length also allows cheap log-volume abuse.

## Intended remediation

* Validate `action` against an allow-list (or `^[a-z0-9._-]{1,64}$`) and `outcome` against
  `{"success","failure","denied","accepted"}`; cap `target` length.
* Strip/escape control characters before persisting and logging (`value.replace("\n", "\\n")`
  or `json.dumps` of the whole payload) — never f-string user input into a log message.
* Prefer server-derived actions over a generic client-writable audit endpoint; restrict this
  route to service principals.

## Detection hints

* Grep: `rg -n "f\"audit actor=" backend/app/services/audit.py`, and any `log_event` whose
  message is an f-string over request data.
* SQL: `SELECT * FROM audit_events WHERE action LIKE '%' || char(10) || '%';`
* Test assertion: posting an action containing `\n` should be rejected with 422.
