import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { PageMeta } from '../lib/pages'
import { api, getUser } from '../lib/api'

export const meta: PageMeta = { path: '/book/:flightId', section: 'customer', order: 21 }

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

interface Booking {
  pnr: string
  status: string
  total_eur: number
  payment_status: string
  flight: FlightOffer
}

interface PassengerForm {
  first_name: string
  last_name: string
  date_of_birth: string
  document_number: string
}

const CABINS = ['economy', 'premium_economy', 'business', 'first']
const CABIN_MULTIPLIER: Record<string, number> = {
  economy: 1,
  premium_economy: 1.6,
  business: 2.75,
  first: 4,
}

const emptyPassenger = (): PassengerForm => ({
  first_name: '',
  last_name: '',
  date_of_birth: '',
  document_number: '',
})

export default function BookPage() {
  const { flightId } = useParams<{ flightId: string }>()
  const navigate = useNavigate()
  const user = getUser()
  const [flight, setFlight] = useState<FlightOffer | null>(null)
  const [cabin, setCabin] = useState('economy')
  const [passengers, setPassengers] = useState<PassengerForm[]>([emptyPassenger()])
  const [contactEmail, setContactEmail] = useState(user?.email ?? '')
  const [booking, setBooking] = useState<Booking | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!flightId) return
    api<FlightOffer>(`/api/flights/${flightId}`)
      .then(setFlight)
      .catch(() => setFlight(null))
  }, [flightId])

  const baseFare = flight ? flight.fare_eur / CABIN_MULTIPLIER[flight.cabin ?? 'economy'] : null
  const estimate =
    baseFare === null
      ? null
      : Math.round(baseFare * CABIN_MULTIPLIER[cabin] * passengers.length * 100) / 100

  const update = (index: number, field: keyof PassengerForm, value: string) => {
    setPassengers((current) =>
      current.map((passenger, i) => (i === index ? { ...passenger, [field]: value } : passenger)),
    )
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!flightId) return
    setSaving(true)
    setError(null)
    try {
      const created = await api<Booking>('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({
          flight_id: Number(flightId),
          cabin,
          contact_email: contactEmail,
          passengers: passengers.map((passenger) => ({
            first_name: passenger.first_name,
            last_name: passenger.last_name,
            date_of_birth: passenger.date_of_birth || null,
            document_number: passenger.document_number || null,
          })),
        }),
      })
      setBooking(created)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (booking) {
    return (
      <div className="card">
        <h2>Booking confirmed</h2>
        <div className="grid cols-3">
          <div>
            <div className="kpi-label">Record locator</div>
            <div className="kpi">{booking.pnr}</div>
          </div>
          <div>
            <div className="kpi-label">Total</div>
            <div className="kpi">€{booking.total_eur.toFixed(2)}</div>
          </div>
          <div>
            <div className="kpi-label">Payment</div>
            <div className="kpi">
              <span className="badge warn">{booking.payment_status}</span>
            </div>
          </div>
        </div>
        <p className="muted">
          Your seats are not held until payment completes. Continue to payment to secure the fare.
        </p>
        <Link className="btn" to={`/pay/${booking.pnr}`}>
          Continue to payment
        </Link>{' '}
        <button className="btn ghost" onClick={() => navigate('/bookings')}>
          View my bookings
        </button>
      </div>
    )
  }

  return (
    <>
      <section className="hero">
        <h1>Passenger details</h1>
        <p>
          {flight
            ? `${flight.flight_number} · ${flight.origin} → ${flight.destination} · ${new Date(
                flight.scheduled_departure,
              ).toLocaleString()}`
            : `Flight #${flightId}`}
        </p>
      </section>

      {error && <div className="error">{error}</div>}
      {!user && <div className="notice">Sign in first — booking requires an authenticated user.</div>}

      <form className="card" onSubmit={submit}>
        <div className="grid cols-2">
          <div className="field">
            <label htmlFor="cabin">Cabin</label>
            <select id="cabin" value={cabin} onChange={(e) => setCabin(e.target.value)}>
              {CABINS.map((option) => (
                <option key={option} value={option}>
                  {option.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="contact">Contact email</label>
            <input
              id="contact"
              type="email"
              required
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>
        </div>

        {passengers.map((passenger, index) => (
          <div className="card" key={index}>
            <h3>Passenger {index + 1}</h3>
            <div className="grid cols-4">
              <div className="field">
                <label htmlFor={`first-${index}`}>First name</label>
                <input
                  id={`first-${index}`}
                  required
                  value={passenger.first_name}
                  onChange={(e) => update(index, 'first_name', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`last-${index}`}>Last name</label>
                <input
                  id={`last-${index}`}
                  required
                  value={passenger.last_name}
                  onChange={(e) => update(index, 'last_name', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`dob-${index}`}>Date of birth</label>
                <input
                  id={`dob-${index}`}
                  type="date"
                  value={passenger.date_of_birth}
                  onChange={(e) => update(index, 'date_of_birth', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor={`doc-${index}`}>Passport number</label>
                <input
                  id={`doc-${index}`}
                  value={passenger.document_number}
                  onChange={(e) => update(index, 'document_number', e.target.value)}
                />
              </div>
            </div>
            {passengers.length > 1 && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => setPassengers((c) => c.filter((_, i) => i !== index))}
              >
                Remove passenger
              </button>
            )}
          </div>
        ))}

        <div className="grid cols-3">
          <button
            type="button"
            className="btn ghost"
            onClick={() => setPassengers((c) => [...c, emptyPassenger()])}
          >
            Add passenger
          </button>
          <div>
            <div className="kpi-label">Estimated total</div>
            <div className="kpi">{estimate === null ? '—' : `€${estimate.toFixed(2)}`}</div>
          </div>
          <button className="btn" type="submit" disabled={saving || !user}>
            {saving ? 'Creating PNR…' : 'Create booking'}
          </button>
        </div>
      </form>
    </>
  )
}
