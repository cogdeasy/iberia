# Iberia Digital Platform (demo)

Full-stack demo estate for **Iberia Airlines**, purpose-built for two demonstrations:

* **SRE** — golden-signal metrics, SLOs and error budgets, fault injection, alert rules,
  runbooks, incident lifecycle and an operations console.
* **Security** — a documented set of deliberately planted vulnerabilities that can be
  discovered, explained and remediated live.

> ⚠️ This repository intentionally contains insecure code. It is a demo fixture and must
> never be deployed to a real environment. See `docs/VULNERABILITIES.md`.

## Quick start

```bash
# backend  → http://127.0.0.1:8000  (docs at /docs)
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python seed.py
uvicorn app.main:app --reload --port 8000

# frontend → http://localhost:5173
cd frontend
npm install
npm run dev
```

Demo logins (password `Iberia2026!`): `customer@iberia.demo`, `agent@iberia.demo`,
`ops@iberia.demo`, `sre@iberia.demo`, `admin@iberia.demo`.

## Checks

```bash
cd backend  && ruff check . && pytest
cd frontend && npx ng lint && npx ng build
```

## Documentation

| File | Contents |
|------|----------|
| `SPEC.md` | domain-by-domain specification and demo requirements |
| `AGENTS.md` | conventions and file-ownership rules for contributors/agents |
| `docs/DEMO.md` | run-of-show for the SRE and security demos |
| `docs/VULNERABILITIES.md` | answer key for every planted vulnerability |
| `docs/runbooks/` | one runbook per alert rule |
| `ops/` | Prometheus rules, dashboards, compose files |

## Architecture

FastAPI backend (SQLAlchemy 2.0 + SQLite) with **auto-discovered routers**, and an Angular 18 +
TypeScript frontend of standalone components with **explicitly registered routes** in
`frontend/src/app/app.routes.ts` — backend domains plug in without editing shared registration
files, frontend pages need one route entry.
