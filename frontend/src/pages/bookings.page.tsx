import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PageMeta } from '../lib/pages'
import { api, getUser } from '../lib/api'

export const meta: PageMeta = {
  path: '/bookings',
  title: 'My trips',
  section: 'customer',
  nav: 'primary',
  order: 22,
}

interface FlightOffer {
  flight_id: number
  flight_number: string
  origin: string
  destination: string
  scheduled_departure: string
  scheduled_arrival: string
  cabin: string
  fare_eur: number
  status: string
}

interface Passenger {
  id: number
  first_name: string
  last_name: string
  seat: string | null
  checked_in: boolean
  document_number: string | null
}

interface Booking {
  pnr: string
  status: string
  flight: FlightOffer
  passengers: Passenger[]
  total_eur: number
  payment_status: string
  created_at: string
  contact_email: string
}

interface Seat {
  seat: string
  cabin: string
  available: boolean
  price_eur: number
}

interface SeatMap {
  rows: { row: number; seats: Seat[] }[]
}

const statusClass = (status: string) =>
  status === 'cancelled' ? 'badge crit' : status === 'confirmed' ? 'badge ok' : 'badge'

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function BookingsPage() {
  const user = getUser()
  const signedIn = Boolean(user)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [seatmapFor, setSeatmapFor] = useState<string | null>(null)
  const [seatmap, setSeatmap] = useState<SeatMap | null>(null)
  const [selectedPassenger, setSelectedPassenger] = useState<number | null>(null)

  const load = useCallback(() => {
    if (!signedIn) {
      setBookings([])
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    api<Booking[]>('/api/bookings')
      .then((data) => {
        setBookings(data)
        setError(null)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [signedIn])

  useEffect(load, [load])

  const openSeatmap = async (booking: Booking) => {
    setNotice(null)
    if (seatmapFor === booking.pnr) {
      setSeatmapFor(null)
      setSeatmap(null)
      return
    }
    try {
      const map = await api<SeatMap>(`/api/bookings/${booking.pnr}/seatmap`)
      setSeatmap(map)
      setSeatmapFor(booking.pnr)
      setSelectedPassenger(booking.passengers[0]?.id ?? null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const assignSeat = async (pnr: string, seat: string) => {
    if (selectedPassenger === null) return
    try {
      await api<Booking>(`/api/bookings/${pnr}/seats`, {
        method: 'POST',
        body: JSON.stringify({ assignments: [{ passenger_id: selectedPassenger, seat }] }),
      })
      setNotice(`Seat ${seat} assigned on ${pnr}.`)
      setSeatmapFor(null)
      setSeatmap(null)
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const cancel = async (pnr: string) => {
    try {
      await api<Booking>(`/api/bookings/${pnr}/cancel`, { method: 'POST' })
      setNotice(`PNR ${pnr} cancelled.`)
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>My trips</h1>
        <p>
          Upcoming journeys for {user?.full_name ?? 'your account'} — seats, payment status and
          cancellations.
        </p>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="success">{notice}</div>}
      {!user && (
        <div className="notice">
          <Link to="/login">Sign in</Link> to see your booking references.
        </div>
      )}

      {loading && !bookings.length && (
        <div className="card empty">
          <p className="muted">Loading your trips…</p>
        </div>
      )}

      {!bookings.length && !loading && user && (
        <div className="card empty">
          <h3>No trips yet</h3>
          <p>Your booked flights will appear here.</p>
          <Link className="btn" to="/flights">
            Search flights
          </Link>
        </div>
      )}

      {bookings.map((booking) => (
        <section className="card" key={booking.pnr}>
          <div className="card-title">
            <div>
              <div className="datum-label">Booking reference</div>
              <h2 style={{ letterSpacing: 2 }}>{booking.pnr}</h2>
            </div>
            <div className="stack">
              <span className={statusClass(booking.status)}>{booking.status}</span>
              <span className={booking.payment_status === 'paid' ? 'badge ok' : 'badge warn'}>
                {booking.payment_status}
              </span>
            </div>
          </div>

          <div className="flight-card" style={{ marginBottom: 0, border: 'none', padding: 0 }}>
            <div>
              <div className="flight-times">
                <div className="flight-endpoint">
                  <div className="time">{formatTime(booking.flight.scheduled_departure)}</div>
                  <div className="place">{booking.flight.origin}</div>
                </div>
                <div className="flight-path">
                  {booking.flight.flight_number}
                  <div className="line" />
                  {booking.flight.cabin.replace('_', ' ')}
                </div>
                <div className="flight-endpoint">
                  <div className="time">{formatTime(booking.flight.scheduled_arrival)}</div>
                  <div className="place">{booking.flight.destination}</div>
                </div>
              </div>
              <div className="flight-meta">
                <span>{formatDateTime(booking.flight.scheduled_departure)}</span>
                <span>
                  {booking.passengers
                    .map((p) => `${p.first_name} ${p.last_name}${p.seat ? ` · ${p.seat}` : ''}`)
                    .join(', ')}
                </span>
              </div>
            </div>
            <div className="flight-buy">
              <div className="fare">€{booking.total_eur.toFixed(2)}</div>
              <div className="fare-note">
                total for {booking.passengers.length} passenger
                {booking.passengers.length > 1 ? 's' : ''}
              </div>
              <div className="stack" style={{ justifyContent: 'flex-end' }}>
                {booking.status !== 'cancelled' && (
                  <>
                    {booking.payment_status === 'unpaid' && (
                      <Link className="btn sm" to={`/checkout/${booking.pnr}`}>
                        Pay now
                      </Link>
                    )}
                    <button className="btn ghost sm" onClick={() => openSeatmap(booking)}>
                      {seatmapFor === booking.pnr ? 'Hide seats' : 'Choose seats'}
                    </button>
                    <button className="btn ghost sm" onClick={() => cancel(booking.pnr)}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {seatmapFor === booking.pnr && seatmap && (
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 18, paddingTop: 18 }}>
              <div className="card-title">
                <h3>Choose a seat</h3>
                <div style={{ minWidth: 220 }}>
                  <select
                    aria-label="Assign to passenger"
                    value={selectedPassenger ?? ''}
                    onChange={(e) => setSelectedPassenger(Number(e.target.value))}
                  >
                    {booking.passengers.map((passenger) => (
                      <option key={passenger.id} value={passenger.id}>
                        {passenger.first_name} {passenger.last_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="seatmap">
                {seatmap.rows.map((row) => (
                  <div className="seat-row" key={row.row}>
                    <span className="muted" style={{ width: 26, fontSize: 12 }}>
                      {row.row}
                    </span>
                    {row.seats.map((seat, index) => (
                      <Fragment key={seat.seat}>
                        {index === Math.ceil(row.seats.length / 2) && (
                          <span className="seat-aisle" />
                        )}
                        <button
                          className={`seat ${seat.available ? '' : 'is-taken'}`}
                          disabled={!seat.available}
                          title={`${seat.seat} · ${seat.cabin} · €${seat.price_eur.toFixed(2)}`}
                          onClick={() => assignSeat(booking.pnr, seat.seat)}
                        >
                          {seat.seat.slice(String(row.row).length)}
                        </button>
                      </Fragment>
                    ))}
                    <span className="badge">
                      {row.seats[0]?.cabin.replace('_', ' ')}
                      {row.seats[0]?.price_eur ? ` · €${row.seats[0].price_eur.toFixed(2)}` : ' · free'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="seat-legend">
                <span>
                  <i style={{ background: '#f8fafc' }} />
                  Available
                </span>
                <span>
                  <i style={{ background: 'var(--line)' }} />
                  Occupied
                </span>
              </div>
            </div>
          )}
        </section>
      ))}
    </>
  )
}
