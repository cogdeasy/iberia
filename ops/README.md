# `ops/` — local observability stack

Prometheus + Grafana + Loki/Promtail for the Iberia demo. The application itself runs on the
**host** (uvicorn on `:8000`, Vite on `:5173`); only the observability stack is containerised.

## Bring it up

```bash
make observability-up            # or: docker compose -f ops/docker-compose.observability.yml up -d
make observability-down          # stops and removes the containers
```

Prometheus scrapes `host.docker.internal:8000/metrics` every 15 s, so start the backend
(`make backend`, or `make dev` for backend + frontend) before or after — the target simply
turns green once the API is up.

## URLs and login

| Service | URL | Notes |
|---------|-----|-------|
| Grafana | http://localhost:3000 | login `admin` / `iberia-demo` (anonymous viewer access is also enabled) |
| Prometheus | http://localhost:9090 | `/targets` shows the `iberia-backend` scrape target, `/alerts` the rules |
| Loki | http://localhost:3100 | queried through Grafana; `{job="iberia-backend"}` |
| Backend metrics | http://127.0.0.1:8000/metrics | `iberia_http_*`, `iberia_domain_events_total` |

Provisioned dashboards live in the **Iberia** folder:

* **Iberia — Golden Signals** (`iberia-golden-signals`) — traffic, error rate, latency
  p50/p95/p99, in-flight requests, per-route table and domain-event rates.
* **Iberia — SLOs & Error Budget Burn** (`iberia-slo`) — availability against a selectable
  SLO target, remaining error budget and multi-window burn rates (5 m / 1 h / 6 h).

## Logs

The backend logs JSON to stdout. `scripts/dev.sh` tees that into `logs/backend.log`, which is
bind-mounted read-only into Promtail (`../logs → /var/log/iberia`) and parsed into the
`level`, `logger`, `route` and `status` labels. If you start uvicorn by hand and want logs in
Loki:

```bash
mkdir -p logs
cd backend && uvicorn app.main:app --port 8000 2>&1 | tee -a ../logs/backend.log
```

Useful Grafana Explore queries:

```
{job="iberia-backend"} | json | status >= 500
{job="iberia-backend"} | json | route =~ "/api/bookings.*" | duration_ms > 800
sum by (route) (count_over_time({job="iberia-backend"} | json | status >= 500 [5m]))
```

## Layout

```
ops/
  docker-compose.observability.yml   pinned Prometheus / Grafana / Loki / Promtail
  prometheus/prometheus.yml          scrape config + rule_files glob
  prometheus/rules/                  one <domain>.rules.yml per workstream (see its README)
  loki/loki-config.yml               single-binary filesystem Loki
  loki/promtail-config.yml           tails ../logs/*.log, parses the JSON log lines
  grafana/provisioning/              datasources + dashboard provider
  grafana/dashboards/                dashboard JSON, auto-loaded every 30 s
  legacy/                            ⚠️ intentionally leaked demo config (see docs/vulnerabilities)
```

> Everything here is demo scaffolding: credentials are fake, retention is short, and
> `ops/legacy/` contains a **deliberately planted** finding. Never deploy it.
