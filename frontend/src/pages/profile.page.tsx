import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PageMeta } from '../lib/pages'
import { api, getToken, setSession, type SessionUser } from '../lib/api'

export const meta: PageMeta = { path: '/profile', title: 'Profile', section: 'customer', order: 2 }

interface Profile extends SessionUser {
  id: number
  is_active: boolean
  created_at: string
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [fullName, setFullName] = useState('')
  const [plusNumber, setPlusNumber] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!getToken()) {
      navigate('/login')
      return
    }
    api<Profile>('/api/auth/me')
      .then((me) => {
        setProfile(me)
        setFullName(me.full_name)
        setPlusNumber(me.iberia_plus_number ?? '')
      })
      .catch((err: Error) => setError(err.message))
  }, [navigate])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!profile) return
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const updated = await api<Profile>(`/api/users/${profile.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ full_name: fullName, iberia_plus_number: plusNumber || null }),
      })
      setProfile(updated)
      setSession(getToken() as string, updated)
      setNotice('Profile updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  if (!profile) {
    return (
      <div className="card">
        {error ? <div className="error">{error}</div> : <p className="muted">Loading profile…</p>}
      </div>
    )
  }

  return (
    <div className="grid cols-2">
      <div className="card">
        <h2>Your account</h2>
        <div className="grid cols-2">
          <div>
            <div className="kpi-label">Email</div>
            <p>{profile.email}</p>
          </div>
          <div>
            <div className="kpi-label">Role</div>
            <p>
              <span className="badge">{profile.role}</span>
            </p>
          </div>
          <div>
            <div className="kpi-label">Iberia Plus</div>
            <p>{profile.iberia_plus_number ?? '—'}</p>
          </div>
          <div>
            <div className="kpi-label">Status</div>
            <p>
              <span className={`badge ${profile.is_active ? 'ok' : 'crit'}`}>
                {profile.is_active ? 'active' : 'inactive'}
              </span>
            </p>
          </div>
        </div>
      </div>
      <div className="card">
        <h2>Edit profile</h2>
        {error && <div className="error">{error}</div>}
        {notice && <div className="notice">{notice}</div>}
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="full_name">Full name</label>
            <input
              id="full_name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="plus">Iberia Plus number</label>
            <input
              id="plus"
              value={plusNumber}
              onChange={(e) => setPlusNumber(e.target.value)}
              placeholder="IB0000000"
            />
          </div>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>
    </div>
  )
}
