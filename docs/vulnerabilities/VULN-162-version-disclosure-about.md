# VULN-162 — Unauthenticated build endpoint discloses versions and host details

| Field | Value |
|-------|-------|
| ID | VULN-162 |
| Domain | platform |
| CWE | CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor) |
| OWASP Top 10 (2021) | A05:2021 – Security Misconfiguration |
| Severity | Low |
| Location | `backend/app/routers/about.py:24-34 (GET /api/about)` |
| Introduced by | Branding & polish pass |

## Description

`GET /api/about` is public and returns the exact interpreter version, FastAPI and SQLAlchemy
versions, the kernel/platform string, the container hostname and the server's working
directory. None of it is needed by the frontend; all of it helps an attacker pick a matching
exploit (see VULN-152, the pinned vulnerable `urllib3`) and confirm the filesystem layout used
by the path-traversal finding (VULN-070).

## Reproduction

```bash
curl -s http://127.0.0.1:8000/api/about
```

Expected insecure result:

```json
{"app":"Iberia Digital Platform","env":"local","python":"3.10.x (main, ...)",
 "fastapi":"0.11x.x","sqlalchemy":"2.0.x","platform":"Linux-...-x86_64-with-glibc...",
 "hostname":"...","working_directory":"/.../backend"}
```

## Blast radius

Information disclosure only — no data or state is affected — but it removes the guesswork from
dependency-specific attacks and from building absolute paths for file-read primitives.

## Intended remediation

Either delete the endpoint or reduce it to a non-sensitive build identifier (git SHA and
deploy timestamp), and require an operator role for anything more. Never return
`platform.platform()`, `socket.gethostname()` or `os.getcwd()` to unauthenticated callers.

## Detection hints

- Grep for `platform.platform()`, `socket.gethostname()`, `os.getcwd()` and `__version__`
  inside `backend/app/routers/`.
- Any unauthenticated route whose response body contains a semantic version of a dependency.
