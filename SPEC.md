# Iberia Digital Platform — Specification

A demo estate representing the systems an airline like Iberia runs: a customer travel
front-end, airline operations tooling, and the reliability/security posture around them.

## 1. Domains

| # | Domain | API prefix | Owner module | Purpose |
|---|--------|-----------|--------------|---------|
| 1 | Identity | `/api/auth`, `/api/users` | `identity` | login, sessions, profile, roles, API keys |
| 2 | Flights & inventory | `/api/flights` | `flights` | schedule search, availability, fares |
| 3 | Booking | `/api/bookings` | `booking` | PNR creation, passengers, seat map, cancellation |
| 4 | Payments | `/api/payments` | `payments` | card authorisation, refunds, vouchers |
| 5 | Check-in | `/api/checkin` | `checkin` | check-in, boarding passes, bags |
| 6 | Iberia Plus | `/api/loyalty` | `loyalty` | Avios accrual/redemption, tiers |
| 7 | Irregular ops | `/api/irrops` | `irrops` | delays, cancellations, rebooking, EU261 |
| 8 | Reliability | `/api/sre` | `sre` | SLOs, error budgets, service registry, chaos |
| 9 | Incidents | `/api/incidents` | `incidents` | incident lifecycle, timeline, postmortems |
| 10 | Notifications | `/api/notifications` | `notifications` | passenger comms, webhooks, templates |
| 11 | Security | `/api/security` | `security` | audit log, findings register, admin console |

## 2. Cross-cutting platform contract (already implemented)

* `GET /healthz`, `GET /readyz`, `GET /metrics` (Prometheus text format).
* Every response carries `x-request-id`; logs are JSON with `request_id`, `route`,
  `status`, `duration_ms`.
* Metric families: `iberia_http_requests_total`, `iberia_http_request_duration_seconds`,
  `iberia_http_in_flight_requests`, `iberia_domain_events_total{domain,event}`.
* JWT bearer auth, roles: `customer`, `agent`, `ops`, `sre`, `admin`.
* SQLite database, deterministic seed (`SEED = 42`) with 8 airports, 4 aircraft,
  ~112 flights over 14 days and 6 personas.

## 3. SRE track requirements

The demo must be able to show, live:

1. **Golden signals** per service: traffic, error rate, latency (p50/p95/p99), saturation.
2. **SLOs and error budgets** — e.g. booking API availability 99.5 %, checkout latency
   p95 < 800 ms — with burn-rate calculation.
3. **Fault injection** (`/api/sre/chaos`, `sre`/`admin` only): latency injection, error-rate
   injection, dependency timeouts, database slow-query, memory pressure — all toggleable and
   scoped to a target service so a demo incident can be started and stopped on command.
4. **Synthetic traffic generator** so the dashboards are never empty.
5. **Alert rules** in `ops/prometheus/rules/*.yml` mapping 1:1 to runbooks in
   `docs/runbooks/*.md`.
6. **Incident lifecycle** — declare, assign severity (Sev0–Sev3), timeline entries,
   mitigations, resolve, generate a postmortem skeleton.
7. **Ops console** pages: service health, SLO/error-budget view, incident board, incident
   detail with timeline, chaos control panel.

At least three scripted, reproducible incident scenarios must exist end-to-end
(alert → dashboard → logs → code → fix), documented in `docs/DEMO.md`:

* **S1 — Checkout latency**: payment provider timeout cascades into booking p95 breach.
* **S2 — Error spike**: unhandled exception path in irregular-ops rebooking returns 500s.
* **S3 — Saturation/leak**: notification queue backlog grows unbounded and exhausts workers.

## 4. Security track requirements

`docs/VULNERABILITIES.md` is the answer key: every planted issue lists ID, title, CWE, OWASP
category, severity, exact file and line reference, exploit reproduction (curl), blast radius
and the intended remediation. The planted set must span at least:

* SQL injection via raw SQL string building
* Broken object-level authorisation (IDOR) on booking/PNR retrieval
* Missing function-level authorisation (privileged endpoint without role check)
* Hardcoded secrets / credentials in source
* Weak cryptography and reversible storage of sensitive data (card PAN, passport number)
* Sensitive data exposure in logs and error responses (stack traces, PII)
* Reflected/stored XSS via unsanitised HTML rendering
* Server-side request forgery in a webhook/URL-fetch feature
* Path traversal / arbitrary file read in a document download endpoint
* Insecure deserialization (pickle/YAML load)
* Mass assignment / privilege escalation on profile update
* Missing rate limiting and account-enumeration on login and password reset
* Permissive CORS and missing security headers
* Vulnerable/outdated dependency pinned in a manifest
* JWT weaknesses (long-lived tokens, `alg` confusion, no revocation)

Every planted vulnerability must be **reachable through the running app** (an HTTP request
that demonstrates it) and must not break the happy path or the test suite.

## 5. Non-functional

* `python seed.py` produces the same dataset every run.
* Backend boots in under 5 s; frontend `ng build` passes and `ng lint` reports no warnings.
* No secrets that are real. All credentials are obviously fake demo values.
* Everything runs offline on a single machine with SQLite; no external network calls
  required for the happy path.
