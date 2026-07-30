# TargetDown

## 1. Alert

| Field | Value |
|-------|-------|
| Rule | `ops/prometheus/rules/platform.yml` → `TargetDown` |
| Expression | `up{job="iberia-api"} == 0` |
| For | 2m |
| Severity | critical (page) |
| Fires on | the API process / instance, i.e. every service behind it |

## 2. Impact

Total outage of the digital channels: no search, no booking, no check-in. Airport staff fall
back to manual procedures and the contact centre queue grows within minutes.

## 3. Dashboards & queries

* Liveness and readiness:
  ```bash
  curl -s -i http://127.0.0.1:8000/healthz
  curl -s -i http://127.0.0.1:8000/readyz
  curl -s http://127.0.0.1:8000/metrics | head -5
  ```
* Scrape state:
  ```promql
  up{job="iberia-api"}
  changes(process_start_time_seconds{job="iberia-api"}[15m])
  ```
* Process logs (JSON): the last lines before the gap explain the crash.

## 4. Triage steps

1. Distinguish "process gone" from "scrape broken": if `/healthz` answers but Prometheus says
   `up == 0`, the problem is the scrape config or the network path, not the app.
2. `changes(process_start_time_seconds[15m]) > 0` ⇒ crash-looping. Read the traceback in the
   JSON logs (`"level": "ERROR"`, `exception` field).
3. `/healthz` ok but `/readyz` failing ⇒ database unreachable. Verify
   `IBERIA_DATABASE_URL` and that the SQLite file exists and is writable.
4. Check resource pressure — a `saturation` chaos toggle or a real memory leak can wedge the
   worker (see the notifications backlog scenario, S3).

## 5. Mitigations

* Restart the API: `uvicorn app.main:app --port 8000` (systemd/compose in the real estate).
* Roll back the last deploy if the process crashes on boot.
* Re-seed the database if it is missing: `cd backend && python seed.py`.
* Clear every chaos toggle before restarting so the fresh process starts clean.

## 6. Root-cause pointers

* Import-time exception in a newly added router (routers are auto-discovered at startup, so
  one bad module takes the whole app down).
* Missing/locked SQLite file.
* Out-of-memory kill after unbounded queue growth.

## 7. Escalation

Platform SRE on-call immediately, then the duty incident commander at Sev0. Notify the
airport-operations duty manager because manual fallback procedures may be needed.
