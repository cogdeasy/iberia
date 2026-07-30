# VULN-131 — Missing function-level authorisation on incident updates

| Field | Value |
|-------|-------|
| ID | VULN-131 |
| Domain | incidents |
| CWE | CWE-862 (Missing Authorization) |
| OWASP Top 10 (2021) | A01:2021 – Broken Access Control |
| Severity | High |
| Location | `backend/app/routers/incidents.py:136-144` (`patch_incident`) |
| Introduced by | Workstream 9 — incidents (branch `devin/iberia-incidents`) |

## Description

Declaring an incident is correctly restricted:

```python
user: User = Depends(require_roles("ops", "sre", "admin"))
```

but the mutation endpoint that changes an incident's **status, severity, commander and
resolution** only authenticates the caller:

```python
@router.patch("/{incident_id}", response_model=IncidentOut)
def patch_incident(..., user: User = Depends(current_user), ...):
```

Any authenticated principal — including a `customer` account created through
`POST /api/auth/register` — can therefore resolve a live Sev0, downgrade it to Sev3, reassign the
incident commander, or write a false resolution note. Each change is appended to the incident
timeline as if the responder had made it, so the record of the outage becomes untrustworthy.

The same gap applies to `POST /api/incidents/{id}/timeline`, which lets an unprivileged caller
inject narrative into the audit trail (and is the delivery vector for VULN-130).

## Reproduction

```bash
BASE=http://127.0.0.1:8000

CUSTOMER=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# the open Sev1 incident on the demo board
ID=$(curl -s -H "Authorization: Bearer $CUSTOMER" "$BASE/api/incidents?status=open" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')

# a customer cannot declare an incident ...
curl -s -o /dev/null -w '%{http_code}\n' -X POST $BASE/api/incidents \
  -H "Authorization: Bearer $CUSTOMER" -H 'Content-Type: application/json' \
  -d '{"title":"x","severity":0,"service":"booking"}'      # -> 403

# ... but can close one
curl -s -X PATCH $BASE/api/incidents/$ID \
  -H "Authorization: Bearer $CUSTOMER" -H 'Content-Type: application/json' \
  -d '{"status":"resolved","severity":3,"resolution":"nothing to see here"}' \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d["reference"],d["status"],d["severity"])'
```

Expected insecure result: `200 OK` and `INC-2026-0002 resolved 3` — an active Sev1 incident is
closed and downgraded by a passenger account.

## Blast radius

* **Audit integrity**: severity, status, commander and resolution of any incident can be
  rewritten by any account, so MTTR, severity distribution and postmortems are unreliable.
* **Response suppression**: resolving an incident stops the human response process (comms,
  bridge, escalation ladder) while the outage is still ongoing.
* **Attribution**: timeline entries record the attacker's display name as author, and can be
  used to blame a specific engineer.
* Applies to every incident in the estate — there is no per-incident ownership check either.

## Intended remediation

1. Replace the dependency with the same role gate used by `declare_incident`:
   `user: User = Depends(require_roles("ops", "sre", "admin"))`, and apply it to the timeline
   endpoint too.
2. Restrict privileged fields further: only `sre`/`admin` should be able to lower a severity or
   resolve a Sev0/Sev1; `ops` may add mitigations and notes.
3. Make the change auditable: emit an audit event (`/api/security/audit`) for every lifecycle
   mutation with actor, role and before/after values.
4. Add a negative test asserting a `customer` token receives `403` from
   `PATCH /api/incidents/{id}`.

## Detection hints

* Grep for mutating routes without a role dependency:
  `rg -n '@router\.(patch|post|delete)' -A 6 backend/app/routers | rg -B4 'Depends\(current_user\)'`.
* Compare the dependency on `declare_incident` (role-gated) with `patch_incident` (not gated) in
  the same file — the asymmetry is the tell.
* Log signature: the structured line `incident updated` records `actor_role`; any value other
  than `ops`/`sre`/`admin` is an exploitation attempt.
* Test asserting the current insecure behaviour:
  `backend/tests/test_incidents.py::test_planted_vuln_131_any_authenticated_user_can_resolve`.
