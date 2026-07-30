# VULN-151 — No security response headers (HSTS, CSP, X-Frame-Options, X-Content-Type-Options)

| Field | Value |
|-------|-------|
| ID | VULN-151 |
| Domain | platform |
| CWE | CWE-693 (Protection Mechanism Failure) |
| OWASP Top 10 (2021) | A05:2021 – Security Misconfiguration |
| Severity | Medium |
| Location | `backend/app/routers/platform_support.py:32-55` (posture endpoint documenting the gap); the missing middleware belongs in `backend/app/main.py:57` next to `CORSMiddleware` |
| Introduced by | Workstream 12 — platform (`devin/iberia-platform`) |

## Description

Nothing in the request path sets security headers. `ObservabilityMiddleware` adds only
`x-request-id`, `CORSMiddleware` adds CORS headers, and no reverse proxy exists in the demo
stack, so every response is missing:

| Header | Missing consequence |
|--------|--------------------|
| `Strict-Transport-Security` | plain-HTTP downgrade / SSL-strip stays possible |
| `Content-Security-Policy` | nothing constrains injected script — this is what makes VULN-170 fully exploitable |
| `X-Content-Type-Options: nosniff` | MIME sniffing can turn an uploaded/echoed document into script |
| `X-Frame-Options` / `frame-ancestors` | the console can be framed for clickjacking |
| `Referrer-Policy` | full URLs leak to third parties — amplifies VULN-171's token-in-URL leak |

`GET /api/platform/config` returns a `security_headers` map that reports every one of these as
`false`, and the `/support` page renders it, so the gap is visible in the product itself.

## Reproduction

```bash
# no security headers on any response
curl -sI http://127.0.0.1:8000/healthz
curl -sI http://127.0.0.1:8000/api/platform/config

# the API itself admits the gap
curl -s http://127.0.0.1:8000/api/platform/config | python3 -m json.tool
```

Expected insecure result: the response headers contain only `date`, `server`,
`content-length`, `content-type` and `x-request-id`; `security_headers` is
`{"strict-transport-security": false, "content-security-policy": false, ...}`.

## Blast radius

Weakens every other client-side finding: without CSP the reflected XSS in VULN-170 can load
remote script and exfiltrate the token from `localStorage`; without `Referrer-Policy` the shared
URL in VULN-171 leaks the JWT to any third-party link target; without `X-Frame-Options` the
support and ops consoles can be framed and clickjacked.

## Intended remediation

Add a small `SecurityHeadersMiddleware` (its own module, e.g.
`backend/app/core/security_headers.py`) registered next to `CORSMiddleware` in
`create_app()`, emitting:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
```

Terminate TLS at the edge and set the same headers there as defence in depth.

## Detection hints

* Grep for `add_middleware(` in `backend/app/main.py` — only observability and CORS are present;
  no header middleware module exists anywhere under `backend/app/`.
* Any header scanner (`curl -I`, `nikto`, ZAP passive scan) flags all five headers as absent.
* Test: `backend/tests/test_platform_support.py::test_security_headers_are_absent`.
