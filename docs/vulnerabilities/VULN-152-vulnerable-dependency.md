# VULN-152 — Vulnerable/outdated dependency pinned (urllib3 1.26.4, CVE-2021-33503)

| Field | Value |
|-------|-------|
| ID | VULN-152 |
| Domain | platform |
| CWE | CWE-1104 (Use of Unmaintained Third Party Components) |
| OWASP Top 10 (2021) | A06:2021 – Vulnerable and Outdated Components |
| Severity | Medium |
| Location | `backend/requirements.txt:12-14` |
| Status | remediated |
| Introduced by | Workstream 12 — platform (`devin/iberia-platform`) |

## Remediation status

**Remediated** — `urllib3` is pinned to `2.7.0`, which clears all nine advisories the weekly SCA
sweep reported for 1.26.4 (`PYSEC-2021-108`/CVE-2021-33503, `PYSEC-2023-192`, `PYSEC-2023-212`,
`PYSEC-2026-141`, `PYSEC-2026-1994`/`-1995`/`-1996`/`-1998`/`-1999`). 1.26.20 would have closed
only four of them: the redirect, chained-`Content-Encoding` and streaming-API fixes exist on the
2.x line only. The history below is kept as the demo narrative.

## Description

`backend/requirements.txt` pinned `urllib3==1.26.4`, a legacy pin carried over from the retired
`ib-app-prod-02` estate (see `ops/legacy/deploy_notes.md`). That release is affected by:

* **CVE-2021-33503** (CVSS 7.5, high) — denial of service via catastrophic backtracking when
  `urllib3.util.parse_url` parses a URL with many leading `/` characters. Fixed in 1.26.5.

The pin is *inert* in this codebase — the backend uses `httpx`, and no module imports `urllib3` —
so the app boots, `pip install -r requirements-dev.txt` succeeds and `pytest` is green. It is
exactly the kind of stale transitive-style pin an SCA scan flags, and the remediation is a
one-line bump.

## Reproduction

Against the pre-remediation pin (`urllib3==1.26.4`):

```bash
# the vulnerable version is what actually gets installed
cd backend && .venv/bin/pip show urllib3 | head -2
# urllib3 1.26.4  →  CVE-2021-33503

# any SCA tool reports it, e.g.
.venv/bin/pip install pip-audit && .venv/bin/pip-audit -r requirements.txt

# reachability of the underlying weakness (ReDoS in the pinned library):
.venv/bin/python - <<'PY'
import time, urllib3.util
payload = "http://" + "/" * 4000 + "a"
start = time.perf_counter()
try:
    urllib3.util.parse_url(payload)
except Exception:
    pass
print("parse_url took", round(time.perf_counter() - start, 3), "s")
PY
```

Expected insecure result: `pip-audit` reports `urllib3 1.26.4 → GHSA-q2q7-5pp4-w6pg /
CVE-2021-33503 (fix: 1.26.5)`, and the parse timing grows super-linearly with the payload size.

## Blast radius

Low in the demo (the library is not on a request path), but the finding is real: if any future
workstream adds `requests`/`urllib3`-based outbound calls (webhooks, provider integrations — see
the notifications and payments domains), attacker-controlled URLs reach the vulnerable parser and
a single request can pin a worker's CPU, degrading the whole API.

## Intended remediation

* Bump to a maintained release (`urllib3>=2.2`, or `>=1.26.19` if 1.x is required) and remove the
  pin entirely if nothing needs it.
* Add dependency scanning to CI (`pip-audit`, Dependabot/Renovate) so stale pins fail the build.
* Do not carry pins forward from decommissioned hosts without re-review.

## Detection hints

* Grep: `urllib3==1.26.4` in `backend/requirements.txt`.
* `pip-audit`, `safety check`, `osv-scanner`, GitHub Dependabot alerts.
* `pip list --outdated` shows the gap between the pinned and current versions.
