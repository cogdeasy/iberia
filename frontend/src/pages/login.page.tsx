import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { PageMeta } from '../lib/pages'
import { api, setSession, type SessionUser } from '../lib/api'

export const meta: PageMeta = {
  path: '/login',
  title: 'Sign in',
  section: 'customer',
  nav: 'none',
  order: 1,
}

interface LoginResponse {
  access_token: string
  token_type: string
  user: SessionUser
}

const PERSONAS = [
  { email: 'customer@iberia.demo', label: 'Customer' },
  { email: 'frequent@iberia.demo', label: 'Iberia Plus elite' },
  { email: 'agent@iberia.demo', label: 'Contact centre' },
  { email: 'ops@iberia.demo', label: 'Operations' },
  { email: 'sre@iberia.demo', label: 'SRE' },
  { email: 'admin@iberia.demo', label: 'Admin' },
]

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('customer@iberia.demo')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const result = await api<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      setSession(result.access_token, result.user)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-split">
      <aside className="auth-aside">
        <div>
          <div className="hero-eyebrow">Iberia Plus</div>
          <h2>Your Avios travel further</h2>
          <p>
            Sign in to manage bookings, check in from 48 hours before departure and track your
            Avios balance and tier progress.
          </p>
        </div>
      </aside>

      <div className="auth-form">
        <h1>Sign in</h1>
        <p className="muted">Use your Iberia Plus number or the email on your booking.</p>
        {error && <div className="error">{error}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="card flat" style={{ marginTop: 20 }}>
          <div className="datum-label">Demo personas · password Iberia2026!</div>
          <div className="stack" style={{ marginTop: 10 }}>
            {PERSONAS.map((persona) => (
              <button
                key={persona.email}
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  setEmail(persona.email)
                  setPassword('Iberia2026!')
                }}
              >
                {persona.label}
              </button>
            ))}
          </div>
        </div>

        <p className="muted" style={{ marginTop: 16 }}>
          Not a member yet? <Link to="/loyalty">Join Iberia Plus</Link> and start earning Avios.
        </p>
      </div>
    </div>
  )
}
