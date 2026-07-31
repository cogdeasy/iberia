import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PageMeta } from '../lib/pages'
import { api, ApiError, getToken } from '../lib/api'

export const meta: PageMeta = {
  path: '/checkin',
  title: 'Check-in',
  section: 'customer',
  nav: 'primary',
  order: 30,
}

interface Passenger {
  id: number
  first_name: string
  last_name: string
  seat: string | null
  checked_in: boolean
  document_number: string
}

interface Reservation {
  pnr: string
  flight_number: string
  origin: string
  destination: string
  scheduled_departure: string
  cabin: string
  gate: string
  contact_email: string
  passengers: Passenger[]
}

interface BoardingPass {
  pnr: string
  passenger_id: number
  passenger_name: string
  flight_number: string
  origin: string
  destination: string
  boarding_time: string
  gate: string
  seat: string
  sequence: number
  barcode: string
  qr_payload: string
  document_number: string
  document_filename: string
}

interface BagReceipt {
  bag_tag: string
  fee_eur: number
  weight_kg: number
  passenger_id: number
  pnr: string
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

/** Renders the BCBP string as a deterministic set of stripes — enough for the demo. */
function Barcode({ value }: { value: string }) {
  const bars = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < value.length; i += 1) {
      out.push((value.charCodeAt(i) % 3) + 1)
    }
    return out
  }, [value])

  return (
    <div aria-label={`barcode ${value}`}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 1, height: 56 }}>
        {bars.map((weight, index) => (
          <span
            key={`${index}-${weight}`}
            style={{
              width: weight,
              background: index % 2 === 0 ? '#1b1b1f' : 'transparent',
              display: 'block',
            }}
          />
        ))}
      </div>
      <code className="muted" style={{ fontSize: 10, wordBreak: 'break-all' }}>
        {value}
      </code>
    </div>
  )
}

/** The document endpoint needs the bearer token, so fetch it and hand back a blob URL. */
async function openDocument(filename: string): Promise<void> {
  const token = getToken()
  const response = await fetch(`/api/checkin/documents/${filename}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) throw new ApiError(`Document unavailable (${response.status})`, response.status, null)
  const url = URL.createObjectURL(await response.blob())
  window.open(url, '_blank', 'noopener')
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

function BoardingPassCard({
  boarding,
  onDocumentError,
}: {
  boarding: BoardingPass
  onDocumentError: (err: unknown) => void
}) {
  return (
    <div className="boarding-pass">
      <div className="boarding-pass-main">
        <div className="boarding-pass-head">
          <div>
            <div className="datum-label">Passenger</div>
            <strong>{boarding.passenger_name}</strong>
          </div>
          <span className="badge ok">checked in</span>
        </div>

        <div className="boarding-pass-grid">
          <div>
            <div className="datum-label">Flight</div>
            <div className="datum-value">{boarding.flight_number}</div>
          </div>
          <div>
            <div className="datum-label">Route</div>
            <div className="datum-value">
              {boarding.origin} → {boarding.destination}
            </div>
          </div>
          <div>
            <div className="datum-label">Boarding</div>
            <div className="datum-value">{formatTime(boarding.boarding_time)}</div>
          </div>
          <div>
            <div className="datum-label">Sequence</div>
            <div className="datum-value">{String(boarding.sequence).padStart(4, '0')}</div>
          </div>
        </div>

        <Barcode value={boarding.barcode} />

        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          Document <code>{boarding.document_number}</code> · QR{' '}
          <code>{boarding.qr_payload}</code>
          {boarding.document_filename ? (
            <>
              {' · '}
              <button
                className="btn ghost sm"
                onClick={() => {
                  openDocument(boarding.document_filename).catch(onDocumentError)
                }}
              >
                Download {boarding.document_filename}
              </button>
            </>
          ) : null}
        </p>
      </div>

      <div className="boarding-pass-stub">
        <div>
          <div className="datum-label">Seat</div>
          <div className="stub-code">{boarding.seat}</div>
        </div>
        <div>
          <div className="datum-label">Gate</div>
          <div className="stub-code">{boarding.gate}</div>
        </div>
      </div>
    </div>
  )
}

export default function CheckinPage() {
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [pnr, setPnr] = useState('')
  const [reservation, setReservation] = useState<Reservation | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [boardingPasses, setBoardingPasses] = useState<BoardingPass[]>([])
  const [bags, setBags] = useState<BagReceipt[]>([])
  const [bagPassenger, setBagPassenger] = useState<number | null>(null)
  const [bagWeight, setBagWeight] = useState('20')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsLogin, setNeedsLogin] = useState(false)

  const report = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) {
      setNeedsLogin(true)
      setError(null)
      return
    }
    setError(err instanceof Error ? err.message : String(err))
  }, [])

  useEffect(() => {
    api<Reservation[]>('/api/checkin/reservations')
      .then((rows) => {
        setReservations(rows)
        setPnr((current) => current || rows[0]?.pnr || '')
      })
      .catch(report)
  }, [report])

  const loadReservation = useCallback(
    async (code: string) => {
      if (!code) return
      setBusy(true)
      setError(null)
      try {
        const found = await api<Reservation>(`/api/checkin/${code.toUpperCase()}/passengers`)
        setReservation(found)
        setSelected(found.passengers.map((p) => p.id))
        setBagPassenger(found.passengers[0]?.id ?? null)
        setBoardingPasses([])
        setBags([])
      } catch (err) {
        setReservation(null)
        report(err)
      } finally {
        setBusy(false)
      }
    },
    [report],
  )

  const toggle = (id: number) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    )

  const checkIn = async () => {
    if (!reservation) return
    setBusy(true)
    setError(null)
    try {
      const result = await api<{ pnr: string; boarding_passes: BoardingPass[] }>(
        `/api/checkin/${reservation.pnr}`,
        { method: 'POST', body: JSON.stringify({ passenger_ids: selected }) },
      )
      setReservation(await api<Reservation>(`/api/checkin/${reservation.pnr}/passengers`))
      setBoardingPasses(result.boarding_passes)
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
    }
  }

  const addBag = async () => {
    if (!reservation || bagPassenger === null) return
    setBusy(true)
    setError(null)
    try {
      const receipt = await api<BagReceipt>(`/api/checkin/${reservation.pnr}/bags`, {
        method: 'POST',
        body: JSON.stringify({ passenger_id: bagPassenger, weight_kg: Number(bagWeight) }),
      })
      setBags((current) => [...current, receipt])
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Online check-in</h1>
        <p>
          Opens 48 hours before departure. Confirm your travellers, get your boarding pass and add
          hold bags.
        </p>
      </div>

      {needsLogin ? (
        <div className="notice">
          Sign in as <code>customer@iberia.demo</code> (password <code>Iberia2026!</code>) to
          check in.
        </div>
      ) : null}
      {error ? <div className="error">{error}</div> : null}

      <div className="card">
        <h3>Find your booking</h3>
        <div className="grid cols-3">
          <div className="field">
            <label htmlFor="pnr">Record locator (PNR)</label>
            <input
              id="pnr"
              value={pnr}
              placeholder="XK7T2P"
              onChange={(event) => setPnr(event.target.value.toUpperCase())}
            />
          </div>
          <div className="field">
            <label htmlFor="known">Open for check-in</label>
            <select
              id="known"
              value={pnr}
              onChange={(event) => {
                setPnr(event.target.value)
                void loadReservation(event.target.value)
              }}
            >
              <option value="">Select a booking…</option>
              {reservations.map((row) => (
                <option key={row.pnr} value={row.pnr}>
                  {row.pnr} · {row.flight_number} {row.origin}→{row.destination}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ alignSelf: 'end' }}>
            <button className="btn" disabled={busy || !pnr} onClick={() => void loadReservation(pnr)}>
              Retrieve booking
            </button>
          </div>
        </div>
      </div>

      {reservation ? (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <h3 style={{ margin: 0 }}>
              {reservation.flight_number} · {reservation.origin} → {reservation.destination}
            </h3>
            <span className="badge">{reservation.cabin}</span>
          </div>
          <p className="muted">
            Departs {formatTime(reservation.scheduled_departure)} · gate {reservation.gate} ·{' '}
            {reservation.contact_email}
          </p>

          <table>
            <thead>
              <tr>
                <th>Check in</th>
                <th>Passenger</th>
                <th>Seat</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {reservation.passengers.map((passenger) => (
                <tr key={passenger.id}>
                  <td>
                    <input
                      type="checkbox"
                      style={{ width: 16 }}
                      checked={selected.includes(passenger.id)}
                      onChange={() => toggle(passenger.id)}
                      aria-label={`select ${passenger.first_name} ${passenger.last_name}`}
                    />
                  </td>
                  <td>
                    {passenger.first_name} {passenger.last_name}
                  </td>
                  <td>{passenger.seat ?? '—'}</td>
                  <td>
                    {passenger.checked_in ? (
                      <span className="badge ok">checked in</span>
                    ) : (
                      <span className="badge warn">not checked in</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            className="btn"
            style={{ marginTop: 16 }}
            disabled={busy || !selected.length}
            onClick={() => void checkIn()}
          >
            Check in {selected.length} passenger{selected.length === 1 ? '' : 's'}
          </button>
        </div>
      ) : null}

      {boardingPasses.length ? (
        <>
          <h2>Boarding passes</h2>
          <div>
            {boardingPasses.map((boarding) => (
              <BoardingPassCard
                key={boarding.passenger_id}
                boarding={boarding}
                onDocumentError={report}
              />
            ))}
          </div>
        </>
      ) : null}

      {reservation ? (
        <div className="card">
          <h3>Hold baggage</h3>
          <div className="grid cols-3">
            <div className="field">
              <label htmlFor="bag-passenger">Passenger</label>
              <select
                id="bag-passenger"
                value={bagPassenger ?? ''}
                onChange={(event) => setBagPassenger(Number(event.target.value))}
              >
                {reservation.passengers.map((passenger) => (
                  <option key={passenger.id} value={passenger.id}>
                    {passenger.first_name} {passenger.last_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="bag-weight">Weight (kg)</label>
              <input
                id="bag-weight"
                type="number"
                min="1"
                max="60"
                value={bagWeight}
                onChange={(event) => setBagWeight(event.target.value)}
              />
            </div>
            <div className="field" style={{ alignSelf: 'end' }}>
              <button className="btn gold" disabled={busy} onClick={() => void addBag()}>
                Add bag
              </button>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            €25 per hold bag, plus €15 per kg above the 23 kg allowance.
          </p>

          {bags.length ? (
            <table>
              <thead>
                <tr>
                  <th>Bag tag</th>
                  <th>Weight</th>
                  <th>Fee</th>
                </tr>
              </thead>
              <tbody>
                {bags.map((bag) => (
                  <tr key={bag.bag_tag}>
                    <td>
                      <code>{bag.bag_tag}</code>
                    </td>
                    <td>{bag.weight_kg} kg</td>
                    <td>€{bag.fee_eur.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
