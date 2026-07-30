# VULN-154 — Backend container runs as root with `--reload`/debug and a debugger port exposed

| Field | Value |
|-------|-------|
| ID | VULN-154 |
| Domain | platform |
| CWE | CWE-250 (Execution with Unnecessary Privileges) / CWE-489 (Active Debug Code) |
| OWASP Top 10 (2021) | A05:2021 – Security Misconfiguration |
| Severity | High |
| Location | `ops/Dockerfile.backend:14-38` |
| Introduced by | Workstream 12 — platform (`devin/iberia-platform`) |

## Description

The backend image inherits every bad habit of the retired VM deployment
(`ops/legacy/deploy_notes.md`):

| Line | Problem |
|------|---------|
| `FROM python:3.10` (14) | full ~1 GB base image with compilers and a shell, no digest pin |
| no `USER` instruction | the app process runs as **root** inside the container |
| `COPY . /app` (21) | the whole build context ships in the image — `.git`, local `.env` files and `ops/legacy/.env.backup` (VULN-153) |
| `pip install -r backend/requirements-dev.txt` (23) | test/lint tooling in a "production" image, widening the attack surface |
| `ENV IBERIA_JWT_SECRET=... PAYMENT_PROVIDER_API_KEY=...` (26-32) | secrets baked into image layers, readable via `docker history` / `docker inspect` |
| `ENV IBERIA_CORS_ORIGINS=*`, `IBERIA_LOG_LEVEL=DEBUG` (28-29) | ships VULN-150 on by default and logs verbosely |
| `EXPOSE 8000 5678` (36) | debugpy remote-debugger port left open — code execution to anyone who can reach it |
| `CMD [... "--reload", "--log-level", "debug"]` (40) | the autoreloader watches the writable app directory in production, so any file write becomes root code execution; FastAPI debug logging leaks internals |

There is also no healthcheck, no read-only root filesystem and no dropped capabilities.

## Reproduction

```bash
docker build -f ops/Dockerfile.backend -t iberia-api:demo .

# 1. running as root
docker run --rm iberia-api:demo id
# uid=0(root) gid=0(root) groups=0(root)

# 2. secrets baked into the layers, no container access needed
docker history --no-trunc iberia-api:demo | grep -o 'IBERIA_JWT_SECRET=[^ ]*'
docker inspect iberia-api:demo --format '{{json .Config.Env}}'

# 3. leaked credential file shipped inside the image
docker run --rm iberia-api:demo cat /app/ops/legacy/.env.backup

# 4. reload + debug port
docker run --rm -p 8000:8000 -p 5678:5678 iberia-api:demo &
docker exec -it $(docker ps -q -f ancestor=iberia-api:demo) \
  sh -c 'echo "# touch" >> /app/backend/app/routers/health.py'   # triggers a root-privileged reload
```

Expected insecure result: `uid=0`, the JWT secret and payment API key visible in image
metadata, `.env.backup` readable inside the image, and writing any watched file restarts the
server as root.

## Blast radius

A single RCE or file-write primitive in the app becomes root inside the container; with the
default docker socket/host mounts common in demo environments that is a host-level compromise.
The baked-in JWT secret allows token forgery for any role (chains with VULN-153), and the
exposed debugpy port is direct unauthenticated code execution if the port is reachable.

## Intended remediation

* Multi-stage build on `python:3.10-slim@sha256:...`; install only `requirements.txt`.
* Create and switch to a non-root user (`adduser --system iberia && USER iberia`), run with
  `--read-only`, `--cap-drop=ALL`, `no-new-privileges`.
* Add a `.dockerignore` (`.git`, `**/.env*`, `ops/legacy`, `node_modules`, `*.db`) and copy only
  `backend/`.
* Remove `--reload`/`--log-level debug`; set `--workers` and a `HEALTHCHECK` on `/healthz`.
* Inject secrets at runtime from a secret manager; never via `ENV` in the Dockerfile.
* Drop `EXPOSE 5678` and the `PYTHONBREAKPOINT` debugger hook.

## Detection hints

* Grep the Dockerfile for `--reload`, `EXPOSE 5678`, `COPY . `, `ENV .*SECRET`, and the absence
  of `USER`.
* Container linters: `hadolint ops/Dockerfile.backend`, `trivy config ops/`,
  `docker scout`, Checkov `CKV_DOCKER_3` (no USER) and `CKV_DOCKER_2` (no HEALTHCHECK).
