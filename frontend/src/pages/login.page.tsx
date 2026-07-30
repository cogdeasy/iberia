import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PageMeta } from '../lib/pages'
import { api, setSession, type SessionUser } from '../lib/api'

export const meta: PageMeta = { path: '/login', title: 'Sign in', section: 'customer', order: 1 }

interface LoginResponse {
  access_token: string
  token_type: string
  user: SessionUser
}

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
    <div className="grid cols-2">
      <section className="hero">
        <h1>Welcome to Iberia</h1>
        <p>Sign in to manage bookings, check in and track your Iberia Plus Avios.</p>
      </section>
      <div className="card">
        <h2>Sign in</h2>
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
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16 }}>
          Demo accounts use password <code>Iberia2026!</code>
        </p>
      </div>
    </div>
  )
}
