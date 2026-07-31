import { useEffect, useState } from 'react'
import { ApiError, api, getUser } from '../lib/api'
import type { PageMeta } from '../lib/pages'
import { buildShareUrl, copyShareUrl, publishShareUrlToHistory } from '../lib/share'

export const meta: PageMeta = {
  path: '/support',
  title: 'Help',
  section: 'customer',
  nav: 'primary',
  order: 60,
}

interface SupportMessage {
  id: number
  author_email: string
  subject: string
  body_html: string
  channel: string
  resolved: boolean
  created_at: string
}

interface Preview {
  subject: string
  html: string
  rendered_by: string
}

interface Broadcast {
  id: number
  audience: string
  subject: string
  body_html: string
  sent_by: string
  created_at: string
}

interface PlatformConfig {
  env: string
  app_name: string
  cors_origins: string[]
  cors_allow_all: boolean
  jwt_ttl_minutes: number
  security_headers: Record<string, boolean>
}

const SAMPLE_REPLY =
  '<p>Dear passenger, your seats on <strong>IB3170</strong> have been re-assigned.</p>'

export default function SupportPage() {
  const user = getUser()
  const isAdmin = user?.role === 'admin'

  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [config, setConfig] = useState<PlatformConfig | null>(null)
  const [draft, setDraft] = useState(SAMPLE_REPLY)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [broadcastSubject, setBroadcastSubject] = useState('Operational update')
  const [broadcastBody, setBroadcastBody] = useState(
    '<p>Madrid–Barcelona services are running with delays this evening.</p>',
  )
  const [audience, setAudience] = useState('all')
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadInbox = () => {
    api<SupportMessage[]>('/api/platform/support/messages')
      .then(setMessages)
      .catch((err: ApiError) =>
        setError(err.status === 401 ? 'Sign in to see your support inbox.' : err.message),
      )
    api<Broadcast[]>('/api/platform/support/broadcasts')
      .then(setBroadcasts)
      .catch(() => setBroadcasts([]))
  }

  useEffect(() => {
    api<PlatformConfig>('/api/platform/config')
      .then(setConfig)
      .catch(() => setConfig(null))
    loadInbox()
  }, [])

  const renderPreview = async () => {
    setError(null)
    try {
      // The backend echoes the body back as HTML; we inject it below with
      // dangerouslySetInnerHTML. NOTE(demo): planted VULN-170 — reflected XSS sink.
      const result = await api<Preview>('/api/platform/support/preview', {
        method: 'POST',
        body: JSON.stringify({ subject: 'Preview', body: draft }),
      })
      setPreview(result)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const sendBroadcast = async () => {
    setError(null)
    setStatus(null)
    try {
      const created = await api<Broadcast>('/api/platform/support/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          subject: broadcastSubject,
          body: broadcastBody,
          audience,
        }),
      })
      setStatus(`Broadcast #${created.id} sent to "${created.audience}".`)
      loadInbox()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const share = async () => {
    // NOTE(demo): planted VULN-171 — puts the session JWT in the URL/history.
    const url = buildShareUrl('/support')
    setShareUrl(url)
    publishShareUrlToHistory(url)
    setShareCopied(await copyShareUrl(url))
  }

  return (
    <>
      <div className="page-head">
        <h1>Passenger support</h1>
        <p>Support inbox, reply composer and operational broadcasts for the Iberia contact centre.</p>
      </div>

      {error && <div className="error">{error}</div>}
      {status && <div className="notice">{status}</div>}

      <div className="grid cols-2">
        <div className="card">
          <h3>Your conversations</h3>
          {messages.length === 0 ? (
            <p className="muted">No support messages yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Channel</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => (
                  <tr key={message.id}>
                    <td>
                      <strong>{message.subject}</strong>
                      <br />
                      <span className="muted">{message.author_email}</span>
                    </td>
                    <td>{message.channel}</td>
                    <td>
                      <span className={`badge ${message.resolved ? 'ok' : 'warn'}`}>
                        {message.resolved ? 'resolved' : 'open'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3>Reply composer</h3>
          <div className="field">
            <label htmlFor="support-draft">Message body (rich text / HTML)</label>
            <textarea
              id="support-draft"
              rows={6}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </div>
          <button className="btn" onClick={renderPreview}>
            Render preview
          </button>{' '}
          <button className="btn ghost" onClick={share}>
            Share this page
          </button>
          {preview && (
            <>
              <h4 style={{ marginTop: 18 }}>Preview</h4>
              {/* NOTE(demo): planted VULN-170 — unsanitised server echo injected into the DOM */}
              <div
                className="notice"
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
              <p className="muted">rendered by {preview.rendered_by}</p>
            </>
          )}
          {shareUrl && (
            <p className="muted" style={{ wordBreak: 'break-all' }}>
              Share link {shareCopied ? '(copied to clipboard)' : ''}: <code>{shareUrl}</code>
            </p>
          )}
        </div>
      </div>

      {/* NOTE(demo): planted VULN-172 — client-side-only authorisation. The panel is hidden for
          non-admins, but POST /api/platform/support/broadcast has no role dependency. */}
      <div className="card" style={{ display: isAdmin ? 'block' : 'none' }}>
        <h3>
          Operations broadcast <span className="badge crit">admin only</span>
        </h3>
        <p className="muted">Sends a push/email broadcast to every passenger in the audience.</p>
        <div className="grid cols-3">
          <div className="field">
            <label htmlFor="broadcast-subject">Subject</label>
            <input
              id="broadcast-subject"
              value={broadcastSubject}
              onChange={(event) => setBroadcastSubject(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="broadcast-audience">Audience</label>
            <select
              id="broadcast-audience"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
            >
              <option value="all">all passengers</option>
              <option value="elite">Iberia Plus elite</option>
              <option value="disrupted">disrupted passengers</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="broadcast-body">Body</label>
            <input
              id="broadcast-body"
              value={broadcastBody}
              onChange={(event) => setBroadcastBody(event.target.value)}
            />
          </div>
        </div>
        <button className="btn gold" onClick={sendBroadcast}>
          Send broadcast
        </button>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Recent broadcasts</h3>
          {broadcasts.length === 0 ? (
            <p className="muted">Nothing sent yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Audience</th>
                  <th>Sent by</th>
                </tr>
              </thead>
              <tbody>
                {broadcasts.slice(0, 8).map((broadcast) => (
                  <tr key={broadcast.id}>
                    <td>{broadcast.subject}</td>
                    <td>
                      <span className="badge">{broadcast.audience}</span>
                    </td>
                    <td className="muted">{broadcast.sent_by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3>Platform posture</h3>
          {config ? (
            <>
              <p className="muted">
                env <code>{config.env}</code> · token TTL {config.jwt_ttl_minutes} min · CORS{' '}
                <code>{config.cors_allow_all ? '*' : config.cors_origins.join(', ')}</code>
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Security header</th>
                    <th>Present</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(config.security_headers).map(([header, present]) => (
                    <tr key={header}>
                      <td>
                        <code>{header}</code>
                      </td>
                      <td>
                        <span className={`badge ${present ? 'ok' : 'crit'}`}>
                          {present ? 'yes' : 'missing'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="muted">Platform config unavailable.</p>
          )}
        </div>
      </div>
    </>
  )
}
