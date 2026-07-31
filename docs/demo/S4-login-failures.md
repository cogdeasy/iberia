# S4 — Customer login failures after a release

| Field | Value |
|-------|-------|
| Scenario | S4 (SRE track — incident response) |
| Service | `identity` — `POST /api/auth/login` |
| Symptom | Partial login outage: staff and newly registered customers get HTTP 500, loyalty members still sign in |
| Alert | `AuthLoginErrorRateHigh` (`ops/prometheus/rules/identity.yml`) |
| Runbook | `docs/runbooks/AuthLoginErrorRateHigh.md` |
| Feature flag | `IBERIA_AUTH_SESSION_V2` |
| Blast radius | Every account without an Iberia Plus number — all staff logins and every self-registered customer |

This is the scenario that mirrors a real digital-channel incident: a release goes out, the
happy path in staging looked fine, and in production a **cohort** of users cannot sign in. The
partial failure is deliberate — it is what makes the triage interesting, because capacity,
database and platform signals are all green.

Root cause: the v2 session cache is keyed by `user.iberia_plus_number`, which is `NULL` for
accounts created before the loyalty migration.
`backend/app/routers/identity.py` → `_store_session_v2()` → `AttributeError`.

## 0. Prerequisites

```bash
cd backend
.venv/bin/python seed.py
.venv/bin/uvicorn app.main:app --port 8000
```

Seeded cohorts:

| Account | Iberia Plus number | Behaviour with the flag on |
|---------|--------------------|----------------------------|
| `customer@iberia.demo` | `IB1234567` | 200 — signs in fine |
| `frequent@iberia.demo` | `IB7654321` | 200 — signs in fine |
| `agent@iberia.demo`, `ops@iberia.demo`, `sre@iberia.demo`, `admin@iberia.demo` | none | **500** |
| Anyone who registers during the demo | none | **500** |

## 1. Show the healthy baseline

```bash
for u in customer sre; do
  curl -s -o /dev/null -w "$u %{http_code}\n" -X POST http://127.0.0.1:8000/api/auth/login \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$u@iberia.demo\",\"password\":\"Iberia2026!\"}"
done
# customer 200
# sre 200
```

## 2. Ship the "release"

Restart the API with the flag on:

```bash
IBERIA_AUTH_SESSION_V2=1 .venv/bin/uvicorn app.main:app --port 8000 2>&1 | tee api.log
```

Drive sign-in traffic so the error ratio crosses the alert threshold:

```bash
for i in $(seq 1 40); do
  for u in customer frequent agent ops sre admin; do
    curl -s -o /dev/null -X POST http://127.0.0.1:8000/api/auth/login \
      -H 'content-type: application/json' \
      -d "{\"email\":\"$u@iberia.demo\",\"password\":\"Iberia2026!\"}"
  done
done
```

Two thirds of attempts now return 500. In the UI: sign out, then sign in as
`sre@iberia.demo` — the login page shows a server error while `customer@iberia.demo` works.

## 3. Detect

- **Alert:** `AuthLoginErrorRateHigh` (Sev1) fires after 2 minutes above 5%.
- **Metrics:** `sum by (status) (rate(iberia_http_requests_total{route="/api/auth/login"}[5m]))`
  shows the 500 step change; `iberia_domain_events_total{domain="identity",event="login"}` shows
  successful sign-ins collapsing to the loyalty cohort only.
- **SLO:** the identity availability SLO starts burning fast; check the error-budget page.

## 4. Triage (this is the part Devin drives)

Follow `docs/runbooks/AuthLoginErrorRateHigh.md`:

1. Confirm the blast radius — some accounts succeed, so this is not capacity or the database.
2. Correlate the step change with the deploy time.
3. Read the traceback in `api.log`: `AttributeError: 'NoneType' object has no attribute 'upper'`
   at `_store_session_v2`.
4. Read the code path:

```
POST /api/auth/login
  └── verify_password(...)                     # fine
  └── if session_cache_v2_enabled():           # reads IBERIA_AUTH_SESSION_V2
        └── _store_session_v2(user)
              └── user.iberia_plus_number.upper()   # NULL for pre-migration accounts
```

5. State the hypothesis out loud, then prove it with the two-account curl above.

## 5. Mitigate

```bash
unset IBERIA_AUTH_SESSION_V2
# restart the API — login recovers immediately, nothing to backfill
```

Record the mitigation time; MTTR for this scenario should be minutes, and the flag flip is the
mitigation, not the fix.

## 6. Fix and close out

Permanent fix (see the runbook for the patch): key the cache by `user.id`, keep the loyalty
number as optional metadata, and make a session-cache write failure non-fatal for
authentication. Add the regression test `backend/tests/test_login_outage_s4.py`, which logs in
an account with no Iberia Plus number.

Then close the loop in the app: declare the incident from the alert, add the timeline entries,
mark mitigation, resolve, and generate the postmortem from the Incidents page — the postmortem
carries the timeline, the root cause and the follow-up actions.

## 7. Talking points

- **MTTR:** detection is automatic (alert + SLO burn), triage is guided (runbook + traceback),
  mitigation is a flag flip. The long pole in real life is the human triage step — that is the
  part Devin takes.
- **Change failure rate:** the defect ships because no test covered the null-loyalty cohort.
  The permanent fix adds that test to CI, so the same class of regression cannot recur.
- **Cohort thinking:** "the site is down" is rarely true — the useful question is *which cohort*
  and *what do they have in common*. That is exactly what the two-account probe answers.
