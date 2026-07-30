# S1 — Checkout latency: payment provider timeout cascades into an SLO breach

**Track:** SRE · **Owner:** reliability core (`/api/sre`) · **Duration:** 6–8 minutes
**Story:** the payment provider starts responding slowly, checkout p95 breaches the
`checkout-latency` SLO (p95 < 800 ms), the error budget burns at >14x, on-call follows the
runbook, correlates logs by `request_id`, identifies the provider call and stops the fault.

## 0. Setup

```bash
cd backend && .venv/bin/python seed.py
.venv/bin/uvicorn app.main:app --port 8000        # terminal 1, JSON logs on stdout
cd ../frontend && npm run dev                     # terminal 2 → http://localhost:5173
```

Sign in as `sre@iberia.demo` / `Iberia2026!` and keep `/ops/reliability`, `/ops/slos` and
`/ops/chaos` open. Grab a token for curl:

```bash
export SRE_TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"sre@iberia.demo","password":"Iberia2026!"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
```

## 1. Establish the baseline (30 s)

```bash
curl -s -H "Authorization: Bearer $SRE_TOKEN" \
  "http://127.0.0.1:8000/api/sre/services/payments-api/signals?window_minutes=30"
```

Expected (synthetic backfill on a cold environment, `"synthetic": true`):

| Signal | Expected |
|--------|----------|
| `traffic_rpm` | ~210 |
| `error_rate` | ~0.0005 (0.05 %) |
| `latency_p50_ms` | ~117 |
| `latency_p95_ms` | ~260 |
| `saturation_pct` | ~35 |

`/ops/slos` shows every objective `ok`, with `checkout-latency` achieved 100.00 % and budget
remaining 100 %. Fill the charts with *real* traffic first if you want `"synthetic": false`:

```bash
curl -s -X POST http://127.0.0.1:8000/api/sre/load \
  -H 'content-type: application/json' \
  -d '{"scenario":"checkout_rush","duration_seconds":120,"rps":10}'
```

## 2. Break it (10 s)

Inject 700 ms of provider latency on the `payments` target for five minutes:

```bash
curl -s -X POST http://127.0.0.1:8000/api/sre/chaos \
  -H "Authorization: Bearer $SRE_TOKEN" -H 'content-type: application/json' \
  -d '{"target":"payments","mode":"latency","magnitude":700,"ttl_seconds":300}'
```

To show a hard dependency failure instead, use `{"mode":"timeout","magnitude":3000}` — the
provider call then raises `ChaosTimeout` and checkout returns 5xx.

## 3. Detect

`/ops/reliability` → `payments-api` flips to **degraded**; the p95 line jumps.

```bash
curl -s -H "Authorization: Bearer $SRE_TOKEN" \
  "http://127.0.0.1:8000/api/sre/services/payments-api/signals?window_minutes=30"
```

Expected with the 700 ms toggle: `latency_p95_ms ≈ 960`, `latency_p99_ms ≈ 1325`
(baseline + injected delay), error rate unchanged.

The alert that fires is `HighLatencyP95` (`ops/prometheus/rules/platform.yml`, `for: 10m`):

```promql
histogram_quantile(0.95,
  sum(rate(iberia_http_request_duration_seconds_bucket{route=~"/api/payments.*"}[5m])) by (le, route)
) > 0.8
```

## 4. Quantify the damage

```bash
curl -s -H "Authorization: Bearer $SRE_TOKEN" \
  http://127.0.0.1:8000/api/sre/slos/checkout-latency/error-budget
```

Expected with `latency`/700 ms:

```json
{"slo_id":"checkout-latency","objective":99.0,"achieved":83.36,
 "budget_remaining_pct":0.0,"burn_rate_1h":16.64,"burn_rate_6h":9.99,"status":"breached"}
```

With `timeout`/3000 ms it is far worse (`achieved ≈ 24.5`, `burn_rate_1h ≈ 75`), which is what
`ErrorBudgetBurnFast` pages on (>14.4x). `/ops/slos` shows the bar at 0 % and a red
`breached` badge.

## 5. Triage with the runbook

Follow [`docs/runbooks/HighLatencyP95.md`](../runbooks/HighLatencyP95.md):

1. Traffic is flat while p95 tripled ⇒ dependency, not capacity.
2. List armed faults — this is the smoking gun:
   ```bash
   curl -s -H "Authorization: Bearer $SRE_TOKEN" http://127.0.0.1:8000/api/sre/chaos
   # [{"target":"payments","mode":"latency","magnitude":700.0,"active":true,"expires_at":"..."}]
   ```
3. Correlate the logs by `request_id`. Every response carries `x-request-id`, and every log
   line is JSON with the same field:
   ```bash
   REQ=$(curl -s -D - -o /dev/null http://127.0.0.1:8000/api/payments \
     -H "Authorization: Bearer $SRE_TOKEN" | awk '/x-request-id/ {print $2}' | tr -d '\r')
   grep "$REQ" backend/uvicorn.log
   ```
   Expected: the access line with `"duration_ms": 7xx` plus
   `{"msg": "chaos latency injected", "target": "payments", "delay_ms": 700.0}` — the payment
   provider call is the slow span.
4. Slowest requests overall:
   ```bash
   grep '"route": "/api/payments"' backend/uvicorn.log | tail -20
   ```
5. Root cause in code: `backend/app/services/chaos.py` (`apply_chaos`), called from the
   payments provider path. In production this is the provider HTTP client timeout.

## 6. Mitigate

```bash
curl -s -X DELETE http://127.0.0.1:8000/api/sre/chaos/payments
# {"status":"cleared","target":"payments"}
```

p95 returns to ~260 ms on the next refresh (15 s) and `checkout-latency` returns to `ok`.
Toggles also auto-expire after `ttl_seconds`, so an abandoned demo self-heals.

## 7. Wrap up

Declare/resolve the incident with the incidents API and note the numbers in the timeline:

```bash
curl -s -X POST http://127.0.0.1:8000/api/incidents \
  -H "Authorization: Bearer $SRE_TOKEN" -H 'content-type: application/json' \
  -d '{"title":"Checkout p95 breach — payment provider latency","severity":1,
       "service":"payments-api","summary":"700ms added latency on the provider call"}'
```

Talking points: alert → dashboard → error budget → logs by `request_id` → code → mitigation,
all inside one platform, with the fault injected and removed on command.
