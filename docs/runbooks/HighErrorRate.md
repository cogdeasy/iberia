# HighErrorRate

## 1. Alert

| Field | Value |
|-------|-------|
| Rule | `ops/prometheus/rules/platform.yml` → `HighErrorRate` |
| Expression | 5xx rate / total rate by `route` > `0.02` |
| For | 5m |
| Severity | critical |
| Fires on | any route, most often `/api/bookings`, `/api/payments`, `/api/irrops` |

## 2. Impact

Passengers see "something went wrong" on booking, payment or rebooking. Contact-centre
agents get failed servicing actions and start re-trying, which amplifies the load.

## 3. Dashboards & queries

* Console: `/ops/reliability` (pick the failing service), `/ops/slos` for budget impact.
* Error rate by route:
  ```promql
  sum(rate(iberia_http_requests_total{status=~"5.."}[5m])) by (route)
    / sum(rate(iberia_http_requests_total[5m])) by (route)
  ```
* Which status codes:
  ```promql
  sum(rate(iberia_http_requests_total[5m])) by (route, status)
  ```
* Logs for one failing request (JSON, one line per request):
  ```bash
  grep '"status": 5' backend/uvicorn.log | tail -20
  grep '"request_id": "<id>"' backend/uvicorn.log
  ```

## 4. Triage steps

1. Confirm the blast radius: is it one route or every route? Every route ⇒ jump to
   [TargetDown](TargetDown.md) / database checks.
2. Check whether a chaos toggle is armed (very common in demo environments):
   ```bash
   curl -s -H "Authorization: Bearer $SRE_TOKEN" http://127.0.0.1:8000/api/sre/chaos
   ```
   An `error` or `timeout` toggle on the failing dependency explains the alert outright.
3. Read the golden signals for the owning service:
   ```bash
   curl -s -H "Authorization: Bearer $SRE_TOKEN" \
     "http://127.0.0.1:8000/api/sre/services/payments-api/signals?window_minutes=30"
   ```
   Expect `error_rate` to match the alert value and `synthetic` to be `false` when real
   traffic is flowing.
4. Pick one failing `request_id` from the access log and follow it: the log line naming the
   dependency (`chaos error injected`, `payment provider ...`) is the root cause pointer.
5. Check `/readyz` — a database failure surfaces as 500s on every data-backed route.

## 5. Mitigations

* Stop the fault injection: `curl -X DELETE http://127.0.0.1:8000/api/sre/chaos/<target>`.
* Roll back the last deploy of the owning service (`version` on `/api/sre/services`).
* If a single downstream provider is failing, degrade gracefully rather than retry-storm.

## 6. Root-cause pointers

* `backend/app/services/chaos.py` — armed `error`/`timeout` toggle raises for the target.
* Unhandled exception paths in the owning router (rebooking and refund flows historically).
* Database file locked / missing (`IBERIA_DATABASE_URL`).

## 7. Escalation

Owning squad from `/api/sre/services` (`owner`) → platform SRE on-call → engineering manager
if a Sev1 lasts more than 30 minutes. Declare an incident with
`POST /api/incidents {title, severity, service, summary}`.
