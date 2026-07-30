# IberiaApiHighErrorRate

## 1. Alert

| Field | Value |
|-------|-------|
| Expression | `sum(rate(iberia_http_requests_total{status=~"5.."}[5m])) / sum(rate(iberia_http_requests_total[5m])) > 0.05` |
| For | 5m |
| Severity | Sev1 |
| Service | `iberia-api` (label narrows to the affected domain router) |
| Rule file | `ops/prometheus/rules/incidents-alerts.yml` |

## 2. Impact

More than 1 in 20 API calls fails. Passengers see "something went wrong" on search, booking,
payment or check-in; contact-centre agents fall back to manual workarounds in the GDS. If the
failing route is `POST /api/bookings` or `POST /api/payments/authorise`, revenue is being lost
for the duration of the alert.

## 3. Dashboards & queries

```promql
# which route is failing
topk(5, sum by (route) (rate(iberia_http_requests_total{status=~"5.."}[5m])))

# error ratio per route
sum by (route) (rate(iberia_http_requests_total{status=~"5.."}[5m]))
  / sum by (route) (rate(iberia_http_requests_total[5m]))

# is it load-driven?
sum(rate(iberia_http_requests_total[5m]))
```

```bash
# structured logs for the failing route, newest first
grep '"status": 500' backend.log | tail -50 | python3 -m json.tool

# follow one failure end-to-end by correlation id
grep '"request_id": "<id>"' backend.log
```

Ops console: `/ops/alerts` → `/ops/incidents` (declare) → SRE signals page for the service.

## 4. Triage steps

1. `GET /api/incidents/alerts` — confirm the alert is `firing` (not `pending`) and note `since`.
2. Identify the failing route with the `topk` query above. Expected output: a single dominant
   route, not a uniform spread. A uniform spread points at the database or a shared dependency.
3. Check whether a chaos experiment is running: `GET /api/sre/chaos`. If `mode: "error"` is
   active on the failing target, this is an injected fault — stop here and disable it.
4. Check traffic. Flat traffic + rising errors = code or dependency fault. Rising traffic +
   rising errors = saturation; check `iberia_http_in_flight_requests`.
5. Pull one failing `request_id` from the logs and read the exception. Expected output: a
   stack trace naming the module that raised.
6. Check recent deploys/commits touching that module (`git log -20 --oneline -- backend/app`).

## 5. Mitigations

* Disable the offending chaos toggle: `DELETE /api/sre/chaos/{target}`.
* Turn off the feature flag or non-critical enrichment call in the failing path.
* Roll back the last deploy of the owning service if the error started at deploy time.
* If the failure is a dependency timeout, shorten the timeout and fail fast so the request
  queue drains rather than piling up.

## 6. Root-cause pointers

* `backend/app/routers/irrops.py` — rebooking with no alternative flight has historically
  raised an unhandled exception (demo scenario **S2**).
* `backend/app/routers/payments.py` — provider errors surfaced as 500 instead of 502.
* Any router that indexes into a list returned by a service without checking for emptiness.

## 7. Escalation

1. On-call SRE (`sre@iberia.demo`) — owns the alert.
2. Domain on-call for the failing router (payments / booking / irrops).
3. Duty manager if customer-facing impact exceeds 30 minutes or the alert becomes Sev0.
