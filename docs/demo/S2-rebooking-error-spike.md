# S2 — Irregular-ops rebooking error spike

| Field | Value |
|-------|-------|
| Scenario | S2 (SRE track) |
| Service | `irrops` — `POST /api/irrops/disruptions/{id}/rebook` |
| Symptom | Sustained HTTP 500s on rebooking; agents cannot re-accommodate disrupted passengers |
| Alert | `IrropsRebookingErrorRateHigh` (`ops/prometheus/rules/irrops.yml`) |
| Runbook | `docs/runbooks/IrropsRebookingErrorRateHigh.md` |
| Feature flag | `IBERIA_IRROPS_REBOOK_V2` |
| Blast radius | Every rebooking attempt during an irregular-ops event (all PNRs, all routes) |

The incident is a **latent bug behind a feature flag**, so it can be switched on and off live.
With the flag off the endpoint is healthy; with the flag on, the "v2 seat retention" code path
dereferences an attribute that itineraries never had, raising an unhandled `AttributeError`.

## 0. Prerequisites

```bash
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python seed.py            # 3 seeded disruptions + demo PNRs IB7QK2 / IB3ZT9 / IB5WD4
.venv/bin/uvicorn app.main:app --port 8000
```

Grab a token and note a disruption id:

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ops@iberia.demo","password":"Iberia2026!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

curl -s http://127.0.0.1:8000/api/irrops/disruptions -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool | head -20
```

## 1. Show the healthy baseline

```bash
curl -si -X POST http://127.0.0.1:8000/api/irrops/disruptions/1/rebook \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"pnr":"IB7QK2"}' | head -1
# HTTP/1.1 200 OK
```

## 2. Trigger the incident

Restart the API with the flag on (the flag is read per request, so a reload is enough):

```bash
IBERIA_IRROPS_REBOOK_V2=1 .venv/bin/uvicorn app.main:app --port 8000
```

Drive traffic so the error rate is unmistakable:

```bash
for i in $(seq 1 60); do
  curl -s -o /dev/null -X POST http://127.0.0.1:8000/api/irrops/disruptions/1/rebook \
    -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d '{"pnr":"IB7QK2"}'
done
```

Every request now returns `500 Internal Server Error`.

## 3. The alert / dashboard view (PromQL)

The `route` label is the concrete request path, so match the rebooking family with a regex.

Error rate on the rebooking endpoint (this is the alert expression):

```promql
sum(rate(iberia_http_requests_total{status="500",route=~"/api/irrops/disruptions/.+/rebook"}[5m]))
  /
sum(rate(iberia_http_requests_total{route=~"/api/irrops/disruptions/.+/rebook"}[5m]))
```

Supporting queries:

```promql
# raw 500 count on the irrops domain
sum by (route) (rate(iberia_http_requests_total{status="500",route=~"/api/irrops/.+"}[5m]))

# traffic is unchanged — this is an error, not a traffic, problem
sum(rate(iberia_http_requests_total{route=~"/api/irrops/disruptions/.+/rebook"}[5m]))

# rebooking business events stop being emitted while 500s climb
sum(rate(iberia_domain_events_total{domain="irrops",event="rebooked"}[5m]))

# latency is flat: the failure is fast, which rules out a dependency timeout
histogram_quantile(0.95,
  sum by (le) (rate(iberia_http_request_duration_seconds_bucket{route=~"/api/irrops/.+"}[5m])))
```

## 4. The logs

Logs are JSON on stdout — capture them first
(`IBERIA_IRROPS_REBOOK_V2=1 .venv/bin/uvicorn app.main:app --port 8000 2>&1 | tee api.log`).
Every response carries `x-request-id`; take it from a failing call and pivot on it:

```bash
RID=$(curl -s -o /dev/null -D - -X POST http://127.0.0.1:8000/api/irrops/disruptions/1/rebook \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"pnr":"IB7QK2"}' | tr -d '\r' | awk 'tolower($1)=="x-request-id:"{print $2}')

# in the uvicorn output (JSON lines)
grep "$RID" api.log | python3 -m json.tool
```

What to look for:

* `{"level":"ERROR","logger":"uvicorn.error", ...,"exception":"AttributeError: 'ItineraryView' object has no attribute 'cabin_class'"}`
* the access line from the middleware:
  `{"level":"INFO","logger":"iberia.access","msg":"POST /api/irrops/disruptions/1/rebook 500","route":"/api/irrops/disruptions/1/rebook","status":500,"duration_ms":<small>}`
* the absence of the success line `"msg":"pnr rebooked"` — a healthy request emits it with
  `pnr`, `from_flight`, `to_flight` and `compensation_eur`.

Useful greps:

```bash
grep -F '"status": 500' api.log | grep -F '/rebook'
grep -F 'cabin_class' api.log
grep -F '"msg": "rebooking v2 seat retention"' api.log   # never appears: it throws first
```

## 5. Code path to blame

```
backend/app/routers/irrops.py :: rebook()
  └── if rebook_v2_enabled():                 # reads IBERIA_IRROPS_REBOOK_V2
        cabin = itinerary.cabin_class.code    # ← AttributeError, unhandled → HTTP 500
```

`itinerary` is an `app.services.irrops.ItineraryView`, which exposes `cabin` (a plain string).
The v2 "seat retention" work assumed a richer `cabin_class` object that was never implemented,
and the flag shipped enabled in the environment.

## 6. Mitigation and fix

Immediate mitigation (seconds, no deploy) — turn the flag off and restart:

```bash
unset IBERIA_IRROPS_REBOOK_V2
```

One-line fix in `backend/app/routers/irrops.py`:

```diff
-        cabin = itinerary.cabin_class.code
+        cabin = itinerary.cabin
```

## 7. Demo talking points

* Alert → dashboard → logs → code → one-line fix in under five minutes.
* The failure is instant and total: 100 % of rebooking calls fail while traffic and latency
  look normal, which is exactly the shape of an unhandled-exception incident.
* Business impact is visible in `iberia_domain_events_total{domain="irrops",event="rebooked"}`
  flatlining — passengers stop being re-accommodated even though the ops board still loads.
