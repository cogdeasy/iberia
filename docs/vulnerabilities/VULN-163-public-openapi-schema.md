# VULN-163 — Interactive API documentation and OpenAPI schema exposed unauthenticated

| Field | Value |
|-------|-------|
| ID | VULN-163 |
| Domain | platform |
| CWE | CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor) |
| OWASP Top 10 (2021) | A05:2021 – Security Misconfiguration |
| Severity | Low |
| Location | `backend/app/main.py` (FastAPI created with default `docs_url`/`redoc_url`/`openapi_url`) |
| Introduced by | Baseline scaffold |

## Description

The application keeps FastAPI's default documentation surfaces enabled with no auth:
`/docs`, `/redoc` and `/openapi.json`. The schema enumerates every route — including the
internal ones (`/api/sre/debug/config`, `/api/payments/{id}/debug`, the audit trail, the chaos
controls) — together with request/response models and field names. It hands an attacker a
complete, machine-readable attack surface map without a single guess.

## Reproduction

```bash
curl -s http://127.0.0.1:8000/openapi.json | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["paths"]),"paths")'
curl -s http://127.0.0.1:8000/openapi.json | grep -o '/api/sre/debug/config'
```

Expected insecure result: the full path inventory, including debug and operator-only routes,
is returned to an unauthenticated caller.

## Blast radius

Reconnaissance only, but it is the shortest route to the high-value findings in this
repository: the debug config dump (VULN-191), the refund endpoint (VULN-052) and the
webhook test-fire (VULN-110) are all discoverable straight from the schema.

## Intended remediation

In non-development environments construct the app with
`FastAPI(docs_url=None, redoc_url=None, openapi_url=None)`, or gate those three routes behind
an operator role / network allow-list. Keep them enabled locally via an explicit
`IBERIA_ENV=local` check.

## Detection hints

- Grep for `FastAPI(` and check whether `docs_url`/`openapi_url` are overridden per environment.
- An unauthenticated `GET /openapi.json` returning `200` in a production-like environment.
