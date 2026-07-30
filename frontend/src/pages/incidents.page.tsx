import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { PageMeta } from '../lib/pages'
import { api } from '../lib/api'
import {
  type Incident,
  STATUSES,
  STATUS_LABELS,
  formatDuration,
  formatTime,
  listIncidents,
  severityClass,
  statusClass,
} from '../lib/incidents'

export const meta: PageMeta = {
  path: '/ops/incidents',
  title: 'Incidents',
  section: 'ops',
  order: 30,
  roles: ['ops', 'sre', 'admin'],
}

const SEVERITIES = [0, 1, 2, 3]

export default function IncidentsPage() {
  const [params, setParams] = useSearchParams()
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [title, setTitle] = useState('')
  const [service, setService] = useState('')
  const [severity, setSeverity] = useState(2)
  const [summary, setSummary] = useState('')
  const [alertName, setAlertName] = useState('')
  const [runbook, setRunbook] = useState('')

  const statusFilter = params.get('status') ?? ''

  const load = useCallback(() => {
    listIncidents(statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '')
      .then((data) => {
        setIncidents(data)
        setError(null)
      })
      .catch((err: Error) => setError(err.message))
  }, [statusFilter])

  useEffect(() => {
    load()
  }, [load])

  // "Declare incident from alert" on /ops/alerts links here with the fields prefilled.
  useEffect(() => {
    const fromAlert = params.get('alert')
    if (!fromAlert) return
    setAlertName(fromAlert)
    setTitle(params.get('title') ?? fromAlert)
    setService(params.get('service') ?? '')
    setSeverity(Number(params.get('severity') ?? 2))
    setSummary(params.get('summary') ?? '')
    setRunbook(params.get('runbook') ?? '')
  }, [params])

  const grouped = useMemo(
    () =>
      STATUSES.map((status) => ({
        status,
        items: incidents.filter((incident) => incident.status === status),
      })),
    [incidents],
  )

  async function declare(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const created = await api<Incident>('/api/incidents', {
        method: 'POST',
        body: JSON.stringify({
          title,
          severity,
          service,
          summary,
          alert_name: alertName || null,
          runbook: runbook || null,
        }),
      })
      setNotice(`${created.reference} declared as Sev${created.severity} on ${created.service}`)
      setTitle('')
      setSummary('')
      setService('')
      setAlertName('')
      setRunbook('')
      setSeverity(2)
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const openCount = incidents.filter((incident) => incident.status === 'open').length
  const sev1Count = incidents.filter((incident) => incident.severity <= 1).length

  return (
    <>
      <section className="hero">
        <h1>Incident board</h1>
        <p>Declare, triage and resolve incidents across the Iberia estate.</p>
      </section>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <div className="grid cols-4">
        <div className="card">
          <div className="kpi-label">Open</div>
          <div className="kpi">{openCount}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Sev0 / Sev1</div>
          <div className="kpi">{sev1Count}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Total shown</div>
          <div className="kpi">{incidents.length}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Filter</div>
          <select
            value={statusFilter}
            onChange={(event) => {
              const value = event.target.value
              setParams(value ? { status: value } : {})
            }}
          >
            <option value="">all statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Declare incident</h3>
          <form onSubmit={declare}>
            <div className="field">
              <label htmlFor="incident-title">Title</label>
              <input
                id="incident-title"
                value={title}
                required
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Checkout latency breach"
              />
            </div>
            <div className="field">
              <label htmlFor="incident-service">Service</label>
              <input
                id="incident-service"
                value={service}
                required
                onChange={(event) => setService(event.target.value)}
                placeholder="payments"
              />
            </div>
            <div className="field">
              <label htmlFor="incident-severity">Severity</label>
              <select
                id="incident-severity"
                value={severity}
                onChange={(event) => setSeverity(Number(event.target.value))}
              >
                {SEVERITIES.map((level) => (
                  <option key={level} value={level}>
                    Sev{level}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="incident-summary">Summary</label>
              <textarea
                id="incident-summary"
                rows={3}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="What is the customer impact?"
              />
            </div>
            {alertName && (
              <p className="muted">
                From alert <code>{alertName}</code>
              </p>
            )}
            <button className="btn" type="submit" disabled={submitting}>
              {submitting ? 'Declaring…' : 'Declare incident'}
            </button>
          </form>
        </div>

        <div className="card">
          <h3>Response expectations</h3>
          <table>
            <thead>
              <tr>
                <th>Severity</th>
                <th>Expectation</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <span className="badge crit">Sev0</span>
                </td>
                <td>Journey down · page duty manager · 5 min ack · comms every 15 min</td>
              </tr>
              <tr>
                <td>
                  <span className="badge crit">Sev1</span>
                </td>
                <td>Major degradation or SLO breach · page on-call · 10 min ack</td>
              </tr>
              <tr>
                <td>
                  <span className="badge warn">Sev2</span>
                </td>
                <td>Partial degradation with workaround · 1 h ack</td>
              </tr>
              <tr>
                <td>
                  <span className="badge">Sev3</span>
                </td>
                <td>Minor or cosmetic · next working day</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {grouped.map(({ status, items }) => (
        <div className="card" key={status}>
          <h3>
            {STATUS_LABELS[status]} <span className="muted">({items.length})</span>
          </h3>
          {items.length === 0 ? (
            <p className="muted">Nothing here.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Sev</th>
                  <th>Title</th>
                  <th>Service</th>
                  <th>Commander</th>
                  <th>Started</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {items.map((incident) => (
                  <tr key={incident.id}>
                    <td>
                      <Link to={`/ops/incidents/${incident.id}`}>{incident.reference}</Link>
                    </td>
                    <td>
                      <span className={severityClass(incident.severity)}>
                        Sev{incident.severity}
                      </span>
                    </td>
                    <td>{incident.title}</td>
                    <td>{incident.service}</td>
                    <td>{incident.commander ?? '—'}</td>
                    <td>{formatTime(incident.started_at)}</td>
                    <td>
                      <span className={statusClass(incident.status)}>
                        {formatDuration(incident.duration_minutes)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </>
  )
}
