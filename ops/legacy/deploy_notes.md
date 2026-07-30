# Legacy deployment notes (ib-app-prod-02) — STALE, kept for reference

> Written during the 2025-11 migration off the old VM estate. Superseded by `ops/README.md`
> and the container build, but nobody has deleted it.
>
> NOTE(demo): planted VULN-153 — this file and `.env.backup` next to it are the deliberately
> "leaked config" finding. Every credential below is fake. Do not clean this directory up.

## Hosts

| Host | Role | Access |
|------|------|--------|
| ib-app-prod-02.eu-west-1.example.com | API + worker | `ssh iberia-deploy@ib-app-prod-02` (shared key in `~deploy/.ssh/id_rsa`) |
| ib-db-prod-02.eu-west-1.rds.example.com | PostgreSQL 14 | user `iberia_app`, password in `.env.backup` |
| ib-grafana-01 | Grafana 9 | admin / `iberia-demo` |

## Deploy procedure (old)

```bash
scp .env.backup iberia-deploy@ib-app-prod-02:/opt/iberia/.env      # source of truth for secrets
ssh iberia-deploy@ib-app-prod-02 'cd /opt/iberia && git pull && sudo systemctl restart iberia-api'
# smoke check
curl -s http://ib-app-prod-02:8000/healthz
```

The API ran as `root` under systemd with `--reload` still enabled from the staging unit file —
carried over into the container build in `ops/Dockerfile.backend` (see VULN-154).

## Break-glass

* Shared "ops" login for the admin console: `admin@iberia.demo` / `Iberia2026!`
* Database console: `psql "postgresql://iberia_app:Tr1p-M4drid-2025!@ib-db-prod-02.eu-west-1.rds.example.com:5432/iberia"`
* Payment provider dashboard API key: `pk_live_4d8f21ab9c7e46f0b3a5c81d6e2f9047`

## Known gaps at migration time

1. No HSTS/CSP/X-Frame-Options at the edge — the old nginx config was dropped and the
   replacement never added the header block (VULN-151).
2. CORS was widened to `*` for the airport kiosk pilot and never narrowed again (VULN-150).
3. `requirements.txt` still pins the 2019 dependency set on this host (VULN-152).
