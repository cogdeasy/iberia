import { useCallback, useEffect, useState } from 'react'
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
import {
  clockTime,
  getSignals,
  healthBadge,
  listServices,
  type Signals,
  type SreService,
} from '../lib/sre'

export const meta: PageMeta = {
  path: '/ops/reliability',
  title: 'Reliability',
  section: 'ops',
  order: 10,
  roles: ['ops', 'sre', 'admin'],
}

const WINDOWS = [15, 30, 60, 180]

export default function SreOverviewPage() {
  const [services, setServices] = useState<SreService[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [windowMinutes, setWindowMinutes] = useState(30)
  const [signals, setSignals] = useState<Signals | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listServices()
      .then((rows) => {
        setServices(rows)
        setSelected((current) => current ?? rows[0]?.name ?? null)
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  const refreshSignals = useCallback(() => {
    if (!selected) return
    getSignals(selected, windowMinutes)
      .then(setSignals)
      .catch((err: Error) => setError(err.message))
  }, [selected, windowMinutes])

  useEffect(() => {
    refreshSignals()
    const timer = setInterval(refreshSignals, 15000)
    return () => clearInterval(timer)
  }, [refreshSignals])

  const chartData = (signals?.series ?? []).map((point) => ({
    ...point,
    label: clockTime(point.ts),
    error_pct: Number((point.error_rate * 100).toFixed(3)),
  }))

  return (
    <>
      <section className="hero">
        <h1>Reliability console</h1>
        <p>Golden signals per service, computed from the live Prometheus registry.</p>
      </section>

      {error && <div className="error">{error}</div>}

      <div className="grid cols-4">
        <div className="card">
          <div className="kpi-label">Traffic</div>
          <div className="kpi">{signals ? signals.traffic_rpm.toFixed(0) : '…'}</div>
          <p className="muted">requests / minute</p>
        </div>
        <div className="card">
          <div className="kpi-label">Error rate</div>
          <div className="kpi">{signals ? `${(signals.error_rate * 100).toFixed(2)}%` : '…'}</div>
          <p className="muted">5xx share of requests</p>
        </div>
        <div className="card">
          <div className="kpi-label">Latency p95</div>
          <div className="kpi">{signals ? `${signals.latency_p95_ms.toFixed(0)} ms` : '…'}</div>
          <p className="muted">
            p50 {signals?.latency_p50_ms.toFixed(0) ?? '-'} ms · p99{' '}
            {signals?.latency_p99_ms.toFixed(0) ?? '-'} ms
          </p>
        </div>
        <div className="card">
          <div className="kpi-label">Saturation</div>
          <div className="kpi">{signals ? `${signals.saturation_pct.toFixed(0)}%` : '…'}</div>
          <p className="muted">of provisioned capacity</p>
        </div>
      </div>

      <div className="card">
        <h3>Service health</h3>
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Tier</th>
              <th>Owner</th>
              <th>Version</th>
              <th>Endpoints</th>
              <th>Health</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {services.map((service) => (
              <tr key={service.name}>
                <td>
                  <strong>{service.name}</strong>
                </td>
                <td>T{service.tier}</td>
                <td>{service.owner}</td>
                <td>
                  <code>{service.version}</code>
                </td>
                <td className="muted">{service.endpoints.join(', ')}</td>
                <td>
                  <span className={`badge ${healthBadge(service.health)}`}>{service.health}</span>
                </td>
                <td>
                  <button
                    className={service.name === selected ? 'btn' : 'btn ghost'}
                    onClick={() => setSelected(service.name)}
                  >
                    Signals
                  </button>
                </td>
              </tr>
            ))}
            {!services.length && (
              <tr>
                <td colSpan={7} className="muted">
                  No services registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>
          {selected ?? 'Service'} · last {windowMinutes} minutes{' '}
          {signals?.synthetic && <span className="badge warn">synthetic history</span>}
        </h3>
        <div className="field">
          <label htmlFor="sre-window">Window</label>
          <select
            id="sre-window"
            value={windowMinutes}
            onChange={(event) => setWindowMinutes(Number(event.target.value))}
          >
            {WINDOWS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes} minutes
              </option>
            ))}
          </select>
        </div>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis yAxisId="left" fontSize={11} />
              <YAxis yAxisId="right" orientation="right" fontSize={11} />
              <Tooltip />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="rpm"
                name="requests/min"
                stroke="#d7192d"
                dot={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="p95_ms"
                name="p95 ms"
                stroke="#1d4ed8"
                dot={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="error_pct"
                name="errors %"
                stroke="#b45309"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="muted">
          Refreshes every 15 seconds. Fire the load generator from the chaos console to fill the
          series with real traffic.
        </p>
      </div>
    </>
  )
}
