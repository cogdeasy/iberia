import { useEffect, useState } from 'react'
import type { PageMeta } from '../lib/pages'
import {
  getErrorBudget,
  listSlos,
  statusBadge,
  type ErrorBudget,
  type Slo,
} from '../lib/sre'

export const meta: PageMeta = {
  path: '/ops/slos',
  title: 'SLOs',
  section: 'ops',
  order: 11,
  roles: ['ops', 'sre', 'admin'],
}

function burnBadge(rate: number): string {
  if (rate >= 6) return 'crit'
  if (rate >= 1) return 'warn'
  return 'ok'
}

function budgetColour(remaining: number): string {
  if (remaining <= 10) return 'var(--crit)'
  if (remaining <= 50) return 'var(--warn)'
  return 'var(--ok)'
}

export default function SreSlosPage() {
  const [slos, setSlos] = useState<Slo[]>([])
  const [budgets, setBudgets] = useState<Record<string, ErrorBudget>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      listSlos()
        .then(async (rows) => {
          if (cancelled) return
          setSlos(rows)
          const results = await Promise.all(
            rows.map((slo) => getErrorBudget(slo.id).catch(() => null)),
          )
          if (cancelled) return
          const next: Record<string, ErrorBudget> = {}
          results.forEach((budget) => {
            if (budget) next[budget.slo_id] = budget
          })
          setBudgets(next)
        })
        .catch((err: Error) => setError(err.message))
    }
    load()
    const timer = setInterval(load, 20000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const breached = slos.filter((slo) => slo.status === 'breached').length
  const atRisk = slos.filter((slo) => slo.status === 'at_risk').length

  return (
    <>
      <section className="hero">
        <h1>Service level objectives</h1>
        <p>Objective vs achieved, error budget remaining and burn rates over 1h and 6h.</p>
      </section>

      {error && <div className="error">{error}</div>}

      <div className="grid cols-3">
        <div className="card">
          <div className="kpi-label">Objectives tracked</div>
          <div className="kpi">{slos.length}</div>
        </div>
        <div className="card">
          <div className="kpi-label">At risk</div>
          <div className="kpi">{atRisk}</div>
          <p className="muted">burning budget faster than plan</p>
        </div>
        <div className="card">
          <div className="kpi-label">Breached</div>
          <div className="kpi">{breached}</div>
          <p className="muted">objective already missed</p>
        </div>
      </div>

      <div className="card">
        <h3>Error budgets</h3>
        <table>
          <thead>
            <tr>
              <th>SLO</th>
              <th>Service</th>
              <th>Kind</th>
              <th>Objective</th>
              <th>Achieved</th>
              <th>Budget remaining</th>
              <th>Burn 1h</th>
              <th>Burn 6h</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {slos.map((slo) => {
              const budget = budgets[slo.id]
              const remaining = budget?.budget_remaining_pct ?? 0
              return (
                <tr key={slo.id}>
                  <td>
                    <strong>{slo.name}</strong>
                    <br />
                    <span className="muted">
                      <code>{slo.id}</code> · {slo.window_days}d window
                    </span>
                  </td>
                  <td>{slo.service}</td>
                  <td>
                    {slo.kind}
                    {slo.threshold_ms ? ` < ${slo.threshold_ms} ms` : ''}
                  </td>
                  <td>{slo.objective_pct.toFixed(2)}%</td>
                  <td>{slo.current_pct.toFixed(2)}%</td>
                  <td>
                    <div
                      style={{
                        background: 'var(--line)',
                        borderRadius: 999,
                        height: 8,
                        overflow: 'hidden',
                        marginBottom: 4,
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(Math.max(remaining, 0), 100)}%`,
                          background: budgetColour(remaining),
                          height: '100%',
                        }}
                      />
                    </div>
                    <span className="muted">{remaining.toFixed(1)}%</span>
                  </td>
                  <td>
                    <span className={`badge ${burnBadge(budget?.burn_rate_1h ?? 0)}`}>
                      {(budget?.burn_rate_1h ?? 0).toFixed(2)}x
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${burnBadge(budget?.burn_rate_6h ?? 0)}`}>
                      {(budget?.burn_rate_6h ?? 0).toFixed(2)}x
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${statusBadge(slo.status)}`}>{slo.status}</span>
                  </td>
                </tr>
              )
            })}
            {!slos.length && (
              <tr>
                <td colSpan={9} className="muted">
                  No SLOs defined.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="muted">
          A burn rate above 1x means the budget for the window will be exhausted before it ends;
          above 6x pages immediately (<code>ErrorBudgetBurnFast</code>).
        </p>
      </div>
    </>
  )
}
