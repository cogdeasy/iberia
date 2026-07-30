# IberiaApiHighErrorRatio

## Alert

| Field | Value |
|-------|-------|
| Expression | `iberia:http_error_ratio:rate5m > 0.05` |
| For | 5m |
| Severity | critical |
| Service | `iberia-api` |
| Rule file | `ops/prometheus/rules/platform.rules.yml` |

## Impact

More than 5 % of API requests return 5xx. Passengers see failed searches, failed payments or
"something went wrong" during check-in; agents see servicing errors in the contact centre.

## Dashboards & queries

* Grafana → **Iberia — Golden Signals** → *Request rate by status class*, *Error ratio*, and
  the per-route table (which route owns the errors).
* Grafana → **Iberia — SLOs & Error Budget Burn** → burn-rate panels for the paging decision.
* PromQL:
  ```promql
  topk(5, sum by (route) (rate(iberia_http_requests_total{status=~"5.."}[5m])))
  sum by (status) (rate(iberia_http_requests_total[5m]))
  ```
* Logs: `{job="iberia-backend"} | json | status >= 500` then group by `route`, and pull one
  `request_id` to follow a single failing request end-to-end.

## Triage steps

1. Identify the dominant route with the `topk` query above. A single route means a code path;
   all routes means a shared dependency (database, auth) or the API restarting.
2. Pull one failing `request_id` from Loki and read its `exception` field — the JSON formatter
   includes the traceback.
3. Check whether fault injection is on: `curl -s localhost:8000/api/sre/chaos -H "Authorization: Bearer <sre token>"`.
   A demo chaos toggle is the most common cause in this estate.
4. Check `/readyz` and recent deploys/commits touching the offending router.
5. Confirm the blast radius on the error-budget panel before deciding to page.

## Mitigations

* Disable the offending chaos toggle (`POST /api/sre/chaos` with the scenario disabled).
* Roll back the last change to the affected router.
* If the database is the shared cause, `make demo-reset` restores a clean seeded state.

## Root-cause pointers

* `backend/app/routers/<domain>.py` — unhandled exceptions surface as 500s.
* Irregular-ops rebooking is a known 500 source in the demo (scenario **S2**, see `docs/DEMO.md`).
* `backend/app/core/security.py` — token/role failures normally show as 401/403, not 5xx; a
  spike of 5xx here indicates a config problem (e.g. missing `IBERIA_JWT_SECRET`).

## Escalation

Owning domain on-call first (route → domain via the API prefix), then the SRE lead. Declare a
Sev1 incident via `/api/incidents` if the error ratio stays above 5 % for 15 minutes.
