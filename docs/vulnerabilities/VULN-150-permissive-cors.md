# VULN-150 — Permissive CORS reflects any origin with credentials allowed

| Field | Value |
|-------|-------|
| ID | VULN-150 |
| Domain | platform |
| CWE | CWE-942 (Permissive Cross-domain Policy with Untrusted Domains) |
| OWASP Top 10 (2021) | A05:2021 – Security Misconfiguration |
| Severity | High |
| Location | `.env.example:44` (documented demo profile), `backend/app/core/config.py:15-19` |
| Introduced by | Workstream 12 — platform (`devin/iberia-platform`) |

## Description

`Settings.cors_origins` is read from `IBERIA_CORS_ORIGINS`, and the "airport kiosk / partner
demo" profile documented in `.env.example` sets it to `*`. `app/main.py` passes that list to
Starlette's `CORSMiddleware` together with `allow_credentials=True`, `allow_methods=["*"]` and
`allow_headers=["*"]`.

With a wildcard origin *and* credentials enabled, Starlette does not return a literal `*`: it
echoes the request's `Origin` back in `Access-Control-Allow-Origin` and adds
`Access-Control-Allow-Credentials: true`. Any website can therefore make authenticated
cross-origin calls to the API from a signed-in passenger's browser and read the responses.
`settings.cors_allow_all` records that the wildcard profile is active and the `/support` page
surfaces it under "Platform posture".

## Reproduction

```bash
# start the API with the documented kiosk/partner profile
cd backend && IBERIA_CORS_ORIGINS='*' .venv/bin/uvicorn app.main:app --port 8000

# any origin is reflected back, with credentials allowed
curl -si -H "Origin: https://evil.example.com" -H "Cookie: a=b" \
     http://127.0.0.1:8000/healthz | grep -i access-control

# preflight for a state-changing call also succeeds
curl -si -X OPTIONS http://127.0.0.1:8000/api/platform/support/broadcast \
     -H "Origin: https://evil.example.com" \
     -H "Access-Control-Request-Method: POST" \
     -H "Access-Control-Request-Headers: authorization,content-type" | grep -i access-control
```

Expected insecure result:

```
access-control-allow-origin: https://evil.example.com
access-control-allow-credentials: true
```

## Blast radius

Every authenticated API surface (bookings, PNRs, payments, loyalty, support inbox) becomes
readable and writable from any third-party page a signed-in passenger or agent visits. Combined
with VULN-171 (JWT in `localStorage`/URL) an attacker page can lift the token outright, and with
VULN-172 it can send passenger-wide broadcasts.

## Intended remediation

* Keep `IBERIA_CORS_ORIGINS` as an explicit allow-list of first-party origins; reject `*`
  whenever `allow_credentials=True` (fail startup on that combination).
* Restrict `allow_methods` / `allow_headers` to what the SPA actually uses.
* Serve the SPA from the same origin as the API in production so CORS is not needed at all.

## Detection hints

* Grep: `IBERIA_CORS_ORIGINS=\*`, `allow_origins=\["\*"\]`, `cors_allow_all`.
* Runtime: a response whose `access-control-allow-origin` equals an arbitrary request `Origin`
  while `access-control-allow-credentials` is `true`.
* Test: `backend/tests/test_platform_support.py::test_cors_allow_all_flag_tracks_wildcard_configuration`.
