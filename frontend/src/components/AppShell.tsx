import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { SECTION_LABELS, type DiscoveredPage, type PageSection } from '../lib/pages'
import { clearSession, getUser, type SessionUser } from '../lib/api'
import Logo from './Logo'

const STAFF_SECTIONS: PageSection[] = ['ops', 'security']
const STAFF_ROLES = ['agent', 'ops', 'sre', 'admin']

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function AccountMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div className="account" ref={ref}>
      <button className="account-trigger" onClick={() => setOpen((v) => !v)}>
        <span className="avatar">{initials(user.full_name)}</span>
        {user.full_name.split(' ')[0]} ▾
      </button>
      {open && (
        <div className="account-menu">
          <div className="account-menu-head">
            <strong>{user.full_name}</strong>
            <span className="muted">
              {user.iberia_plus_number ? `Iberia Plus ${user.iberia_plus_number}` : user.email}
            </span>
          </div>
          <NavLink to="/profile">My profile</NavLink>
          <NavLink to="/bookings">My trips</NavLink>
          <NavLink to="/payments">Payments &amp; receipts</NavLink>
          <NavLink to="/loyalty">Avios balance</NavLink>
          <button onClick={clearSession}>Sign out</button>
        </div>
      )}
    </div>
  )
}

/**
 * Customer-facing chrome: iberia.com style header, primary travel navigation and footer.
 * Operations and security consoles are grouped into a separate staff strip that only
 * appears for internal roles.
 */
export default function AppShell({
  pages,
  children,
}: {
  pages: DiscoveredPage[]
  children: ReactNode
}) {
  const [user, setUser] = useState<SessionUser | null>(getUser())
  const location = useLocation()

  useEffect(() => {
    const sync = () => setUser(getUser())
    window.addEventListener('iberia:session', sync)
    return () => window.removeEventListener('iberia:session', sync)
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  const visible = (roles?: string[]) => !roles?.length || (user && roles.includes(user.role))
  const primary = pages.filter((page) => page.nav === 'primary' && page.title)
  const staff = user && STAFF_ROLES.includes(user.role)
  const isHome = location.pathname === '/'

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" aria-label="Iberia home">
            <Logo height={30} />
            <span className="brand-sub">España</span>
          </NavLink>
          <div className="topbar-actions">
            <span className="topbar-locale">Spain · English · EUR €</span>
            {user ? (
              <AccountMenu user={user} />
            ) : (
              <>
                <NavLink to="/login" className="btn light sm">
                  Sign in
                </NavLink>
                <NavLink to="/loyalty" className="btn outline-light sm">
                  Join Iberia Plus
                </NavLink>
              </>
            )}
          </div>
        </div>
      </header>

      <nav className="navbar">
        <div className="navbar-inner">
          {primary.map((page) => (
            <NavLink key={page.path} to={page.path} className="nav-link">
              {page.title}
            </NavLink>
          ))}
          {staff && (
            <div className="nav-staff">
              {STAFF_SECTIONS.map((section) => {
                const items = pages.filter(
                  (page) => page.section === section && page.title && visible(page.roles),
                )
                if (!items.length) return null
                return (
                  <div className="nav-staff-group" key={section}>
                    <span className="nav-staff-label">{SECTION_LABELS[section]}</span>
                    {items.map((page) => (
                      <NavLink key={page.path} to={page.path} className="nav-link">
                        {page.title}
                      </NavLink>
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </nav>

      <main className={isHome ? 'content flush' : 'content'} key={location.pathname}>
        {children}
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <div>
            <h4>Book</h4>
            <NavLink to="/flights">Flights</NavLink>
            <NavLink to="/flights">Destinations</NavLink>
            <NavLink to="/loyalty">Book with Avios</NavLink>
          </div>
          <div>
            <h4>Manage</h4>
            <NavLink to="/bookings">My trips</NavLink>
            <NavLink to="/checkin">Check-in</NavLink>
            <NavLink to="/payments">Payments &amp; receipts</NavLink>
          </div>
          <div>
            <h4>Iberia Plus</h4>
            <NavLink to="/loyalty">Avios &amp; tiers</NavLink>
            <NavLink to="/profile">My profile</NavLink>
            <NavLink to="/login">Sign in</NavLink>
          </div>
          <div>
            <h4>Help</h4>
            <NavLink to="/support">Help centre</NavLink>
            <NavLink to="/support">Baggage</NavLink>
            <NavLink to="/support">Disruptions &amp; EU261</NavLink>
          </div>
        </div>
        <div className="footer-note">
          Iberia Digital Platform · demo environment · not for production use
        </div>
      </footer>
    </div>
  )
}
