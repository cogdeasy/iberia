# VULN-100 — Any authenticated customer can declare a disruption and cancel a flight

| Field | Value |
|-------|-------|
| ID | VULN-100 |
| Domain | irregular operations (`irrops`) |
| CWE | CWE-862 (Missing Authorization) |
| OWASP Top 10 (2021) | A01:2021 – Broken Access Control |
| Severity | Critical |
| Location | `backend/app/routers/irrops.py:67-113` (dependency at line 74) |
| Introduced by | Workstream 7 — irregular operations & rebooking |

## Description

`POST /api/irrops/disruptions` is a destructive day-of-operations action: it flips a flight's
status to `delayed` / `cancelled` / `diverted`, extends the scheduled arrival, and records how
many passengers are affected. It is intended for the `ops` and `admin` roles only.

The handler declares its actor dependency as:

```python
user: User = Depends(current_user),      # line 74
```

`current_user` only proves that *some* valid JWT was presented — it performs no role check
(see `app/core/security.py`, where `require_roles(...)` is the function that enforces roles).
Every other privileged action in the estate uses `Depends(require_roles("ops", "admin"))`, so
this endpoint is the odd one out: an ordinary `customer` token, obtained by simply registering
or logging in, is enough to cancel a commercial flight.

There is also no rate limiting and no reason/approval workflow, so the action can be repeated
across the whole schedule in a loop.

## Reproduction

```bash
# 1. Log in as a plain customer (no operations privileges)
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# 2. Confirm the role really is "customer"
curl -s http://127.0.0.1:8000/api/auth/me -H "Authorization: Bearer $TOKEN"

# 3. Cancel flight 4 anyway
curl -s -X POST http://127.0.0.1:8000/api/irrops/disruptions \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"flight_id":4,"kind":"cancellation","reason":"pwned"}' | python3 -m json.tool
```

Expected insecure result: `HTTP 201` with
`{"kind": "cancellation", "flight": {"status": "cancelled", ...}, "affected_passengers": 137}`.
The flight row is now `cancelled` for every consumer of `/api/flights` and the ops board shows
the customer-declared disruption. Looping step 3 over `flight_id` 1..112 grounds the entire
seeded schedule.

## Blast radius

* Full write access to flight operational status for any authenticated user, including
  self-registered accounts.
* Denial of service against the commercial schedule: cancelled flights are excluded from
  search and rebooking, and `seats_available` is forced to 0.
* Downstream contamination: passenger notifications, EU261 compensation liability
  (`GET /api/irrops/compensation/{pnr}` starts returning payable €250–€600 claims) and
  rebooking flows all act on the attacker-controlled status.
* Integrity of the audit trail: `declared_by` records the attacker's e-mail, but nothing
  prevents or flags the action at the time.

## Intended remediation

Enforce function-level authorisation with the shared dependency:

```diff
-    user: User = Depends(current_user),
+    user: User = Depends(require_roles("ops", "admin")),
```

Supporting hardening a reviewer should also ask for: rate limiting on the endpoint, an
audit-log entry via the security domain, and a two-person rule (or reason code from a
controlled vocabulary) before a `cancellation` is accepted.

## Detection hints

* Grep for privileged verbs bound to the weaker dependency:
  `rg -n "Depends\(current_user\)" backend/app/routers | rg -i "post|delete|patch"`.
* Compare each mutating handler against `require_roles` usage:
  `rg -n "require_roles" backend/app/routers`.
* Runtime signal — the structured log for a declaration records the actor role, so
  `grep '"msg": "disruption declared"' api.log | grep -v '"actor_role": "ops"'` shows any
  non-operations actor; a `customer` value there is proof of exploitation.
* Test pinning the behaviour: `backend/tests/test_irrops.py::test_vuln_100_customer_can_declare_disruption`.
