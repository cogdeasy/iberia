# IberiaApiLatencyP95High

## 1. Alert

| Field | Value |
|-------|-------|
| Expression | `histogram_quantile(0.95, sum(rate(iberia_http_request_duration_seconds_bucket[5m])) by (le)) > 0.8` |
| For | 10m |
| Severity | Sev2 (escalate to Sev1 when checkout is affected) |
| Service | `iberia-api` |
| Rule file | `ops/prometheus/rules/incidents-alerts.yml` |

## 2. Impact

Pages feel slow: flight search spins, seat maps take seconds to paint and card authorisation
occasionally times out in the browser. Checkout conversion drops well before requests actually
start failing, so this alert usually precedes `IberiaApiHighErrorRate`.

## 3. Dashboards & queries

```promql
# p95 by route — find the slow surface
histogram_quantile(
  0.95,
  sum by (le, route) (rate(iberia_http_request_duration_seconds_bucket[5m]))
)

# p50 vs p95: a wide gap means a slow tail, not uniform slowness
histogram_quantile(0.50, sum by (le) (rate(iberia_http_request_duration_seconds_bucket[5m])))

# concurrency / queueing
iberia_http_in_flight_requests
```

```bash
# slowest requests from the access log
grep '"duration_ms"' backend.log | python3 -c "
import json,sys
rows=[json.loads(line) for line in sys.stdin]
for row in sorted(rows,key=lambda r:-r.get('duration_ms',0))[:20]:
    print(row['duration_ms'], row['route'], row['request_id'])"
```

Ops console: `/ops/alerts` → SRE signals for the service → `/ops/incidents` if customer impact.

## 4. Triage steps

1. Confirm which route dominates with the per-route p95 query. Expected output: one route with
   p95 far above the rest.
2. Compare p50 and p95. p50 normal + p95 high = a slow dependency or a slow-query tail.
   Both high = saturation or the database.
3. Check `GET /api/sre/chaos` for an active `latency`, `timeout` or `slow_query` toggle on the
   slow target — the most common cause during demos.
4. Check `iberia_http_in_flight_requests`. Growing in-flight count with flat traffic means
   requests are queueing behind a blocking call.
5. Take a slow `request_id` from the log helper above and read every line for it to see which
   step consumed the time.
6. Check the error-budget burn rate: `GET /api/sre/slos/{id}/error-budget`. Burn rate > 2
   justifies raising the severity.

## 5. Mitigations

* `DELETE /api/sre/chaos/{target}` to stop injected latency.
* Reduce the upstream timeout so slow calls fail fast instead of holding workers.
* Disable the non-critical enrichment/lookup in the hot path via its feature flag.
* Scale out workers to absorb queueing while the root cause is investigated.

## 6. Root-cause pointers

* `backend/app/routers/payments.py` — long provider socket timeout cascading into checkout
  (demo scenario **S1**).
* N+1 query patterns in booking/seatmap serialisation.
* Missing index on a filtered column in a search query.

## 7. Escalation

1. On-call SRE (`sre@iberia.demo`).
2. Payments or booking on-call when the slow route belongs to checkout.
3. Duty manager if checkout p95 stays above 2 s for more than 15 minutes.
