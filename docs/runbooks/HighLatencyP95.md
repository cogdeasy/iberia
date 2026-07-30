# HighLatencyP95

## 1. Alert

| Field | Value |
|-------|-------|
| Rule | `ops/prometheus/rules/platform.yml` → `HighLatencyP95` |
| Expression | `histogram_quantile(0.95, sum(rate(iberia_http_request_duration_seconds_bucket[5m])) by (le, route)) > 0.8` |
| For | 10m |
| Severity | warning (paging when the checkout SLO is also breached) |
| Fires on | `/api/payments`, `/api/bookings`, `/api/flights` |

## 2. Impact

Checkout feels stuck; customers double-submit payments and abandon baskets. The
`checkout-latency` SLO (p95 < 800 ms) starts burning budget immediately.

## 3. Dashboards & queries

* Console: `/ops/reliability` → select `payments-api`, window 30m; `/ops/slos` → `checkout-latency`.
* p95 by route:
  ```promql
  histogram_quantile(0.95, sum(rate(iberia_http_request_duration_seconds_bucket[5m])) by (le, route))
  ```
* p50 vs p99 (tail vs everything):
  ```promql
  histogram_quantile(0.50, sum(rate(iberia_http_request_duration_seconds_bucket[5m])) by (le, route))
  histogram_quantile(0.99, sum(rate(iberia_http_request_duration_seconds_bucket[5m])) by (le, route))
  ```
* Slowest requests in the logs:
  ```bash
  grep '"duration_ms"' backend/uvicorn.log | sort -t: -k2 -rn | head -20
  ```

## 4. Triage steps

1. Is traffic up or is latency up on flat traffic? Compare `traffic_rpm` and
   `latency_p95_ms` on `/api/sre/services/{name}/signals`. Flat traffic + high p95 ⇒
   dependency, not capacity.
2. Check chaos toggles — a `latency`, `timeout` or `slow_query` toggle produces exactly this
   signature:
   ```bash
   curl -s -H "Authorization: Bearer $SRE_TOKEN" http://127.0.0.1:8000/api/sre/chaos
   ```
3. Check the error budget: `GET /api/sre/slos/checkout-latency/error-budget`. `burn_rate_1h`
   above 6 means page now.
4. Correlate one slow request by `request_id`; the log lines from the owning service name the
   dependency call (`chaos latency injected`, `slow query detected`).
5. Check saturation — `saturation_pct` above 75% with rising p95 is a capacity problem, not a
   dependency one.

## 5. Mitigations

* `DELETE /api/sre/chaos/<target>` to remove injected latency.
* Reduce timeouts on the slow dependency so requests fail fast instead of queueing.
* Shed synthetic load: nothing should be running from `POST /api/sre/load` during an incident.

## 6. Root-cause pointers

* `backend/app/services/chaos.py` — `latency`/`slow_query` sleeps in the request path.
* Payment provider call in the payments domain (external dependency in the real estate).
* N+1 query patterns in list endpoints.

## 7. Escalation

Owning squad → payments squad if the trace points at the provider call → platform SRE if the
whole platform's p95 is up. Full walk-through: `docs/demo/S1-checkout-latency.md`.
