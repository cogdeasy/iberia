import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { PageMeta } from '../lib/pages'

export const meta: PageMeta = {
  path: '/ops/irrops',
  title: 'Irregular ops',
  section: 'ops',
  order: 20,
  roles: ['ops', 'admin', 'sre', 'agent'],
}

interface FlightOffer {
  flight_id: number
  flight_number: string
  origin: string
  destination: string
  scheduled_departure: string
  scheduled_arrival: string
  duration_minutes: number
  cabin: string
  fare_eur: number
  seats_available: number
  status: string
}

type DisruptionKind = 'delay' | 'cancellation' | 'diversion'

interface Disruption {
  id: number
  flight: FlightOffer
  kind: DisruptionKind
  minutes: number
  reason: string
  affected_passengers: number
  status: string
  created_at: string
}

interface RebookResult {
  pnr: string
  rebooked_to: FlightOffer
  compensation_eur: number
}

interface Compensation {
  pnr: string
  eligible: boolean
  regulation: string
  amount_eur: number
  rationale: string
}

const SEVERITY: Record<DisruptionKind, { label: string; badge: string }> = {
  delay: { label: 'Delay', badge: 'warn' },
  cancellation: { label: 'Cancellation', badge: 'crit' },
  diversion: { label: 'Diversion', badge: 'warn' },
}

function severityBadge(disruption: Disruption): string {
  if (disruption.kind === 'cancellation') return 'crit'
  if (disruption.kind === 'delay' && disruption.minutes >= 180) return 'crit'
  return SEVERITY[disruption.kind].badge
}

function clock(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function IrropsPage() {
  const [disruptions, setDisruptions] = useState<Disruption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [flightId, setFlightId] = useState('')
  const [kind, setKind] = useState<DisruptionKind>('delay')
  const [minutes, setMinutes] = useState('180')
  const [reason, setReason] = useState('')

  const [rebookPnr, setRebookPnr] = useState('')
  const [rebookTarget, setRebookTarget] = useState('')
  const [rebookResult, setRebookResult] = useState<RebookResult | null>(null)

  const [claimPnr, setClaimPnr] = useState('')
  const [claim, setClaim] = useState<Compensation | null>(null)

  const load = useCallback(() => {
    api<Disruption[]>('/api/irrops/disruptions')
      .then((rows) => {
        setDisruptions(rows)
        setError(null)
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  useEffect(load, [load])

  const affected = disruptions.reduce((sum, d) => sum + d.affected_passengers, 0)
  const cancellations = disruptions.filter((d) => d.kind === 'cancellation').length
  const worstDelay = disruptions.reduce((max, d) => Math.max(max, d.minutes), 0)

  async function declare(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const created = await api<Disruption>('/api/irrops/disruptions', {
        method: 'POST',
        body: JSON.stringify({
          flight_id: Number(flightId),
          kind,
          minutes: kind === 'cancellation' ? 0 : Number(minutes),
          reason,
        }),
      })
      setNotice(
        `Declared ${created.kind} on ${created.flight.flight_number} — ${created.affected_passengers} passengers affected.`,
      )
      setReason('')
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function rebook(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setRebookResult(null)
    try {
      const result = await api<RebookResult>(`/api/irrops/disruptions/${rebookTarget}/rebook`, {
        method: 'POST',
        body: JSON.stringify({ pnr: rebookPnr.trim().toUpperCase() }),
      })
      setRebookResult(result)
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function assess(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setClaim(null)
    try {
      setClaim(
        await api<Compensation>(`/api/irrops/compensation/${claimPnr.trim().toUpperCase()}`),
      )
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="hero">
        <h1>Irregular operations</h1>
        <p>
          Disruption board, passenger rebooking and EU 261/2004 compensation for the day of
          operations.
        </p>
      </section>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <div className="grid cols-4">
        <div className="card">
          <div className="kpi-label">Open disruptions</div>
          <div className="kpi">{disruptions.length}</div>
          <p className="muted">across the live schedule</p>
        </div>
        <div className="card">
          <div className="kpi-label">Cancellations</div>
          <div className="kpi">{cancellations}</div>
          <p className="muted">full re-accommodation required</p>
        </div>
        <div className="card">
          <div className="kpi-label">Passengers affected</div>
          <div className="kpi">{affected}</div>
          <p className="muted">sum of disrupted itineraries</p>
        </div>
        <div className="card">
          <div className="kpi-label">Worst delay</div>
          <div className="kpi">{worstDelay} min</div>
          <p className="muted">EU261 threshold is 180 min</p>
        </div>
      </div>

      <div className="card">
        <h2>Disruption board</h2>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Flight</th>
              <th>Route</th>
              <th>Departure</th>
              <th>Severity</th>
              <th>Minutes</th>
              <th>Affected</th>
              <th>Reason</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {disruptions.map((d) => (
              <tr key={d.id}>
                <td>{d.id}</td>
                <td>{d.flight.flight_number}</td>
                <td>
                  {d.flight.origin} → {d.flight.destination}
                </td>
                <td>{clock(d.flight.scheduled_departure)}</td>
                <td>
                  <span className={`badge ${severityBadge(d)}`}>{SEVERITY[d.kind].label}</span>
                </td>
                <td>{d.kind === 'cancellation' ? '—' : d.minutes}</td>
                <td>{d.affected_passengers}</td>
                <td className="muted">{d.reason}</td>
                <td>
                  <span className="badge">{d.status}</span>
                </td>
                <td>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setRebookTarget(String(d.id))
                      setNotice(`Disruption ${d.id} selected for rebooking.`)
                    }}
                  >
                    Rebook
                  </button>
                </td>
              </tr>
            ))}
            {!disruptions.length && (
              <tr>
                <td colSpan={10} className="muted">
                  No disruptions on the board.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid cols-3">
        <div className="card">
          <h3>Declare disruption</h3>
          <form onSubmit={declare}>
            <div className="field">
              <label htmlFor="irrops-flight">Flight id</label>
              <input
                id="irrops-flight"
                value={flightId}
                onChange={(e) => setFlightId(e.target.value)}
                placeholder="e.g. 1"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="irrops-kind">Kind</label>
              <select
                id="irrops-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as DisruptionKind)}
              >
                <option value="delay">Delay</option>
                <option value="cancellation">Cancellation</option>
                <option value="diversion">Diversion</option>
              </select>
            </div>
            {kind !== 'cancellation' && (
              <div className="field">
                <label htmlFor="irrops-minutes">Minutes</label>
                <input
                  id="irrops-minutes"
                  type="number"
                  min={1}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="irrops-reason">Reason</label>
              <input
                id="irrops-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Inbound rotation late"
              />
            </div>
            <button className="btn" disabled={busy}>
              Declare
            </button>
          </form>
        </div>

        <div className="card">
          <h3>Rebook a PNR</h3>
          <form onSubmit={rebook}>
            <div className="field">
              <label htmlFor="irrops-disruption">Disruption id</label>
              <input
                id="irrops-disruption"
                value={rebookTarget}
                onChange={(e) => setRebookTarget(e.target.value)}
                placeholder="select from the board"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="irrops-pnr">PNR</label>
              <input
                id="irrops-pnr"
                value={rebookPnr}
                onChange={(e) => setRebookPnr(e.target.value)}
                placeholder="IB7QK2"
                required
              />
            </div>
            <button className="btn" disabled={busy}>
              Find next flight &amp; rebook
            </button>
          </form>
          {rebookResult && (
            <div className="notice" style={{ marginTop: 12 }}>
              <strong>{rebookResult.pnr}</strong> moved to{' '}
              {rebookResult.rebooked_to.flight_number} ({rebookResult.rebooked_to.origin} →{' '}
              {rebookResult.rebooked_to.destination}) departing{' '}
              {clock(rebookResult.rebooked_to.scheduled_departure)}. Compensation exposure €
              {rebookResult.compensation_eur.toFixed(0)}.
            </div>
          )}
        </div>

        <div className="card">
          <h3>EU261 compensation calculator</h3>
          <form onSubmit={assess}>
            <div className="field">
              <label htmlFor="irrops-claim">PNR</label>
              <input
                id="irrops-claim"
                value={claimPnr}
                onChange={(e) => setClaimPnr(e.target.value)}
                placeholder="IB3ZT9"
                required
              />
            </div>
            <button className="btn gold" disabled={busy}>
              Assess claim
            </button>
          </form>
          {claim && (
            <div style={{ marginTop: 12 }}>
              <div className="kpi-label">{claim.regulation}</div>
              <div className="kpi">€{claim.amount_eur.toFixed(0)}</div>
              <span className={`badge ${claim.eligible ? 'crit' : 'ok'}`}>
                {claim.eligible ? 'payable' : 'not eligible'}
              </span>
              <p className="muted">{claim.rationale}</p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
