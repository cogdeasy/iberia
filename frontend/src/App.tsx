import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { SECTION_LABELS, discoverPages, type PageSection } from './lib/pages'
import { clearSession, getUser, type SessionUser } from './lib/api'

const SECTION_ORDER: PageSection[] = ['customer', 'ops', 'security']

export default function App() {
  const pages = discoverPages()
  const [user, setUser] = useState<SessionUser | null>(getUser())
  const location = useLocation()

  useEffect(() => {
    const sync = () => setUser(getUser())
    window.addEventListener('iberia:session', sync)
    return () => window.removeEventListener('iberia:session', sync)
  }, [])

  const visible = (roles?: string[]) => !roles?.length || (user && roles.includes(user.role))

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">IBERIA</span>
          <span className="brand-sub">Digital Platform</span>
        </div>
        <nav className="nav">
          {SECTION_ORDER.map((section) => {
            const items = pages.filter((p) => p.section === section && p.title && visible(p.roles))
            if (!items.length) return null
            return (
              <div className="nav-group" key={section}>
                <span className="nav-group-label">{SECTION_LABELS[section]}</span>
                {items.map((page) => (
                  <NavLink key={page.path} to={page.path} className="nav-link">
                    {page.title}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="session">
          {user ? (
            <>
              <span className="session-user">
                {user.full_name} · <em>{user.role}</em>
              </span>
              <button className="btn ghost" onClick={clearSession}>
                Sign out
              </button>
            </>
          ) : (
            <NavLink to="/login" className="btn">
              Sign in
            </NavLink>
          )}
        </div>
      </header>
      <main className="content" key={location.pathname}>
        <Routes>
          {pages.map(({ path, Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="footer">
        Iberia Digital Platform · demo environment · not for production use
      </footer>
    </div>
  )
}
