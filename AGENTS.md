# AGENTS.md — Iberia Digital Platform

Read this file **before** writing any code. It exists so that many agents can work on this
repository in parallel without conflicting.

## What this repository is

A demonstration full-stack platform for **Iberia Airlines**, used for two demo tracks:

1. **SRE track** — golden-signal metrics, structured logs, SLOs, alert rules, synthetic
   incidents, runbooks, and a live operations console. Devin is shown triaging an incident
   end-to-end.
2. **Security track** — the codebase contains a set of **deliberately planted, documented
   vulnerabilities** so Devin can be shown finding, explaining and remediating them.

> The planted vulnerabilities are intentional and **must not be "fixed" opportunistically**.
> They are inventoried in `docs/VULNERABILITIES.md` (the answer key). If you add one, register
> it there. If you are asked to fix one, fix only the ones the task names.

## Stack

| Layer     | Tech |
|-----------|------|
| Backend   | Python 3.10, FastAPI, SQLAlchemy 2.0 (SQLite), PyJWT, passlib, prometheus-client |
| Frontend  | React 18 + TypeScript + Vite, react-router-dom, recharts |
| Tests     | pytest (backend), `npm run build` + eslint (frontend) |
| Lint      | `ruff check .` and `ruff format` (backend), eslint (frontend) |

## Layout

```
backend/
  app/
    main.py              # DO NOT EDIT — routers are auto-discovered
    db.py                # Base, engine, get_db
    core/config.py       # settings
    core/security.py     # hashing, JWT, current_user, require_roles
    core/observability.py# JSON logging, Prometheus metrics, middleware
    models/<domain>.py   # one module per domain; auto-imported
    schemas/<domain>.py  # pydantic models
    services/<domain>.py # optional business logic
    routers/<domain>.py  # must expose `router = APIRouter(prefix="/api/<domain>")`
    seeds/<domain>.py    # must expose `seed(db)` and `ORDER: int`
  tests/test_<domain>.py
  seed.py                # runs every seeder in ORDER
frontend/
  src/pages/<name>.page.tsx  # default export component + `export const meta: PageMeta`
  src/components/<Name>.tsx
  src/lib/                   # api client, page discovery (shared — edit with care)
docs/
ops/                     # prometheus rules, dashboards, compose files
```

## Golden rules for parallel work

1. **Never edit `backend/app/main.py`, `backend/seed.py`, or `frontend/src/App.tsx`.**
   Registration is automatic through discovery.
2. **Own your files.** Create new files under your domain name. Do not refactor other
   domains' files. Touching `models/core.py`, `core/security.py`, `lib/api.ts` or
   `lib/pages.ts` is allowed only for strictly additive changes, and only if unavoidable.
3. **Routers**: `router = APIRouter(prefix="/api/<domain>", tags=["<domain>"])`.
4. **Auth**: use `Depends(current_user)` / `Depends(require_roles("ops", "sre"))` from
   `app.core.security`. Do not invent a second auth mechanism.
5. **Metrics/logs**: use `record_domain_event(domain, event)` and `log_event(...)` from
   `app.core.observability` for anything demo-worthy.
6. **Seeders must be idempotent** — `python seed.py` is run repeatedly.
7. **Tests**: add `backend/tests/test_<domain>.py`. Fixtures available from `conftest.py`:
   `client`, `db`, `auth_headers(email)`, `demo_password`.
8. **Frontend pages** are discovered from `src/pages/**/*.page.tsx`; export
   `meta: PageMeta` with `path`, `title`, `section` (`customer` | `ops` | `security`) and
   `order`. Reuse the classes in `src/styles.css` (`card`, `grid cols-3`, `btn`, `badge`,
   `kpi`, `table`) rather than adding a CSS framework.
9. **No new heavyweight dependencies** without a strong reason. Frontend charts: `recharts`.

## Local development

```bash
cd backend && pip install -r requirements-dev.txt && python seed.py
uvicorn app.main:app --reload --port 8000
cd ../frontend && npm install && npm run dev      # http://localhost:5173 (proxies /api)
```

## Before you open a PR

```bash
cd backend && ruff check . && ruff format . && pytest
cd ../frontend && npm run lint && npm run build
```

Base every branch on `main`, keep the diff scoped to your domain, and describe in the PR
which SRE scenario or vulnerability the change supports.

## Demo personas (seeded, password `Iberia2026!`)

| Email | Role | Use |
|-------|------|-----|
| customer@iberia.demo | customer | booking, check-in, loyalty |
| frequent@iberia.demo | customer | Iberia Plus elite member |
| agent@iberia.demo | agent | contact-centre servicing |
| ops@iberia.demo | ops | disruption management |
| sre@iberia.demo | sre | reliability console, incidents |
| admin@iberia.demo | admin | everything |
