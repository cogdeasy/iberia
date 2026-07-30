# IrropsRebookingErrorRateHigh

## 1. Alert

| Field | Value |
|-------|-------|
| Rule file | `ops/prometheus/rules/irrops.yml` |
| Severity | Sev1 |
| Service | `irrops` (`POST /api/irrops/disruptions/{id}/rebook`) |
| For | 2m |
| Team | airline-operations |

```promql
sum(rate(iberia_http_requests_total{status="500",route=~"/api/irrops/disruptions/.+/rebook"}[5m]))
  /
clamp_min(sum(rate(iberia_http_requests_total{route=~"/api/irrops/disruptions/.+/rebook"}[5m])), 0.001)
  > 0.05
```

Related: `IrropsRebookingThroughputStalled` (Sev2) fires when rebooking traffic arrives but no
`rebooked` domain event is emitted.

## 2. Impact

Contact-centre agents and the ops console cannot move passengers off a delayed, diverted or
cancelled flight. During an irregular-ops event this is customer-facing within minutes:
re-accommodation queues build up, EU261 exposure grows, and agents fall back to manual
workarounds. The disruption board itself (`GET /api/irrops/disruptions`) keeps working, so the
blast radius is limited to the rebooking action.

## 3. Dashboards & queries

```promql
# error ratio (alert expression)
sum(rate(iberia_http_requests_total{status="500",route=~"/api/irrops/disruptions/.+/rebook"}[5m]))
  / clamp_min(sum(rate(iberia_http_requests_total{route=~"/api/irrops/disruptions/.+/rebook"}[5m])), 0.001)

# is the whole domain affected, or only rebooking?
sum by (route, status) (rate(iberia_http_requests_total{route=~"/api/irrops/.+"}[5m]))

# business throughput
sum(rate(iberia_domain_events_total{domain="irrops",event="rebooked"}[5m]))

# latency shape — flat p95 with 500s means unhandled exception, not a slow dependency
histogram_quantile(0.95,
  sum by (le) (rate(iberia_http_request_duration_seconds_bucket{route=~"/api/irrops/.+"}[5m])))
```

Logs (JSON, one object per line):

```bash
grep -F '/rebook' api.log | grep -F '"status": 500' | tail -5     # find a request_id
grep "<request_id>" api.log | python3 -m json.tool                # full story for one request
grep -F '"exception"' api.log | tail -3                           # stack traces
```

## 4. Triage steps

1. **Confirm the scope.** `sum by (route, status) (rate(iberia_http_requests_total{route=~"/api/irrops/.+"}[5m]))`.
   *Expected during this incident:* only `.../rebook` shows `status="500"`; `/api/irrops/disruptions`
   and `/api/irrops/compensation/...` stay `200`.
2. **Check the feature flag.** `env | grep IBERIA_IRROPS_REBOOK_V2` on the API host.
   *Expected:* `IBERIA_IRROPS_REBOOK_V2=1` — the v2 seat-retention path is enabled.
3. **Pull one failing request by id** and read the exception field.
   *Expected:* `AttributeError: 'ItineraryView' object has no attribute 'cabin_class'` from
   `app/routers/irrops.py`.
4. **Rule out data problems.** Retry a different PNR from the seed set (`IB7QK2`, `IB3ZT9`,
   `IB5WD4`). *Expected:* every PNR fails identically → code path, not data.
5. **Rule out dependencies.** `curl -s localhost:8000/readyz` and the latency query above.
   *Expected:* `{"status":"ready"}` and unchanged p95 → no database or provider involvement.
6. **Check for a recent chaos toggle** (`GET /api/sre/chaos`) to make sure this is not injected
   fault. *Expected:* no active toggle targeting `irrops`.

## 5. Mitigations

* **Primary (seconds):** unset the flag and restart the API —
  `unset IBERIA_IRROPS_REBOOK_V2 && systemctl restart iberia-api`. Rebooking recovers on the
  first request; no data repair is needed because the exception fires before any write.
* **If the flag is not set** and 500s persist, roll back to the previous API release.
* **Workaround for agents:** declare the disruption as usual and re-accommodate manually; the
  compensation calculator (`GET /api/irrops/compensation/{pnr}`) is unaffected, so EU261
  quotes can still be given to passengers.

## 6. Root-cause pointers

| Code path | Failure mode |
|-----------|--------------|
| `backend/app/routers/irrops.py` → `rebook()`, v2 branch behind `rebook_v2_enabled()` | dereferences `itinerary.cabin_class` which does not exist → unhandled `AttributeError` (scenario S2) |
| `backend/app/services/irrops.py` → `find_next_flight()` | returns `None` when a route has no later departure → `409`, not `500` |
| `backend/app/services/irrops.py` → `load_itinerary()` | booking domain absent/renamed models → itineraries resolve to `None` → `404` |
| `backend/app/services/irrops.py` → `move_itinerary()` | write failure after the booking domain changes its schema → `500` with a SQLAlchemy exception instead of `AttributeError` |

## 7. Escalation

1. Airline-operations on-call (owner of the `irrops` service).
2. Booking domain on-call if the exception references booking models rather than
   `ItineraryView` — the itinerary adapter is a cross-domain contract.
3. Incident commander via `POST /api/incidents` (Sev1) if rebooking is down for more than
   10 minutes during an active irregular-ops event.
