import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PageMeta } from '../lib/pages'
import {
  type Alert,
  formatTime,
  listAlerts,
  runbookUrl,
  severityClass,
  sinceLabel,
} from '../lib/incidents'

export const meta: PageMeta = {
  path: '/ops/alerts',
  title: 'Alerts',
  section: 'ops',
  order: 29,
  roles: ['ops', 'sre', 'admin'],
}

function stateClass(state: string): string {
  if (state === 'firing') return 'badge crit'
  if (state === 'pending') return 'badge warn'
  return 'badge ok'
}

function declareLink(alert: Alert): string {
  const params = new URLSearchParams({
    alert: alert.name,
    title: `${alert.name} on ${alert.service}`,
    service: alert.service,
    severity: String(alert.severity),
    summary: alert.summary,
  })
  if (alert.runbook) params.set('runbook', alert.runbook)
  return `/ops/incidents?${params.toString()}`
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)

  const load = useCallback(() => {
    listAlerts()
      .then((data) => {
        setAlerts(data)
        setRefreshedAt(new Date().toISOString())
        setError(null)
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  useEffect(() => {
    load()
    const timer = window.setInterval(load, 15000)
    return () => window.clearInterval(timer)
  }, [load])

  const firing = alerts.filter((alert) => alert.state === 'firing')
  const pending = alerts.filter((alert) => alert.state === 'pending')

  return (
    <>
      <section className="hero">
        <h1>Alerts</h1>
        <p>
          Evaluated live from the API golden signals and any active chaos experiment, mirroring
          the rules in <code>ops/prometheus/rules/incidents-alerts.yml</code>.
        </p>
      </section>

      {error && <div className="error">{error}</div>}

      <div className="grid cols-3">
        <div className="card">
          <div className="kpi-label">Firing</div>
          <div className="kpi">{firing.length}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Pending</div>
          <div className="kpi">{pending.length}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Last evaluated</div>
          <p>{formatTime(refreshedAt)}</p>
          <button className="btn ghost" onClick={load}>
            Refresh now
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Alert instances</h3>
        {alerts.length === 0 ? (
          <p className="muted">
            No alerts. Everything is inside threshold — drive some errors or start a chaos
            experiment to make one fire.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Alert</th>
                <th>Sev</th>
                <th>State</th>
                <th>Service</th>
                <th>Since</th>
                <th>Summary</th>
                <th>Runbook</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => {
                const href = runbookUrl(alert.runbook)
                return (
                  <tr key={`${alert.name}-${alert.service}`}>
                    <td>{alert.name}</td>
                    <td>
                      <span className={severityClass(alert.severity)}>Sev{alert.severity}</span>
                    </td>
                    <td>
                      <span className={stateClass(alert.state)}>{alert.state}</span>
                    </td>
                    <td>{alert.service}</td>
                    <td>{sinceLabel(alert.since)}</td>
                    <td>{alert.summary}</td>
                    <td>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer">
                          runbook
                        </a>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <Link className="btn ghost" to={declareLink(alert)}>
                        Declare incident
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
