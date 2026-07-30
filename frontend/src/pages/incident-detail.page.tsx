import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { PageMeta } from '../lib/pages'
import { api } from '../lib/api'
import {
  type Incident,
  TIMELINE_KINDS,
  type TimelineKind,
  formatDuration,
  formatTime,
  getIncident,
  runbookUrl,
  severityClass,
  statusClass,
} from '../lib/incidents'

export const meta: PageMeta = {
  // No `title`: reached from the incident board, so it stays out of the nav.
  path: '/ops/incidents/:id',
  section: 'ops',
  order: 31,
  roles: ['ops', 'sre', 'admin'],
}

interface Postmortem {
  incident_id: number
  markdown: string
}

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [incident, setIncident] = useState<Incident | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [kind, setKind] = useState<TimelineKind>('note')
  const [resolution, setResolution] = useState('')
  const [postmortem, setPostmortem] = useState<Postmortem | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!id) return
    getIncident(id)
      .then((data) => {
        setIncident(data)
        setError(null)
      })
      .catch((err: Error) => setError(err.message))
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function addEntry(event: React.FormEvent) {
    event.preventDefault()
    if (!id || !message.trim()) return
    setBusy(true)
    try {
      await api(`/api/incidents/${id}/timeline`, {
        method: 'POST',
        body: JSON.stringify({ kind, message }),
      })
      setMessage('')
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function transition(status: 'open' | 'mitigated' | 'resolved') {
    if (!id) return
    setBusy(true)
    try {
      const body: Record<string, string> = { status }
      if (status === 'resolved' && resolution.trim()) body.resolution = resolution
      await api(`/api/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function generatePostmortem() {
    if (!id) return
    setBusy(true)
    try {
      setPostmortem(await api<Postmortem>(`/api/incidents/${id}/postmortem`))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !incident) return <div className="error">{error}</div>
  if (!incident) return <p className="muted">Loading incident…</p>

  const runbookHref = runbookUrl(incident.runbook)

  return (
    <>
      <section className="hero">
        <h1>
          {incident.reference} · {incident.title}
        </h1>
        <p>
          {incident.service} · commander {incident.commander ?? 'unassigned'} ·{' '}
          {formatDuration(incident.duration_minutes)} elapsed
        </p>
      </section>

      {error && <div className="error">{error}</div>}

      <div className="grid cols-4">
        <div className="card">
          <div className="kpi-label">Severity</div>
          <div className="kpi">
            <span className={severityClass(incident.severity)}>Sev{incident.severity}</span>
          </div>
          <p className="muted">{incident.response_expectation}</p>
        </div>
        <div className="card">
          <div className="kpi-label">Status</div>
          <div className="kpi">
            <span className={statusClass(incident.status)}>{incident.status}</span>
          </div>
          <p className="muted">
            started {formatTime(incident.started_at)} · resolved{' '}
            {formatTime(incident.resolved_at)}
          </p>
        </div>
        <div className="card">
          <div className="kpi-label">SLO impact</div>
          <p>{incident.slo_impact ?? 'not assessed'}</p>
        </div>
        <div className="card">
          <div className="kpi-label">Runbook</div>
          {runbookHref ? (
            <p>
              <a href={runbookHref} target="_blank" rel="noreferrer">
                {incident.runbook}
              </a>
            </p>
          ) : (
            <p className="muted">no runbook linked</p>
          )}
          {incident.alert_name && (
            <p className="muted">
              alert <code>{incident.alert_name}</code>
            </p>
          )}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Timeline</h3>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Kind</th>
                <th>Author</th>
                <th>Entry</th>
              </tr>
            </thead>
            <tbody>
              {incident.timeline.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatTime(entry.ts)}</td>
                  <td>
                    <span className="badge">{entry.kind}</span>
                  </td>
                  <td>{entry.author}</td>
                  {/* NOTE(demo): planted VULN-130 — responder notes are rendered as raw HTML. */}
                  <td dangerouslySetInnerHTML={{ __html: entry.message }} />
                </tr>
              ))}
            </tbody>
          </table>

          <form onSubmit={addEntry} style={{ marginTop: 16 }}>
            <div className="field">
              <label htmlFor="entry-kind">Entry kind</label>
              <select
                id="entry-kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as TimelineKind)}
              >
                {TIMELINE_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="entry-message">Add to timeline</label>
              <textarea
                id="entry-message"
                rows={3}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Scaled workers 4 → 12, backlog draining"
              />
            </div>
            <button className="btn" type="submit" disabled={busy}>
              Add entry
            </button>
          </form>
        </div>

        <div className="card">
          <h3>Mitigation actions</h3>
          <p className="muted">{incident.summary}</p>
          <div className="field">
            <label htmlFor="resolution">Resolution note</label>
            <textarea
              id="resolution"
              rows={3}
              value={resolution || (incident.resolution ?? '')}
              onChange={(event) => setResolution(event.target.value)}
              placeholder="What made the system healthy again?"
            />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn gold"
              disabled={busy || incident.status === 'mitigated'}
              onClick={() => transition('mitigated')}
            >
              Mark mitigated
            </button>
            <button
              className="btn"
              disabled={busy || incident.status === 'resolved'}
              onClick={() => transition('resolved')}
            >
              Resolve incident
            </button>
            <button
              className="btn ghost"
              disabled={busy || incident.status === 'open'}
              onClick={() => transition('open')}
            >
              Re-open
            </button>
            <Link className="btn ghost" to="/ops/alerts">
              Firing alerts
            </Link>
            <Link className="btn ghost" to="/ops/incidents">
              Back to board
            </Link>
          </div>

          <h3 style={{ marginTop: 24 }}>Postmortem</h3>
          <button className="btn ghost" disabled={busy} onClick={generatePostmortem}>
            Generate postmortem
          </button>
          {postmortem && (
            <pre
              style={{
                marginTop: 12,
                maxHeight: 420,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                background: '#f8fafc',
                padding: 12,
                borderRadius: 6,
              }}
            >
              {postmortem.markdown}
            </pre>
          )}
        </div>
      </div>
    </>
  )
}
