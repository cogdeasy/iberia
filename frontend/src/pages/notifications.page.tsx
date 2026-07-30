import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { PageMeta } from '../lib/pages'
import { api, ApiError } from '../lib/api'

export const meta: PageMeta = {
  path: '/ops/notifications',
  title: 'Notifications',
  section: 'ops',
  order: 40,
  roles: ['ops', 'sre', 'admin', 'agent'],
}

interface Notification {
  id: number
  pnr: string
  channel: string
  template: string
  status: string
  created_at: string
  body: string
}

interface QueueStatus {
  depth: number
  workers: number
  workers_busy: number
  oldest_age_seconds: number
  dlq_depth: number
  saturated: boolean
  retries_enabled: boolean
  processed_total: number
  failed_total: number
}

interface TemplateInfo {
  name: string
  subject: string
  channels: string[]
  variables: string[]
}

interface Webhook {
  id: number
  url: string
  event: string
  active: boolean
  last_status: string | null
}

interface Point {
  t: string
  depth: number
  busy: number
  dlq: number
}

const CHANNELS = ['email', 'sms', 'push']

function statusBadge(status: string): string {
  if (status === 'sent') return 'badge ok'
  if (status === 'failed') return 'badge crit'
  if (status === 'queued' || status === 'processing') return 'badge warn'
  return 'badge'
}

export default function NotificationsPage() {
  const [queue, setQueue] = useState<QueueStatus | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [series, setSeries] = useState<Point[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // send form
  const [pnr, setPnr] = useState('YXR7K2')
  const [template, setTemplate] = useState('delay_notice')
  const [channel, setChannel] = useState('email')
  const [customMessage, setCustomMessage] = useState('')

  // webhook form
  const [hookUrl, setHookUrl] = useState('https://partner.example/hook')
  const [hookEvent, setHookEvent] = useState('notification.sent')

  const seriesRef = useRef<Point[]>([])

  const refresh = useCallback(async () => {
    try {
      const [q, list] = await Promise.all([
        api<QueueStatus>('/api/notifications/queue'),
        api<Notification[]>('/api/notifications?limit=25'),
      ])
      setQueue(q)
      setNotifications(list)
      setError(null)
      const point: Point = {
        t: new Date().toLocaleTimeString(),
        depth: q.depth,
        busy: q.workers_busy,
        dlq: q.dlq_depth,
      }
      seriesRef.current = [...seriesRef.current, point].slice(-40)
      setSeries(seriesRef.current)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }, [])

  const loadWebhooks = useCallback(async () => {
    try {
      setWebhooks(await api<Webhook[]>('/api/notifications/webhooks'))
    } catch {
      /* non-fatal */
    }
  }, [])

  useEffect(() => {
    api<TemplateInfo[]>('/api/notifications/templates')
      .then(setTemplates)
      .catch(() => undefined)
    loadWebhooks()
    refresh()
    const id = setInterval(refresh, 2000)
    return () => clearInterval(id)
  }, [refresh, loadWebhooks])

  async function submitSend(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setNotice(null)
    try {
      const context: Record<string, string> = {}
      if (customMessage) context.custom_message = customMessage
      await api<Notification>('/api/notifications/send', {
        method: 'POST',
        body: JSON.stringify({ pnr, template, channel, context }),
      })
      setNotice(`Queued ${template} to ${pnr} via ${channel}.`)
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }

  async function submitWebhook(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api<Webhook>('/api/notifications/webhooks', {
        method: 'POST',
        body: JSON.stringify({ url: hookUrl, event: hookEvent }),
      })
      setNotice('Webhook registered.')
      loadWebhooks()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }

  async function testWebhook(id: number) {
    setError(null)
    try {
      const res = await api<{ status: string; response_snippet: string }>(
        `/api/notifications/webhooks/${id}/test`,
        { method: 'POST' },
      )
      setNotice(`Webhook ${id} test → ${res.status}: ${res.response_snippet.slice(0, 120)}`)
      loadWebhooks()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }

  async function toggleSaturation(enabled: boolean, burst = 0) {
    setError(null)
    try {
      await api<QueueStatus>('/api/notifications/queue/saturate', {
        method: 'POST',
        body: JSON.stringify({ enabled, burst }),
      })
      setNotice(enabled ? 'S3 saturation ENABLED — backlog will grow.' : 'Saturation disabled.')
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }

  async function drain() {
    setError(null)
    try {
      await api<QueueStatus>('/api/notifications/queue/drain', { method: 'POST' })
      setNotice('Queue and DLQ drained; saturation cleared.')
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }

  return (
    <>
      <section className="hero">
        <h1>Passenger Notifications</h1>
        <p>Delivery queue, templates, partner webhooks and the S3 saturation scenario.</p>
      </section>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <div className="grid cols-4">
        <div className="card">
          <div className="kpi-label">Queue depth</div>
          <div className="kpi">{queue?.depth ?? '…'}</div>
          <p className="muted">pending deliveries</p>
        </div>
        <div className="card">
          <div className="kpi-label">Workers busy</div>
          <div className="kpi">
            {queue ? `${queue.workers_busy}/${queue.workers}` : '…'}
          </div>
          <p className="muted">
            {queue?.saturated ? <span className="badge crit">saturated</span> : 'nominal'}
          </p>
        </div>
        <div className="card">
          <div className="kpi-label">Oldest age</div>
          <div className="kpi">{queue ? `${queue.oldest_age_seconds.toFixed(1)}s` : '…'}</div>
          <p className="muted">head-of-line wait</p>
        </div>
        <div className="card">
          <div className="kpi-label">Dead-letter queue</div>
          <div className="kpi">{queue?.dlq_depth ?? '…'}</div>
          <p className="muted">retries {queue?.retries_enabled ? 'on' : 'off'}</p>
        </div>
      </div>

      <div className="card">
        <h3>Queue depth over time</h3>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={series}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="t" minTickGap={40} />
            <YAxis />
            <Tooltip />
            <Line type="monotone" dataKey="depth" stroke="#d7192d" dot={false} name="depth" />
            <Line type="monotone" dataKey="dlq" stroke="#b45309" dot={false} name="dlq" />
            <Line type="monotone" dataKey="busy" stroke="#0f7b52" dot={false} name="busy" />
          </LineChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="btn" onClick={() => toggleSaturation(true, 200)}>
            Trigger S3 backlog
          </button>
          <button className="btn ghost" onClick={() => toggleSaturation(false)}>
            Stop saturation
          </button>
          <button className="btn gold" onClick={drain}>
            Drain queue
          </button>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Send a notification</h3>
          <form onSubmit={submitSend}>
            <div className="field">
              <label>PNR</label>
              <input value={pnr} onChange={(e) => setPnr(e.target.value)} required />
            </div>
            <div className="field">
              <label>Template</label>
              <select value={template} onChange={(e) => setTemplate(e.target.value)}>
                {templates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Channel</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value)}>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Custom message (optional)</label>
              <textarea
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                rows={2}
              />
            </div>
            <button className="btn" type="submit">
              Queue delivery
            </button>
          </form>
        </div>

        <div className="card">
          <h3>Partner webhooks</h3>
          <form onSubmit={submitWebhook}>
            <div className="field">
              <label>URL</label>
              <input value={hookUrl} onChange={(e) => setHookUrl(e.target.value)} required />
            </div>
            <div className="field">
              <label>Event</label>
              <input value={hookEvent} onChange={(e) => setHookEvent(e.target.value)} required />
            </div>
            <button className="btn" type="submit">
              Register webhook
            </button>
          </form>
          <table style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>URL</th>
                <th>Event</th>
                <th>Last</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {webhooks.map((w) => (
                <tr key={w.id}>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {w.url}
                  </td>
                  <td>{w.event}</td>
                  <td>{w.last_status ?? '—'}</td>
                  <td>
                    <button className="btn ghost" onClick={() => testWebhook(w.id)}>
                      Test
                    </button>
                  </td>
                </tr>
              ))}
              {webhooks.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No webhooks registered.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Recent notifications</h3>
        <table>
          <thead>
            <tr>
              <th>PNR</th>
              <th>Template</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {notifications.map((n) => (
              <tr key={n.id}>
                <td>{n.pnr}</td>
                <td>{n.template}</td>
                <td>{n.channel}</td>
                <td>
                  <span className={statusBadge(n.status)}>{n.status}</span>
                </td>
                <td className="muted">{new Date(n.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {notifications.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No notifications yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
