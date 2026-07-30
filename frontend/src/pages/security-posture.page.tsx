import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../lib/api'
import type { PageMeta } from '../lib/pages'

export const meta: PageMeta = {
  path: '/security',
  title: 'Security posture',
  section: 'security',
  order: 10,
  roles: ['admin', 'sre'],
}

interface Finding {
  id: string
  title: string
  severity: string
  cwe: string
  owasp: string
  location: string
  status: string
  description: string
  remediation: string
  domain: string
}

interface Posture {
  score: number
  total: number
  counts: { critical: number; high: number; medium: number; low: number }
  categories: { category: string; count: number }[]
}

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

const SEVERITY_COLOURS: Record<string, string> = {
  critical: '#b91c1c',
  high: '#d7192d',
  medium: '#f0b323',
  low: '#0f7b52',
}

function severityBadge(severity: string): string {
  if (severity === 'critical' || severity === 'high') return 'badge crit'
  if (severity === 'medium') return 'badge warn'
  return 'badge ok'
}

function scoreBadge(score: number): string {
  if (score >= 80) return 'badge ok'
  if (score >= 50) return 'badge warn'
  return 'badge crit'
}

export default function SecurityPosturePage() {
  const [posture, setPosture] = useState<Posture | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [severity, setSeverity] = useState<string>('all')
  const [selected, setSelected] = useState<Finding | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([api<Posture>('/api/security/posture'), api<Finding[]>('/api/security/findings')])
      .then(([posturePayload, findingPayload]) => {
        setPosture(posturePayload)
        setFindings(findingPayload)
        setError(null)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const severityData = useMemo(
    () =>
      SEVERITIES.map((name) => ({
        name,
        value: posture ? posture.counts[name] : 0,
      })).filter((entry) => entry.value > 0),
    [posture],
  )

  const categoryData = useMemo(
    () =>
      (posture?.categories ?? []).map((entry) => ({
        category: entry.category.split(/[–-]/)[0].trim() || entry.category,
        full: entry.category,
        count: entry.count,
      })),
    [posture],
  )

  const visible = useMemo(
    () => (severity === 'all' ? findings : findings.filter((f) => f.severity === severity)),
    [findings, severity],
  )

  return (
    <>
      <section className="hero">
        <h1>Security posture</h1>
        <p>
          Findings register parsed live from <code>docs/vulnerabilities/</code>, scored by
          severity and mapped to the OWASP Top 10 (2021).
        </p>
      </section>

      {error && <div className="error">{error}</div>}
      {loading && !error && <div className="notice">Loading findings register…</div>}

      <div className="grid cols-4">
        <div className="card">
          <div className="kpi-label">Posture score</div>
          <div className="kpi">{posture?.score ?? '–'}</div>
          <span className={scoreBadge(posture?.score ?? 0)}>
            {(posture?.score ?? 0) >= 80 ? 'acceptable' : 'needs work'}
          </span>
        </div>
        <div className="card">
          <div className="kpi-label">Open findings</div>
          <div className="kpi">{posture?.total ?? findings.length}</div>
          <p className="muted">across all domains</p>
        </div>
        <div className="card">
          <div className="kpi-label">Critical / High</div>
          <div className="kpi">
            {(posture?.counts.critical ?? 0) + (posture?.counts.high ?? 0)}
          </div>
          <p className="muted">remediate first</p>
        </div>
        <div className="card">
          <div className="kpi-label">OWASP categories hit</div>
          <div className="kpi">{posture?.categories.length ?? 0}</div>
          <p className="muted">of the 2021 top ten</p>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Findings by severity</h3>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={severityData} dataKey="value" nameKey="name" innerRadius={60} label>
                  {severityData.map((entry) => (
                    <Cell key={entry.name} fill={SEVERITY_COLOURS[entry.name] ?? '#6b7280'} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <h3>Findings by OWASP category</h3>
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData} layout="vertical" margin={{ left: 24 }}>
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="category" width={80} />
                <Tooltip formatter={(value: number) => [`${value} findings`, 'count']} />
                <Bar dataKey="count" fill="#d7192d" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Findings register</h3>
        <div className="field" style={{ maxWidth: 240 }}>
          <label htmlFor="severity-filter">Severity</label>
          <select
            id="severity-filter"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            <option value="all">All severities</option>
            {SEVERITIES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Title</th>
              <th>Domain</th>
              <th>Severity</th>
              <th>CWE</th>
              <th>OWASP</th>
              <th>Location</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((finding) => (
              <tr key={finding.id}>
                <td>{finding.id}</td>
                <td>{finding.title}</td>
                <td>{finding.domain || '–'}</td>
                <td>
                  <span className={severityBadge(finding.severity)}>{finding.severity}</span>
                </td>
                <td>{finding.cwe}</td>
                <td>{finding.owasp}</td>
                <td>
                  <code>{finding.location}</code>
                </td>
                <td>
                  <button className="btn ghost" onClick={() => setSelected(finding)}>
                    Detail
                  </button>
                </td>
              </tr>
            ))}
            {!visible.length && !loading && (
              <tr>
                <td colSpan={8} className="muted">
                  No findings for this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="card">
          <h3>
            {selected.id} — {selected.title}{' '}
            <span className={severityBadge(selected.severity)}>{selected.severity}</span>
          </h3>
          <p className="muted">
            {selected.cwe} · {selected.owasp} · <code>{selected.location}</code> · status{' '}
            {selected.status}
          </p>
          <h4>Description</h4>
          <pre>{selected.description || 'No description recorded.'}</pre>
          <h4>Intended remediation</h4>
          <pre>{selected.remediation || 'No remediation recorded.'}</pre>
          <button className="btn" onClick={() => setSelected(null)}>
            Close
          </button>
        </div>
      )}
    </>
  )
}
