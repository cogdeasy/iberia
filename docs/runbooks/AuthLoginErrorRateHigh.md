# AuthLoginErrorRateHigh

## 1. Alert

| Field | Value |
|-------|-------|
| Rule file | `ops/prometheus/rules/identity.yml` |
| Severity | Sev1 |
| Service | `identity` (`POST /api/auth/login`) |
| For | 2m |
| Team | digital-channels |

```promql
sum(rate(iberia_http_requests_total{status="500",route="/api/auth/login"}[5m]))
  /
clamp_min(sum(rate(iberia_http_requests_total{route="/api/auth/login"}[5m])), 0.001)
  > 0.05
```

Related: `AuthLoginSuccessRateDropped` (Sev2) fires when login traffic arrives but the identity
domain emits no `login` events.

## 2. Impact

Sign-in is the front door of the digital channel. While it fails, customers cannot open
"My bookings", check in, or use the app, and contact-centre agents cannot open the servicing
desktop — so the call queue absorbs everything the website normally handles. Treat as Sev1 from
the first minute: this is the failure mode passengers and press notice fastest, and it hits both
OTP recovery workflows and NPS.

Flight operations, search and the ops console are unaffected: this is an authentication-path
failure, not a database or platform outage.

## 3. Dashboards & queries

```promql
# error ratio (alert expression)
sum(rate(iberia_http_requests_total{status="500",route="/api/auth/login"}[5m]))
  / clamp_min(sum(rate(iberia_http_requests_total{route="/api/auth/login"}[5m])), 0.001)

# is it only login, or the whole API?
sum by (route, status) (rate(iberia_http_requests_total{status="500"}[5m]))

# successful sign-ins per second — the business signal
sum(rate(iberia_domain_events_total{domain="identity",event="login"}[5m]))

# latency shape: flat p95 next to a 500 spike means an unhandled exception, not a slow dependency
histogram_quantile(0.95,
  sum by (le) (rate(iberia_http_request_duration_seconds_bucket{route="/api/auth/login"}[5m])))
```

Logs (JSON, one object per line) — correlate on `request_id`:

```bash
grep '"POST /api/auth/login HTTP/1.1" 500' api.log | tail -20
grep '"msg": "login success"' api.log | tail -5   # who is still getting through?
```

## 4. Triage

1. **Confirm the blast radius.** Is *every* login failing, or a subset?
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8000/api/auth/login \
     -H 'content-type: application/json' \
     -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}'
   curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8000/api/auth/login \
     -H 'content-type: application/json' \
     -d '{"email":"sre@iberia.demo","password":"Iberia2026!"}'
   ```
   A **partial** failure (some accounts 200, others 500) points at data shape, not capacity.
2. **Correlate with the last release.** Compare the alert start time with the deploy timeline.
   A step change at deploy time plus a 100% failure rate for one cohort is a code defect, not
   load.
3. **Check the feature flag.** `env | grep IBERIA_AUTH_SESSION_V2` on the API host.
   *Expected during this failure:* `IBERIA_AUTH_SESSION_V2=1` — the v2 session cache is enabled.
4. **Read the traceback.** The 500s come from `_store_session_v2` in
   `backend/app/routers/identity.py`:
   `AttributeError: 'NoneType' object has no attribute 'upper'` — the cache is keyed by
   `user.iberia_plus_number`, which is `NULL` for every account created before the loyalty
   migration (staff accounts and newly registered customers).
5. **Rule out the usual suspects** so the incident record is defensible: database reachable
   (`/readyz` is 200), no chaos experiment armed (`GET /api/sre/chaos`), error confined to one
   route.

## 5. Mitigation

- **Fastest (seconds, no deploy):** disable the flag and restart the API —
  `unset IBERIA_AUTH_SESSION_V2 && systemctl restart iberia-api`. Login recovers on the next
  request; nothing needs to be backfilled because the v2 cache is write-only today.
- **If the flag cannot be changed** (baked into the release): roll back to the previous image.
- **Do not** "fix" it by backfilling Iberia Plus numbers for staff accounts — that invents
  loyalty identities to work around a null-handling bug.

## 6. Permanent fix

Key the session cache by a value that always exists (`user.id`, or `user.email` normalised), and
treat the Iberia Plus number as optional metadata:

```python
def _store_session_v2(user: User) -> None:
    _SESSION_CACHE_V2[str(user.id)] = {
        "email": user.email,
        "role": user.role,
        "iberia_plus_number": user.iberia_plus_number,
    }
```

Add a regression test that logs in an account **without** an Iberia Plus number
(`backend/tests/test_login_outage_s4.py`), and make the session write non-fatal — a cache
failure should never fail authentication.

## 7. Post-incident actions

- Regression test for the null-loyalty cohort in CI (change failure rate).
- Alert on login success-rate drop, not only on 5xx ratio, so a silent failure is caught too.
- Progressive delivery for auth changes: canary the flag on 1% of sessions before fleet-wide.
- Feed the MTTA/MTTR for this incident into the digital-channel reliability review.
