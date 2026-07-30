# VULN-110 — SSRF in partner webhook registration and test-fire

| Field | Value |
|-------|-------|
| ID | VULN-110 |
| Domain | notifications |
| CWE | CWE-918 (Server-Side Request Forgery) |
| OWASP Top 10 (2021) | A10:2021 – Server-Side Request Forgery (SSRF) |
| Severity | High |
| Location | `backend/app/routers/notifications.py:240-251` (`test_webhook`) |
| Introduced by | Workstream 10 — notifications (branch `devin/iberia-notifications`) |

## Description

Operators can register a partner webhook with an arbitrary URL
(`POST /api/notifications/webhooks`) and then ask the platform to "test-fire" it
(`POST /api/notifications/webhooks/{id}/test`).

The test-fire handler performs a **server-side HTTP GET of the stored URL** with:

* no scheme allow-list — `http`, `file`-adjacent redirects and any other scheme `httpx`
  supports are accepted;
* no host/IP allow-list or deny-list — loopback (`127.0.0.1`), link-local
  (`169.254.169.254`) and RFC1918 addresses are all reachable;
* `follow_redirects=True`, so an attacker-controlled public host can 302 the request into
  the internal network (redirect-based SSRF bypass);
* the **response body reflected verbatim** back to the caller in `response_snippet`
  (first 500 bytes), turning a blind SSRF into a fully readable one.

Because the request originates from the notification host, it carries that host's network
position and any implicit trust (IAM instance role, internal-only listeners).

## Reproduction

```bash
# 0. mint an ops token (or log in via /api/auth/login once identity ships)
TOKEN=$(cd backend && .venv/bin/python -c \
  "from app.core.security import create_access_token; print(create_access_token('ops@iberia.demo','ops'))")

# 1. register a webhook pointing at an INTERNAL target
HOOK=$(curl -s -X POST http://127.0.0.1:8000/api/notifications/webhooks \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"url":"http://127.0.0.1:8000/readyz","event":"probe"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')

# 2. make the server fetch it and hand us the body
curl -s -X POST http://127.0.0.1:8000/api/notifications/webhooks/$HOOK/test \
  -H "Authorization: Bearer $TOKEN"
```

Observed insecure result (verified against a running app):

```json
{"status": "200", "response_snippet": "{\"status\":\"ready\",\"database\":\"reachable\"}"}
```

Higher-value internal targets, same two requests:

```bash
# cloud instance metadata — credential theft
-d '{"url":"http://169.254.169.254/latest/meta-data/iam/security-credentials/","event":"x"}'

# the SRE debug config endpoint (leaks secrets/DSNs)
-d '{"url":"http://127.0.0.1:8000/api/sre/debug/config","event":"x"}'
```

Expected insecure result: the attacker reads internal-only HTTP responses — including IMDS
IAM credentials — through a public, authenticated ops API.

## Blast radius

* **Cloud credential theft** via IMDS (`169.254.169.254`) → lateral movement into the whole
  cloud account with the notification host's instance role.
* **Internal service enumeration and reading**: any loopback/RFC1918 HTTP service the host
  can reach (admin consoles, debug/config endpoints, Prometheus, other domain APIs that
  trust network position).
* **Port scanning / liveness oracle** — status codes and error strings distinguish open,
  closed and filtered ports.
* Affects the whole platform, not just notifications: the reflected body leaks other
  domains' data. Requires an `ops`/`sre`/`admin` token, so the primary threat actors are a
  compromised operator account or an insider — and the SSRF then escalates that limited
  role into infrastructure-level access.

## Intended remediation

1. **Validate at registration time and again before every fetch** (the stored URL may have
   been planted before a rule change, and DNS can be re-pointed → resolve-then-pin):
   * allow only `https` (optionally `http` for explicitly whitelisted dev hosts);
   * resolve the hostname and reject any address that is loopback, link-local
     (`169.254.0.0/16`), private, multicast, reserved or unspecified — check **every**
     resolved address, then connect to the pinned IP to close the DNS-rebinding window;
   * prefer a positive **allow-list of partner domains** held in configuration.
2. **Disable redirect following** (`follow_redirects=False`) or re-validate the target of
   each hop.
3. **Do not reflect the response body.** Return only a boolean/expected-signature result,
   e.g. `{"status": "delivered"}` or a hash — never `resp.text`.
4. Send webhooks through an **egress proxy** on an allow-listed network path, and give the
   notification host no IMDS access (IMDSv2 with hop limit 1, or metadata disabled).
5. Sign deliveries (HMAC over the payload) so partners verify authenticity and the platform
   never needs a "reflect what you saw" debug affordance.

## Detection hints

* Grep: `httpx.Client(` / `http.get(` / `requests.get(` where the URL argument derives from a
  DB column or request body (`hook.url`, `payload.url`).
* Grep for reflection: `response_snippet`, `resp.text[:`.
* Log signature: `iberia.notifications` `"webhook test fired"` events whose `url` field is a
  loopback / `169.254.` / RFC1918 address — a normal partner URL is a public HTTPS hostname.
* Metric/alerting idea: outbound connections from the notification host to link-local or
  private ranges should be zero.
* Test assertion for the fixed version: registering `http://169.254.169.254/` must return
  `400`, and test-firing must never include the fetched body in the response.
