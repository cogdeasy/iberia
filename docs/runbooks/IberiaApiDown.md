# IberiaApiDown

## Alert

| Field | Value |
|-------|-------|
| Expression | `up{job="iberia-backend"} == 0` |
| For | 2m |
| Severity | critical |
| Service | `iberia-api` |
| Rule file | `ops/prometheus/rules/platform.rules.yml` |

## Impact

Prometheus cannot scrape the backend. Either the API process is down — in which case the whole
customer estate (search, booking, check-in) returns connection errors — or only the scrape path
is broken and dashboards go blank while traffic is fine. Distinguish the two first.

## Dashboards & queries

* Grafana → **Iberia — Golden Signals** (traffic panel flatlines if the API is truly down).
* Prometheus → http://localhost:9090/targets — look at the `iberia-backend` target error.
* PromQL: `up{job="iberia-backend"}`, `sum(rate(iberia_http_requests_total[5m]))`.
* Logs: `{job="iberia-backend"} | json | level = "ERROR"` — the last lines before the gap.

## Triage steps

1. `curl -si http://127.0.0.1:8000/healthz` — expect `200 {"status":"ok",...}`.
   * connection refused → the process is down, go to 2.
   * 200 → the API is healthy, the *scrape* is broken, go to 4.
2. Check the process: `pgrep -af "uvicorn app.main:app"`. If missing, inspect the last log
   lines (`tail -50 logs/backend.log`) for a traceback at startup.
3. `curl -si http://127.0.0.1:8000/readyz` — a 500 here with `database` errors means SQLite is
   missing or corrupt; `make demo-reset` recreates and reseeds it.
4. Scrape-path checks: is the stack up (`docker compose -f ops/docker-compose.observability.yml ps`)?
   From inside the container: `docker exec iberia-prometheus wget -qO- http://host.docker.internal:8000/metrics | head`.
   A DNS failure means the `extra_hosts: host.docker.internal:host-gateway` mapping is missing.

## Mitigations

* Restart the API: `make backend` (or `scripts/dev.sh` for backend + frontend).
* If a bad seed/database is the cause: `make demo-reset`.
* If only Prometheus is broken, the customer path is unaffected — restart the stack with
  `make observability-down && make observability-up` and downgrade the incident severity.

## Root-cause pointers

* `backend/app/main.py` — startup lifespan (`create_all`) fails if the DB path is unwritable.
* `backend/app/core/config.py` — a bad `IBERIA_DATABASE_URL` breaks boot.
* `ops/prometheus/prometheus.yml` — target host/port, and `rule_files` syntax errors also
  prevent Prometheus from starting.

## Escalation

Platform on-call → SRE lead (`sre@iberia.demo`). Page the database owner only if `/readyz`
reports the database unreachable while `/healthz` is fine.
