# Runbook — NotificationQueueBacklogGrowing

## 1. Alert

* **Expression:**
  `iberia_notification_queue_depth > 100 and deriv(iberia_notification_queue_depth[5m]) > 0`
* **for:** `5m`
* **Severity:** warning
* **Service:** notifications (SRE scenario **S3**)
* **Source:** `ops/prometheus/rules/notifications.yml`

## 2. Impact

Passengers stop receiving delay notices, cancellation notices, boarding reminders and refund
confirmations, or receive them badly late. During irregular-ops (a storm, an ATC slot mess)
this is exactly when comms matter most, so contact-centre call volume spikes as passengers
chase information the platform failed to push.

## 3. Dashboards & queries

Ops console: **Operations & SRE → Notifications** (`/ops/notifications`) — the KPI tiles and
the "Queue depth over time" chart.

PromQL to run first:

```promql
# is the backlog growing, and how fast?
iberia_notification_queue_depth
deriv(iberia_notification_queue_depth[5m])

# are workers pinned?  (busy == total pool means no spare capacity)
iberia_notification_workers_busy

# is a retry storm feeding it?  (see the sibling DLQ alert)
iberia_notification_dlq_depth
```

Head-of-line latency (how stale the oldest queued item is) comes from the API:
`GET /api/notifications/queue` → `oldest_age_seconds`.

## 4. Triage steps

1. **Confirm the symptom.** `GET /api/notifications/queue`. Expect `depth` large and rising,
   `workers_busy == workers` (e.g. `3/3`), `oldest_age_seconds` climbing. Example from the
   reproduced incident: `depth=47 busy=3/3 dlq=0 oldest=6.0s` and climbing.
2. **Is this a deliberate demo/chaos toggle?** Check whether saturation was enabled:
   `saturated: true` in the queue payload, or an `iberia_domain_events_total{domain="notifications",event="saturation_toggled"}` bump. If so, this is scenario S3 being driven.
3. **Distinguish the two failure modes:**
   * `dlq_depth` high and rising too → retry storm (see `NotificationDLQGrowing`), deliveries
     are *failing*.
   * `dlq_depth` ~0 but `depth` high → workers are simply too slow / too few for the arrival
     rate (slow downstream provider or a send burst).
4. **Check the logs** for `iberia.notifications` `"notification delivery failed"` (WARNING)
   to see the failure reason (`delivery timeout (provider saturated)` in S3).

## 5. Mitigations (safe, short-term)

* **Turn off the driver first if it is chaos/S3:**
  `POST /api/notifications/queue/saturate {"enabled": false}`.
* **Stop the retry storm** so the backlog can actually drain:
  `POST /api/notifications/queue/saturate {"enabled": false, "retries_enabled": false}`.
* **Scale the worker pool:**
  `POST /api/notifications/queue/saturate {"enabled": false, "workers": 8}`.
* **Emergency drain** (drops queued + DLQ items — only when comms can be regenerated or are
  stale enough to be useless): `POST /api/notifications/queue/drain`.

## 6. Root-cause pointers

* `backend/app/services/notifications.py` — `NotificationQueue`:
  * the queue is **unbounded** (`deque` with no `maxlen`) and there is **no backpressure**
    on `enqueue`/`send`, so a burst or retry storm grows depth without limit
    (see `# planted S3 sink` around the `enqueue` method);
  * `_deliver()` sleeps ~1s and fails every send when `saturation` is on, pinning workers;
  * `_retry_loop()` re-enqueues the whole DLQ with no backoff and no max-retries cap.
* `backend/app/routers/notifications.py` — `saturate()` is the S3 trigger.

## 7. Durable fix / escalation

Durable fix: bound the queue and apply backpressure (reject/shed with 429 when full),
add exponential backoff + a max-retry cap + a poison-message quarantine to the DLQ, and make
the worker pool autoscale on `queue_depth`. See `docs/demo/S3-notification-backlog.md`.

Escalate to: **Notifications service owner** (primary on-call for `service=notifications`),
then the **SRE reliability rota** if the backlog threatens the wider platform.
