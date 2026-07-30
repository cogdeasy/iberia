# VULN-190 — Missing function-level authorisation on chaos stop and load generator

| Field | Value |
|-------|-------|
| ID | VULN-190 |
| Domain | reliability / chaos tooling (`sre`) |
| CWE | CWE-862 (Missing Authorization) |
| OWASP Top 10 (2021) | A01:2021 – Broken Access Control |
| Severity | High |
| Location | `backend/app/routers/sre.py:164-169` (`DELETE /api/sre/chaos/{target}`), `backend/app/routers/sre.py:172-198` (`POST /api/sre/load`) |
| Introduced by | Workstream 8 — reliability core (`devin/iberia-sre`) |

## Description

The chaos API is supposed to be restricted to the `sre` and `admin` roles. `GET /api/sre/chaos`
and `POST /api/sre/chaos` correctly depend on `require_roles("sre", "admin")`, but two verbs do
not declare any dependency at all:

* `DELETE /api/sre/chaos/{target}` — no `current_user`, no `require_roles`.
* `POST /api/sre/load` — no `current_user`, no `require_roles`.

Because FastAPI only enforces what a route declares, both endpoints are reachable by *any*
caller, including an unauthenticated one. An attacker can therefore drive synthetic traffic at
the platform (a self-inflicted denial of service, amplified by `rps` × `duration_seconds`) and
can silently clear a fault-injection toggle that an on-call engineer is relying on — hiding or
prolonging an incident. The asymmetry (arming is protected, stopping is not) is exactly the kind
of "hotfix left in place" bug that review should catch.

## Reproduction

No `Authorization` header anywhere:

```bash
# 1. Unauthenticated denial of service: 200 rps for 10 minutes against the app's own endpoints
curl -s -X POST http://127.0.0.1:8000/api/sre/load \
  -H 'content-type: application/json' \
  -d '{"scenario":"search_storm","duration_seconds":600,"rps":200}'
# {"status":"started","scenario":"search_storm","duration_seconds":600,"rps":200,"requests_planned":120000}

# 2. Unauthenticated removal of an SRE's active fault injection
curl -s -X DELETE http://127.0.0.1:8000/api/sre/chaos/payments
# {"status":"cleared","target":"payments"}
```

Expected insecure result: HTTP 202 / 200 instead of 401. Contrast with the protected verb:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8000/api/sre/chaos \
  -H 'content-type: application/json' -d '{"target":"payments","mode":"error","magnitude":100}'
# 401
```

## Blast radius

* Availability of the whole platform: the load generator is an unauthenticated traffic
  amplifier that consumes worker threads, database connections and the request budget of every
  other domain.
* Integrity of incident response: an attacker (or any curious authenticated user) can flip
  reliability controls mid-incident, so dashboards and SLO burn rates no longer reflect what
  responders think is armed.
* No audit trail attributes the action to a user, because there is no authenticated principal.

## Intended remediation

Add the same dependency the sibling verbs use, and log the actor:

```python
@router.delete("/chaos/{target}")
def delete_chaos(target: str, user: User = Depends(require_roles("sre", "admin"))) -> dict[str, str]:
    ...

@router.post("/load", response_model=LoadResponse, status_code=202)
def start_load(payload: LoadRequest, request: Request,
               user: User = Depends(require_roles("sre", "admin"))) -> LoadResponse:
    ...
```

Better still, attach the dependency to the router (`APIRouter(..., dependencies=[Depends(require_roles("sre", "admin"))])`)
for the chaos/load sub-tree so a new verb cannot forget it, and rate-limit
`POST /api/sre/load` independently.

## Detection hints

* Grep for route decorators whose handler signature has no `Depends(` at all:
  `rg -n '@router\.(post|delete|put|patch)' backend/app/routers | ...` then inspect signatures.
* Diff the dependencies of verbs sharing one path prefix — `GET`/`POST /api/sre/chaos` require a
  role, `DELETE /api/sre/chaos/{target}` does not.
* Runtime test: any 2xx from these endpoints without an `Authorization` header is a failure.
* Logs show `"msg": "chaos toggle cleared"` / `"load generator started"` with no `actor` field.
