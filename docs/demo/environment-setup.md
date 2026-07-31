# Demo environment — bring-up and reset

Everything runs on one machine, offline. Ports used: **8000** API, **5173** frontend,
**9090** Prometheus, **3000** Grafana, **3100** Loki.

## 0. One-time setup

```bash
make setup            # backend venv + pip install -r requirements-dev.txt, npm install
cp .env.example backend/.env      # optional; all defaults are demo-safe
```

Requirements: Python 3.10+, Node 18+, Docker (only for the observability stack).

## 1. Bring-up order

| # | Step | Command | Verify |
|---|------|---------|--------|
| 1 | Seed the database | `make seed` | prints `seeded: <module>` per domain, idempotent |
| 2 | Observability stack | `make observability-up` | Grafana http://localhost:3000 (`admin` / `iberia-demo`) |
| 3 | Backend + frontend | `make dev` (or `make backend` / `make frontend` in two shells) | http://127.0.0.1:8000/docs, http://localhost:5173 |
| 4 | Smoke test | `make smoke` | PASS for `/healthz`, `/readyz`, `/metrics`; SKIP is fine for domains not merged yet |
| 5 | Prometheus target | http://localhost:9090/targets | `iberia-backend` is **UP** |
| 6 | Synthetic traffic | `cd backend && .venv/bin/python -m app.services.loadgen` *(reliability workstream; until it lands use the loop below)* | Golden-signals dashboard stops being empty |

Start the stack **before** the demo narrative so Prometheus has 10–15 minutes of history and the
rate/percentile panels are populated.

Fallback traffic generator if the reliability workstream's loadgen is not merged yet:

```bash
while true; do
  curl -s -o /dev/null http://127.0.0.1:8000/healthz
  curl -s -o /dev/null "http://127.0.0.1:8000/api/flights/search?origin=MAD&destination=BCN&date=2026-08-01"
  curl -s -o /dev/null http://127.0.0.1:8000/api/platform/config
  sleep 1
done
```

## 2. Logs into Loki

`make dev` / `make backend` tee the backend's JSON logs to `logs/backend.log`, which Promtail
tails (`ops/loki/promtail-config.yml`, bind-mounted at `/var/log/iberia`). In Grafana → Explore →
**Loki**:

```
{job="iberia-backend"} | json | status >= 500
{job="iberia-backend"} | json | duration_ms > 800
{job="iberia-backend"} | json | request_id = "<id from the x-request-id response header>"
```

If Explore shows no streams, check that `logs/backend.log` is growing and that the Promtail
container is running (`docker compose -f ops/docker-compose.observability.yml ps`).

## 3. Demo surfaces

| Surface | URL | Notes |
|---------|-----|-------|
| Customer + ops console | http://localhost:5173 | routes are registered in `src/app/app.routes.ts`; nav is grouped Travel / Operations & SRE / Security |
| Support console | http://localhost:5173/support | reply preview, share link, "admin only" broadcast panel (VULN-170/171/172) |
| API docs | http://127.0.0.1:8000/docs | every mounted router |
| Golden signals | http://localhost:3000/d/iberia-golden-signals | traffic, errors, latency p50/p95/p99, in-flight, per-route |
| SLO / burn | http://localhost:3000/d/iberia-slo | availability, error budget, 5m/1h/6h burn rates |
| Alerts | http://localhost:9090/alerts | rules from `ops/prometheus/rules/*.yml`, each with a runbook annotation |

Logins (password `Iberia2026!`): `customer@iberia.demo`, `frequent@iberia.demo`,
`agent@iberia.demo`, `ops@iberia.demo`, `sre@iberia.demo`, `admin@iberia.demo`.

## 4. Reset between demo runs

```bash
make demo-reset        # deletes backend/iberia.db, reseeds deterministically (SEED=42), clears logs/
```

Then, in order:

1. Restart the backend so SQLAlchemy reconnects to the new file (`Ctrl-C` on `make dev`, rerun).
2. Turn off any chaos toggles left enabled (`/api/sre/chaos`, or simply restart the API —
   toggles are in-process).
3. Reset dashboards: metrics are counters in the process, so restarting the API zeroes them.
   To also drop Prometheus/Loki history:
   `make observability-down && docker volume rm iberia-observability_prometheus-data iberia-observability_loki-data && make observability-up`.
4. Clear browser state — the session JWT lives in `localStorage` (`iberia.token`), and a
   `?session_token=` share URL from VULN-171 may still be in history.
5. Re-run `make smoke` and confirm the Prometheus target is UP before starting the next run.

A full reset takes about a minute; between back-to-back runs steps 1, 4 and 5 are usually enough.

## 5. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Prometheus target DOWN | backend not running, or `host.docker.internal` unmapped — the compose file sets `extra_hosts: host-gateway` for Linux |
| Grafana panels empty | no traffic yet (run the load generator) or the scrape has <2 samples for `rate()` |
| No log streams in Loki | backend started without the `tee` — use `make backend` / `make dev` |
| `make dev` exits immediately | dependencies missing → `make setup` |
| Port already in use | `IBERIA_BACKEND_PORT=8001 ./scripts/dev.sh`, or free the port |
| Frontend 404s on `/api/...` | `ng serve` proxy (`frontend/proxy.conf.json`) targets `127.0.0.1:8000`; the backend must listen there |
