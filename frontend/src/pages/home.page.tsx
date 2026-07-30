import { useEffect, useState } from 'react'
import type { PageMeta } from '../lib/pages'
import { api } from '../lib/api'
import { discoverPages } from '../lib/pages'

export const meta: PageMeta = { path: '/', title: 'Home', section: 'customer', order: 0 }

interface Health {
  status: string
  env: string
  service: string
}

export default function HomePage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pages = discoverPages().filter((page) => page.title)

  useEffect(() => {
    api<Health>('/healthz')
      .then(setHealth)
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <>
      <section className="hero">
        <h1>Iberia Digital Platform</h1>
        <p>Booking, airline operations and reliability engineering in one demo estate.</p>
      </section>

      <div className="grid cols-3">
        <div className="card">
          <div className="kpi-label">API health</div>
          <div className="kpi">
            {error ? <span className="badge crit">unreachable</span> : (health?.status ?? '…')}
          </div>
          <p className="muted">{error ?? `env: ${health?.env ?? '-'}`}</p>
        </div>
        <div className="card">
          <div className="kpi-label">Registered surfaces</div>
          <div className="kpi">{pages.length}</div>
          <p className="muted">auto-discovered pages</p>
        </div>
        <div className="card">
          <div className="kpi-label">Demo credentials</div>
          <p className="muted" style={{ marginBottom: 0 }}>
            <code>customer@iberia.demo</code> · <code>ops@iberia.demo</code> ·{' '}
            <code>sre@iberia.demo</code>
            <br />
            password <code>Iberia2026!</code>
          </p>
        </div>
      </div>
    </>
  )
}
