# IberiaChaosExperimentActive

## 1. Alert

| Field | Value |
|-------|-------|
| Expression | `iberia_chaos_active > 0` (the incidents API also derives it from `GET /api/sre/chaos`) |
| For | 1m |
| Severity | Sev3 (informational) |
| Service | the chaos target |
| Rule file | `ops/prometheus/rules/incidents-alerts.yml` |

## 2. Impact

No direct passenger impact by itself — but every other alert must be read in this context. An
active `latency`, `error`, `timeout`, `slow_query` or `saturation` experiment is deliberately
degrading a service, so treat correlated alerts as expected until the toggle is cleared.

## 3. Dashboards & queries

```bash
# which experiments are live
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/sre/chaos | python3 -m json.tool

# the same information as an alert, from the incidents API
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/incidents/alerts
```

Ops console: `/ops/alerts` (this alert appears per active target) and the SRE chaos panel.

## 4. Triage steps

1. List the active toggles and note `target`, `mode`, `magnitude` and `expires_at`.
2. Decide whether it is expected: a scheduled game day or a live demo. If nobody claims it,
   treat it as unauthorised configuration and clear it.
3. Cross-check the other firing alerts. If they all name the same target, the experiment is the
   cause — do not chase a code root cause.
4. Confirm the toggle has a TTL. A toggle with no expiry left behind after a demo is the usual
   reason this alert is still firing hours later.

## 5. Mitigations

* `DELETE /api/sre/chaos/{target}` clears one experiment; verify with `GET /api/sre/chaos`.
* Wait for `expires_at` if the experiment is intentional and time-boxed.

## 6. Root-cause pointers

* A demo or game day that ended without clearing its toggles.
* `POST /api/sre/chaos` called with a large `ttl_seconds`.

## 7. Escalation

1. Whoever owns the game day (check the incident channel).
2. On-call SRE (`sre@iberia.demo`) if the experiment is unclaimed.
