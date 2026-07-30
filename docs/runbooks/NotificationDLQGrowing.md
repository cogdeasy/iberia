# Runbook — NotificationDLQGrowing

## 1. Alert

* **Expression:**
  `iberia_notification_dlq_depth > 20 and deriv(iberia_notification_dlq_depth[5m]) > 0`
* **for:** `5m`
* **Severity:** warning
* **Service:** notifications (SRE scenario **S3**)
* **Source:** `ops/prometheus/rules/notifications.yml`

## 2. Impact

Notification deliveries are failing and piling into the dead-letter queue. With retries
enabled, every failed item is re-enqueued onto the main queue with no backoff, so the DLQ and
the main queue amplify each other (a **retry storm**). Passengers miss delay/cancellation
notices; the failures also burn worker capacity that successful sends need.

## 3. Dashboards & queries

Ops console: **Operations & SRE → Notifications** (`/ops/notifications`) — the "Dead-letter
queue" KPI tile and the `dlq` line on the queue chart.

```promql
iberia_notification_dlq_depth
deriv(iberia_notification_dlq_depth[5m])

# the retry storm couples DLQ and main-queue growth:
iberia_notification_queue_depth
iberia_notification_workers_busy
```

## 4. Triage steps

1. `GET /api/notifications/queue` — expect `dlq_depth` > 20 and rising, `retries_enabled:
   true`, and `failed_total` climbing on each poll.
2. Read logs for `iberia.notifications` `"notification delivery failed"` (WARNING) and note
   the `last_error` on failed notifications (`GET /api/notifications` shows `status=failed`
   rows with `last_error`). In S3 this is `delivery timeout (provider saturated)`.
3. Decide whether the root cause is a **downstream provider outage** (email/SMS gateway) or
   the **injected saturation** (`saturated: true`).

## 5. Mitigations (safe, short-term)

* **Break the storm** by disabling retries so failed items stop feeding the main queue:
  `POST /api/notifications/queue/saturate {"enabled": false, "retries_enabled": false}`.
* Clear the injected fault if present:
  `POST /api/notifications/queue/saturate {"enabled": false}`.
* If the DLQ is full of genuinely undeliverable messages, **drain**:
  `POST /api/notifications/queue/drain` (drops DLQ + queue — confirm the messages are stale
  or can be regenerated first).
* Scale workers to work through a transient backlog:
  `POST /api/notifications/queue/saturate {"enabled": false, "workers": 8}`.

## 6. Root-cause pointers

* `backend/app/services/notifications.py`:
  * `_retry_loop()` — re-enqueues the **entire** DLQ every 250ms with **no backoff and no
    max-retry cap** (`# planted S3 sink`). This is the storm amplifier.
  * `_deliver()` — marks sends `failed` and appends to `_dlq` when saturated.
* `retries_enabled` / `set_retries()` is the toggle that stops the loop.

## 7. Durable fix / escalation

Durable fix: exponential backoff with jitter, a per-message max-retry count after which items
are quarantined (not re-enqueued), and dead-letter alerting on the *rate* of new failures
rather than raw depth. See `docs/demo/S3-notification-backlog.md`.

Escalate to: **Notifications service owner**, and the **provider/integration owner** if the
`last_error` points at an external email/SMS gateway rather than the injected fault.
