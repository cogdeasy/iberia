# ErrorBudgetBurnFast

## 1. Alert

| Field | Value |
|-------|-------|
| Rule | `ops/prometheus/rules/platform.yml` → `ErrorBudgetBurnFast` |
| Expression | 1h failure ratio on tier-1 routes > `14.4 × 0.005` (14.4x burn of a 99.5% / 30d budget) |
| For | 2m |
| Severity | critical (page) |
| Fires on | `/api/bookings`, `/api/payments`, `/api/checkin` |

## 2. Impact

The 30-day availability budget for the tier-1 booking flow will be exhausted in under two
days at the current rate. Every minute spent triaging costs budget that cannot be recovered
until the window rolls.

## 3. Dashboards & queries

* Console: `/ops/slos` — the `Budget remaining` bar and `Burn 1h` / `Burn 6h` badges.
* Per-SLO API:
  ```bash
  curl -s -H "Authorization: Bearer $SRE_TOKEN" \
    http://127.0.0.1:8000/api/sre/slos/booking-availability/error-budget
  ```
* Burn rate over the fast and slow windows:
  ```promql
  sum(rate(iberia_http_requests_total{status=~"5..",route=~"/api/(bookings|payments|checkin).*"}[1h]))
    / sum(rate(iberia_http_requests_total{route=~"/api/(bookings|payments|checkin).*"}[1h]))
  sum(rate(iberia_http_requests_total{status=~"5..",route=~"/api/(bookings|payments|checkin).*"}[6h]))
    / sum(rate(iberia_http_requests_total{route=~"/api/(bookings|payments|checkin).*"}[6h]))
  ```

## 4. Triage steps

1. Confirm both windows burn: 1h high and 6h low ⇒ a new, sharp regression (look at the last
   deploy). Both high ⇒ a sustained problem that has been under-reported.
2. Identify the dominant contributor:
   ```promql
   topk(3, sum(rate(iberia_http_requests_total{status=~"5.."}[15m])) by (route))
   ```
3. Follow the matching alert runbook: [HighErrorRate](HighErrorRate.md) for availability
   burn, [HighLatencyP95](HighLatencyP95.md) for latency SLOs.
4. Declare an incident and record the budget number in the timeline — it is the strongest
   argument for a rollback decision.

## 5. Mitigations

* Roll back the newest tier-1 deploy; freeze further releases while the budget is negative.
* Disable the failing feature path (chaos toggle, feature flag) rather than retrying.
* If the burn is caused by demo fault injection: `DELETE /api/sre/chaos/<target>`.

## 6. Root-cause pointers

* Recently bumped `version` on `/api/sre/services`.
* An armed chaos toggle nobody removed after a demo (`GET /api/sre/chaos`).
* Retry loops in clients turning one failure into many.

## 7. Escalation

Page the owning squad immediately, notify the duty incident commander, and open an incident
at Sev1 or above. Budget breaches are reviewed weekly by the reliability board.
