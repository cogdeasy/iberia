# Iberia demo — run of show

One page to drive the whole demo. Two tracks, each ~20 minutes: **SRE** (detect → triage →
mitigate → postmortem) and **Security** (enumerate → prove → remediate).

## 0. Bring it up (2 min)

```bash
cd backend && python seed.py && uvicorn app.main:app --reload --port 8000
cd frontend && npm install && npm run dev        # http://localhost:5173
# optional: full observability stack (Prometheus + Grafana + Loki)
docker compose -f ops/compose/observability.yml up -d
```

Sign in at `/login` with password `Iberia2026!`:

| Persona | Email | Shows |
|---|---|---|
| Traveller | `customer@iberia.demo` | search → book → pay → check in → loyalty |
| Elite traveller | `frequent@iberia.demo` | Iberia Plus tiers, redemption |
| Contact centre | `agent@iberia.demo` | servicing a passenger's PNR |
| Operations | `ops@iberia.demo` | disruptions, rebooking |
| SRE | `sre@iberia.demo` | golden signals, SLOs, chaos, incidents, alerts |
| Admin | `admin@iberia.demo` | everything, incl. security console |

Sanity check: `scripts/smoke.sh` exercises the happy path end to end.

## 1. The product (5 min)

As `customer@iberia.demo`: **Flights** → search MAD→BCN → **Book** → seat map → **Checkout**
(card authorisation) → **Check-in** (boarding pass, bags) → **Iberia Plus** (accrual, tier).
Then as `ops@iberia.demo`: **Irregular Ops** → a delayed flight → rebook affected passengers.

Every request is instrumented: `x-request-id` on every response, JSON access logs,
`/metrics` exposing `iberia_http_requests_total`, `iberia_http_request_duration_seconds`,
`iberia_http_in_flight_requests`, `iberia_domain_events_total`.

## 2. SRE track (20 min)

Start on **Ops & SRE → Reliability** (`/sre`): traffic, error rate, latency p50/p95/p99 and
saturation per service; **SLOs** (`/sre/slos`) with error budget and 1h/6h burn rate;
**Chaos** (`/sre/chaos`) for fault injection; **Alerts** (`/alerts`) and **Incidents**
(`/incidents`).

Pick one scenario and let Devin drive the triage from the alert:

| # | Scenario | Inject | Alert | Runbook | Script |
|---|---|---|---|---|---|
| S1 | Checkout latency — payment provider slows, cascades into booking | chaos toggle: `POST /api/sre/chaos {"target":"payments","mode":"latency","magnitude":1500,"ttl_seconds":300}` | `IberiaApiLatencyP95High` | `docs/runbooks/IberiaApiLatencyP95High.md` | `docs/demo/S1-checkout-latency.md` |
| S2 | Rebooking error spike — irregular-ops rebooking starts 500ing | feature flag: restart the API with `IBERIA_IRROPS_REBOOK_V2=1`, then drive traffic to `POST /api/irrops/disruptions/{id}/rebook` | `IrropsRebookingErrorRateHigh` | `docs/runbooks/IrropsRebookingErrorRateHigh.md` | `docs/demo/S2-rebooking-error-spike.md` |
| S3 | Notification backlog — queue grows, workers saturate, DLQ fills | `POST /api/notifications/queue/saturate {"enabled":true,"burst":200}` (or the UI button) | `NotificationQueueBacklogGrowing`, `NotificationDLQGrowing` | `docs/runbooks/NotificationQueueBacklogGrowing.md` | `docs/demo/S3-notification-backlog.md` |

Suggested beats (S1 as the default):

1. **Detect** — arm the toggle, generate traffic with `POST /api/sre/load`, watch p95 cross the
   SLO on `/sre` and the alert appear on `/alerts`.
2. **Triage** — hand Devin the alert. It reads the runbook, queries `/api/sre/services/payments-api/signals`,
   correlates by `request_id` in the JSON logs, and localises the fault to the payment provider call.
3. **Declare** — `POST /api/incidents` with severity; timeline entries via
   `POST /api/incidents/{id}/timeline`.
4. **Mitigate** — clear the toggle (`DELETE /api/sre/chaos/payments`), show p95 and the error
   budget recovering.
5. **Resolve & postmortem** — `PATCH /api/incidents/{id}` to resolved, then
   `GET /api/incidents/{id}/postmortem` for the generated write-up, and have Devin turn the
   root cause into a code fix.

Full step-by-step (with expected numbers) in `docs/demo/incident-triage-walkthrough.md`.

## 3. Security track (20 min)

**Security → Posture** (`/security/posture`) reads the register straight from
`docs/vulnerabilities/` — **37 documented, reachable findings**: 13 critical, 18 high, 6 medium,
spanning A01 Broken Access Control (13), A05 Misconfiguration (5), A03 Injection (4),
A02 Cryptographic Failures, A04 Insecure Design, A07 Auth Failures, A08 Integrity Failures,
A09 Logging Failures, A10 SSRF.

`docs/VULNERABILITIES.md` is the generated answer key (regenerate with
`python scripts/generate_vuln_index.py`); each `docs/vulnerabilities/VULN-*.md` gives the exact
location, a copy-pasteable reproduction, blast radius, intended fix and detection hints.

High-impact ones to prove live:

| ID | Finding | One-liner |
|---|---|---|
| VULN-020 | SQL injection in flight search | `curl "localhost:8000/api/flights/search?origin=MAD'%20OR%20'1'%3D'1&destination=BCN"` returns rows the filter should exclude |
| VULN-002 | Password-reset token in the response body and logs | `curl -X POST localhost:8000/api/auth/password-reset -d '{"email":"admin@iberia.demo"}'` hands you the token |
| VULN-004 | Missing function-level authorization on user listing | a `customer` token lists every user, PII included |
| VULN-030 | IDOR on PNR retrieval and cancellation | any authenticated user reads or cancels any booking by PNR |
| VULN-191 | Debug endpoint dumps the JWT signing secret and database URL | `curl localhost:8000/api/sre/debug/config` → forge an admin token; full auth bypass |
| VULN-110 | SSRF in partner webhook registration and test-fire | `POST /api/notifications/webhooks/{id}/test` fetches arbitrary internal URLs |
| VULN-070 | Path traversal in the travel-document download | `curl --path-as-is localhost:8000/api/checkin/documents/../../app/core/config.py` reads source |
| VULN-170 | Reflected XSS in the support message preview | payload rendered via `dangerouslySetInnerHTML` |
| VULN-050 | Reversible storage of the full card PAN | "encrypted" with a static XOR key |

Suggested beats:

1. **Enumerate** — point Devin at the repo cold: "find the security problems". Compare its list
   against `docs/VULNERABILITIES.md`.
2. **Prove one** — run the reproduction above; show the impact on real data.
3. **Remediate** — ask Devin to fix that one finding *only*: parameterised query, a
   `require_roles` dependency, an ownership check, an allowlisted URL fetch, an escaped render.
   Tests stay green.
4. **Verify** — re-run the reproduction, show it now 403s/404s, and show `/security/posture`
   and the audit log (`/security/audit`) reflecting the change.

Full walkthrough in `docs/demo/security-walkthrough.md`.

> The planted vulnerabilities are intentional. Do not "clean them up" before the demo — fix only
> what you are demonstrating.

## 4. Numbers worth quoting

- 73 API endpoints, 21 UI surfaces, 147 backend tests green, 217 files.
- 12 alert rules across 5 Prometheus rule files, 13 runbooks, 3 scripted incident scenarios.
- 37 documented, reachable vulnerabilities with individual remediation notes.
- Built by 12 parallel Devin sessions against a shared contract (`docs/API_CONTRACTS.md`,
  `AGENTS.md`) with auto-discovered routers, seeders and pages, so nothing collided.
