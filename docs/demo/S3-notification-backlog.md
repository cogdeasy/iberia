# SRE Scenario S3 — Notification queue saturation / backlog

> Saturation/leak incident: the passenger-notification delivery queue grows unbounded and
> exhausts the worker pool, so delay/cancellation notices stop going out. This is one of the
> three scripted, reproducible incidents required by `SPEC.md` (§3).

## One-line summary

An unbounded in-process queue with no backpressure, feeding a small pool of workers whose
deliveries are slow and failing, plus a DLQ that retries with no backoff — so `queue_depth`
and `oldest_age_seconds` climb without bound while `workers_busy` stays pinned.

## Owner module & code

* Engine: `backend/app/services/notifications.py` (`NotificationQueue`)
* API: `backend/app/routers/notifications.py`
* Gauges: `iberia_notification_queue_depth`, `iberia_notification_workers_busy`,
  `iberia_notification_dlq_depth`
* Alerts: `ops/prometheus/rules/notifications.yml`
* Runbooks: `docs/runbooks/NotificationQueueBacklogGrowing.md`,
  `docs/runbooks/NotificationDLQGrowing.md`

## Trigger (reproducible)

All calls need an `ops`/`sre`/`admin` bearer token. Until the identity workstream lands you
can mint one locally:

```bash
TOKEN=$(cd backend && .venv/bin/python -c \
  "from app.core.security import create_access_token; print(create_access_token('sre@iberia.demo','sre'))")
```

Start the incident — flip on saturation and inject a burst of 200 notifications:

```bash
curl -s -X POST http://127.0.0.1:8000/api/notifications/queue/saturate \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"enabled": true, "burst": 200}'
```

You can also drive it from the UI: **Operations & SRE → Notifications → "Trigger S3 backlog"**.

Watch it grow:

```bash
watch -n1 "curl -s http://127.0.0.1:8000/api/notifications/queue -H 'Authorization: Bearer $TOKEN'"
```

Observed (verified) progression — workers pinned, head-of-line age climbing:

```
depth=47 busy=3/3 dlq=0 oldest=2.0s
depth=47 busy=3/3 dlq=0 oldest=4.0s
depth=47 busy=3/3 dlq=0 oldest=6.0s
```

## Alert → dashboard → logs → code (the demo path)

1. **Alert fires:** `NotificationQueueBacklogGrowing` (and, once failures accumulate,
   `NotificationDLQGrowing`) from `ops/prometheus/rules/notifications.yml`.
2. **Dashboard:** `/ops/notifications` shows the depth/DLQ/busy chart climbing and the KPI
   tiles going red (`saturated`).
3. **PromQL:**
   ```promql
   iberia_notification_queue_depth
   deriv(iberia_notification_queue_depth[5m])   # > 0, backlog is growing
   iberia_notification_workers_busy             # == pool size, no spare capacity
   iberia_notification_dlq_depth                # retry storm indicator
   ```
   The gauges are exported live at `GET /metrics`:
   ```
   iberia_notification_queue_depth 47.0
   iberia_notification_workers_busy 3.0
   iberia_notification_dlq_depth 0.0
   ```
4. **Logs (JSON):** `iberia.notifications` emits `"notification delivery failed"` (WARNING)
   with `attempts` incrementing — the retry storm is visible as the same notification IDs
   failing repeatedly.
5. **Code:** the three planted sinks in `backend/app/services/notifications.py`:
   * **unbounded queue + no backpressure** — `deque()` with no `maxlen`; `enqueue()` never
     rejects, so a burst or retries grow depth without limit;
   * **pinned workers** — `_deliver()` sleeps ~1s and fails every send while saturated;
   * **retry storm** — `_retry_loop()` re-enqueues the entire DLQ every 250ms with no backoff
     and no max-retry cap.

## What the ops console shows

* KPI tiles: **Queue depth** high and rising, **Workers busy** `3/3` with a red `saturated`
  badge, **Oldest age** climbing (seconds → tens of seconds), **DLQ** rising once retries
  storm.
* The "Queue depth over time" line chart trends up and does not recover while the fault is on.
* The recent-notifications table shows rows stuck in `queued`/`failed`.

## Mitigation (during the incident)

In escalating order (also in the runbooks):

```bash
# 1. stop the injected fault
curl -s -X POST .../queue/saturate -d '{"enabled": false}'                       # clear saturation
# 2. stop the retry storm so the queue can drain
curl -s -X POST .../queue/saturate -d '{"enabled": false, "retries_enabled": false}'
# 3. add capacity
curl -s -X POST .../queue/saturate -d '{"enabled": false, "workers": 8}'
# 4. last resort: drop the backlog (stale comms)
curl -s -X POST .../queue/drain
```

## Durable fix (what a reviewer should propose)

1. **Bound the queue and apply backpressure** — cap depth; when full, shed load (HTTP 429 on
   `send`) or spill to durable storage rather than growing memory without limit.
2. **Fix the retry policy** — exponential backoff with jitter, a per-message max-retry count,
   and a poison-message quarantine so the DLQ never re-feeds the main queue in a tight loop.
3. **Autoscale / right-size workers** — scale the pool on `queue_depth`/`oldest_age_seconds`
   and add a delivery timeout + circuit breaker around the (simulated) provider so one slow
   dependency cannot pin every worker.
4. **Alert on rate, not just depth** — page on sustained positive `deriv()` and rising
   `oldest_age_seconds`, which catch the leak earlier than a static threshold.
