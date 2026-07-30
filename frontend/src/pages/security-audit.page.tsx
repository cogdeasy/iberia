import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import type { PageMeta } from '../lib/pages'

export const meta: PageMeta = {
  path: '/security/audit',
  title: 'Audit trail',
  section: 'security',
  order: 11,
  roles: ['admin', 'sre'],
}

interface AuditEvent {
  id: number
  ts: string
  actor: string
  action: string
  target: string
  ip: string | null
  request_id: string | null
  outcome: string
}

function outcomeBadge(outcome: string): string {
  if (outcome === 'failure' || outcome === 'denied') return 'badge crit'
  if (outcome === 'accepted') return 'badge warn'
  return 'badge ok'
}

export default function SecurityAuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [outcome, setOutcome] = useState('')
  const [limit, setLimit] = useState(100)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (actor) params.set('actor', actor)
    if (action) params.set('action', action)
    if (outcome) params.set('outcome', outcome)
    setLoading(true)
    api<AuditEvent[]>(`/api/security/audit?${params.toString()}`)
      .then((payload) => {
        setEvents(payload)
        setError(null)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [actor, action, outcome, limit])

  useEffect(() => {
    load()
  }, [load])

  const distinctActors = useMemo(
    () => [...new Set(events.map((event) => event.actor))].sort(),
    [events],
  )

  return (
    <>
      <section className="hero">
        <h1>Audit trail</h1>
        <p>
          Every authenticated mutating request and every explicit <code>record_audit</code> call,
          correlated to the platform <code>request_id</code>.
        </p>
      </section>

      {error && <div className="error">{error}</div>}

      <div className="grid cols-4">
        <div className="card">
          <div className="kpi-label">Events shown</div>
          <div className="kpi">{events.length}</div>
          <p className="muted">newest first</p>
        </div>
        <div className="card">
          <div className="kpi-label">Distinct actors</div>
          <div className="kpi">{distinctActors.length}</div>
          <p className="muted">in this window</p>
        </div>
        <div className="card">
          <div className="kpi-label">Failed / denied</div>
          <div className="kpi">
            {events.filter((e) => e.outcome === 'failure' || e.outcome === 'denied').length}
          </div>
          <p className="muted">worth triaging</p>
        </div>
        <div className="card">
          <div className="kpi-label">Latest event</div>
          <div className="kpi" style={{ fontSize: 18 }}>
            {events[0] ? new Date(events[0].ts).toLocaleString() : '–'}
          </div>
          <p className="muted">{loading ? 'refreshing…' : 'up to date'}</p>
        </div>
      </div>

      <div className="card">
        <h3>Filters</h3>
        <div className="grid cols-4">
          <div className="field">
            <label htmlFor="filter-actor">Actor</label>
            <input
              id="filter-actor"
              value={actor}
              placeholder="admin@iberia.demo"
              onChange={(event) => setActor(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="filter-action">Action</label>
            <input
              id="filter-action"
              value={action}
              placeholder="auth.login"
              onChange={(event) => setAction(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="filter-outcome">Outcome</label>
            <select
              id="filter-outcome"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
            >
              <option value="">Any</option>
              <option value="success">success</option>
              <option value="accepted">accepted</option>
              <option value="failure">failure</option>
              <option value="denied">denied</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="filter-limit">Limit</label>
            <select
              id="filter-limit"
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            >
              {[25, 50, 100, 250, 500].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn" onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <div className="card">
        <h3>Events</h3>
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Outcome</th>
              <th>IP</th>
              <th>Request id</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{new Date(event.ts).toLocaleString()}</td>
                <td>{event.actor}</td>
                <td>
                  <code>{event.action}</code>
                </td>
                <td>{event.target || '–'}</td>
                <td>
                  <span className={outcomeBadge(event.outcome)}>{event.outcome}</span>
                </td>
                <td>{event.ip ?? '–'}</td>
                <td>
                  <code>{event.request_id ?? '–'}</code>
                </td>
              </tr>
            ))}
            {!events.length && !loading && (
              <tr>
                <td colSpan={7} className="muted">
                  No audit events match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
