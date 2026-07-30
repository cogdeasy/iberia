# VULN-140 — Missing function-level authorisation on the audit trail

| Field | Value |
|-------|-------|
| ID | VULN-140 |
| Domain | security |
| CWE | CWE-285 (Improper Authorization) |
| OWASP Top 10 (2021) | A01:2021 – Broken Access Control |
| Severity | High |
| Location | `backend/app/routers/security.py:28` |
| Status | open |
| Introduced by | Workstream 11 — security console |

## Description

`GET /api/security/audit` is the platform's privileged audit view: it returns every actor
email, source IP, action and request id recorded by the audit middleware. The route is
protected only by `Depends(current_user)` — authentication without authorisation — while
every sibling route in the same router uses `Depends(require_roles("admin", "sre"))`.

Any authenticated principal, including a `customer` account created through public
self-registration, can therefore read the whole trail: other passengers' email addresses and
IPs, agent servicing actions on named PNRs, admin role changes and SRE chaos toggles. Filter
parameters (`actor`, `action`, `outcome`) make targeted reconnaissance trivial, and `limit`
accepts up to 1000 records per call.

## Reproduction

```bash
# log in as the lowest-privilege demo persona
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# read the whole audit trail as a customer
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8000/api/security/audit?limit=1000' | head -c 2000

# targeted: everything the admin has done
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://127.0.0.1:8000/api/security/audit?actor=admin@iberia.demo'
```

Expected insecure result: HTTP 200 with audit records for `admin@iberia.demo`,
`sre@iberia.demo` and other customers, including their IP addresses — a customer token
should get HTTP 403.

## Blast radius

Full read of the audit trail: staff and passenger email addresses, source IPs, PNR
references touched by agents, privileged role changes and SRE actions. Enables user
enumeration, targeted phishing of staff accounts, and reconnaissance of which endpoints are
exercised by admins before a follow-up attack. It also destroys the trail's value as
evidence, since attackers can confirm exactly what was recorded about them.

## Intended remediation

Replace the dependency with the role check already used by the rest of the router:

```python
user: User = Depends(require_roles("admin", "sre"))
```

Then add a regression test asserting `GET /api/security/audit` returns 403 for a `customer`
token, and consider redacting `ip` for non-admin roles.

## Detection hints

* Grep for privileged routes depending on `current_user` where siblings use `require_roles`:
  `rg -n "Depends\(current_user\)" backend/app/routers`.
* Log signature: `audit trail read` entries in the JSON log with `reader_role="customer"`.
* Metric: `iberia_domain_events_total{domain="security",event="audit_read"}` rising from
  non-staff sessions.
