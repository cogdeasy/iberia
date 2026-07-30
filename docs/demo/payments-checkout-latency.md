# Demo note — payments side of scenario S1 (checkout latency)

The payments domain is the injection point for **S1 — checkout latency: payment provider
timeout cascades into a booking p95 breach**. This note documents only what payments owns; the
alert rule and runbook live with the `sre` workstream.

## Where the fault is injected

`backend/app/services/payments.py::call_provider` is the only place the simulated acquirer is
called. Before doing any work it calls `_apply_chaos()`, which imports
`app.services.chaos.apply_chaos` and invokes `apply_chaos("payments")`. The import is wrapped in
`try/except ImportError`, so payments works standalone if the chaos service is not installed.

Anything `apply_chaos("payments")` does — sleeping, raising, throttling — happens inside the
measured window of `call_provider`, so it shows up as:

* `POST /api/payments/authorise` latency in `iberia_http_request_duration_seconds`,
* and, once the injected delay exceeds `PROVIDER_TIMEOUT_SECONDS` (5 s), HTTP **504** responses
  plus `iberia_domain_events_total{domain="payments",event="provider_timeout"}`.

## Signals to watch during the demo

| Signal | Where |
|--------|-------|
| `iberia_http_request_duration_seconds{route="/api/payments/authorise"}` | p95 climbs first |
| `iberia_domain_events_total{domain="payments",event="provider_call"}` | traffic still flowing |
| `iberia_domain_events_total{domain="payments",event="provider_timeout"}` | fault biting |
| `iberia_domain_events_total{domain="payments",event="authorisation_failed"}` | 504s returned to checkout |
| Log line `payment provider timeout` (JSON, has `pnr`, `waited_ms`, `request_id`) | backend stdout |
| Log line `payment provider authorised` with `duration_ms` | healthy path |

## Demo script

1. Sign in as `customer@iberia.demo`, open **Travel → Payments**, enter a PNR and pay with the
   Visa test card `4111 1111 1111 1111`. Confirm the masked card and provider reference.
2. As `sre@iberia.demo`, enable latency injection on target `payments` from the chaos panel.
3. Repeat the checkout: the page hangs, then reports a gateway timeout; the SLO burn-rate view
   and the checkout-latency alert start firing.
4. Follow the request id from the alert into the `payment provider timeout` log line, then into
   `call_provider`.
5. Disable the chaos toggle; latency and the error budget recover.

## Notes

* Timings only — no network egress. The provider is simulated, so the happy path stays offline
  and deterministic (`random.uniform(0.005, 0.02)` sleep).
* The 504 is returned deliberately rather than retried, so the cascade is visible end to end.
