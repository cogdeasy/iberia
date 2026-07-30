import { useCallback, useEffect, useState } from 'react'
import type { PageMeta } from '../lib/pages'
import { api, getUser } from '../lib/api'

export const meta: PageMeta = {
  path: '/bookings',
  title: 'My bookings',
  section: 'customer',
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

export default function BookingsPage() {
  const user = getUser()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [seatmapFor, setSeatmapFor] = useState<string | null>(null)
  const [seatmap, setSeatmap] = useState<SeatMap | null>(null)
  const [selectedPassenger, setSelectedPassenger] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api<Booking[]>('/api/bookings')
      .then((data) => {
        setBookings(data)
        setError(null)
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

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
      <section className="hero">
        <h1>My bookings</h1>
        <p>Record locators, seats and payment status for {user?.full_name ?? 'your account'}.</p>
      </section>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      {!user && <div className="notice">Sign in to see your PNRs.</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>PNR</th>
              <th>Flight</th>
              <th>Departure</th>
              <th>Cabin</th>
              <th>Passengers</th>
              <th>Total</th>
              <th>Status</th>
              <th>Payment</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bookings.map((booking) => (
              <tr key={booking.pnr}>
                <td>
                  <code>{booking.pnr}</code>
                </td>
                <td>
                  {booking.flight.flight_number} · {booking.flight.origin} →{' '}
                  {booking.flight.destination}
                </td>
                <td>{new Date(booking.flight.scheduled_departure).toLocaleString()}</td>
                <td>{booking.flight.cabin.replace('_', ' ')}</td>
                <td>
                  {booking.passengers
                    .map((p) => `${p.first_name} ${p.last_name}${p.seat ? ` (${p.seat})` : ''}`)
                    .join(', ')}
                </td>
                <td>€{booking.total_eur.toFixed(2)}</td>
                <td>
                  <span className={statusClass(booking.status)}>{booking.status}</span>
                </td>
                <td>
                  <span className={booking.payment_status === 'paid' ? 'badge ok' : 'badge warn'}>
                    {booking.payment_status}
                  </span>
                </td>
                <td>
                  <button className="btn ghost" onClick={() => openSeatmap(booking)}>
                    Seats
                  </button>{' '}
                  {booking.status !== 'cancelled' && (
                    <button className="btn ghost" onClick={() => cancel(booking.pnr)}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!bookings.length && !loading && (
              <tr>
                <td colSpan={9} className="muted">
                  No bookings yet — search a flight to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {seatmapFor && seatmap && (
        <div className="card">
          <h3>Seat map · {seatmapFor}</h3>
          <div className="field">
            <label htmlFor="passenger">Assign to passenger</label>
            <select
              id="passenger"
              value={selectedPassenger ?? ''}
              onChange={(e) => setSelectedPassenger(Number(e.target.value))}
            >
              {bookings
                .find((booking) => booking.pnr === seatmapFor)
                ?.passengers.map((passenger) => (
                  <option key={passenger.id} value={passenger.id}>
                    {passenger.first_name} {passenger.last_name}
                  </option>
                ))}
            </select>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {seatmap.rows.map((row) => (
              <div key={row.row} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="muted" style={{ width: 28, fontSize: 12 }}>
                  {row.row}
                </span>
                {row.seats.map((seat) => (
                  <button
                    key={seat.seat}
                    className={seat.available ? 'btn ghost' : 'btn ghost'}
                    disabled={!seat.available}
                    onClick={() => assignSeat(seatmapFor, seat.seat)}
                    style={{ padding: '4px 8px', fontSize: 12 }}
                  >
                    {seat.seat}
                  </button>
                ))}
                <span className="badge">{row.seats[0]?.cabin}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
