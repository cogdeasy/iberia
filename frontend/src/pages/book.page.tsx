import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { PageMeta } from '../lib/pages'
import { api, getUser } from '../lib/api'
import Steps from '../components/Steps'
import { readPassengerCount } from '../components/SearchWidget'

export const meta: PageMeta = { path: '/book/:flightId', section: 'customer', nav: 'none', order: 21 }

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

const cabinLabel = (cabin: string) => cabin.replace('_', ' ')

function readCabin(value: string | null): string {
  return value && CABINS.includes(value) ? value : 'economy'
}

export default function BookPage() {
  const { flightId } = useParams<{ flightId: string }>()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const user = getUser()
  const [flight, setFlight] = useState<FlightOffer | null>(null)
  const [cabin, setCabin] = useState(readCabin(params.get('cabin')))
  const [passengers, setPassengers] = useState<PassengerForm[]>(
    Array.from({ length: readPassengerCount(params.get('passengers')) }, emptyPassenger),
  )
  const [contactEmail, setContactEmail] = useState(user?.email ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!flightId) return
    api<FlightOffer>(`/api/flights/${flightId}`)
      .then(setFlight)
      .catch(() => setFlight(null))
  }, [flightId])

  const baseFare = flight ? flight.fare_eur / CABIN_MULTIPLIER[flight.cabin ?? 'economy'] : null
  const fareEach = baseFare === null ? null : baseFare * CABIN_MULTIPLIER[cabin]
  const total = fareEach === null ? null : fareEach * passengers.length

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
      navigate(`/checkout/${created.pnr}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Steps current={2} />

      <div className="page-head">
        <h1>Who is travelling?</h1>
        <p>Names must match the passport or ID used at the airport.</p>
      </div>

      {error && <div className="error">{error}</div>}
      {!user && (
        <div className="notice">
          <Link to="/login">Sign in</Link> to hold this fare — bookings are tied to your account.
        </div>
      )}

      <div className="layout-sidebar" style={{ gridTemplateColumns: '1fr 320px' }}>
        <form onSubmit={submit} id="passenger-form">
          {passengers.map((passenger, index) => (
            <div className="card" key={index}>
              <div className="card-title">
                <h3>Passenger {index + 1}</h3>
                {passengers.length > 1 && (
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setPassengers((c) => c.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid cols-2">
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
                  <label htmlFor={`doc-${index}`}>Passport / ID number</label>
                  <input
                    id={`doc-${index}`}
                    value={passenger.document_number}
                    onChange={(e) => update(index, 'document_number', e.target.value)}
                  />
                </div>
              </div>
            </div>
          ))}

          <div className="card">
            <div className="card-title">
              <h3>Contact &amp; fare</h3>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setPassengers((c) => [...c, emptyPassenger()])}
              >
                + Add passenger
              </button>
            </div>
            <div className="grid cols-2">
              <div className="field">
                <label htmlFor="contact">Contact email</label>
                <input
                  id="contact"
                  type="email"
                  required
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
                <div className="field-hint">Booking confirmation and disruption alerts go here.</div>
              </div>
              <div className="field">
                <label htmlFor="cabin">Cabin</label>
                <select id="cabin" value={cabin} onChange={(e) => setCabin(e.target.value)}>
                  {CABINS.map((option) => (
                    <option key={option} value={option}>
                      {cabinLabel(option)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </form>

        <aside>
          <div className="card summary-card">
            <h3>Your flight</h3>
            {flight ? (
              <>
                <div className="datum-value">
                  {flight.origin} → {flight.destination}
                </div>
                <p className="muted" style={{ marginTop: 4 }}>
                  {flight.flight_number} ·{' '}
                  {new Date(flight.scheduled_departure).toLocaleString([], {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <div className="summary-row">
                  <span className="muted">Cabin</span>
                  <span>{cabinLabel(cabin)}</span>
                </div>
                <div className="summary-row">
                  <span className="muted">
                    Fare × {passengers.length} passenger{passengers.length > 1 ? 's' : ''}
                  </span>
                  <span>{fareEach === null ? '—' : `€${fareEach.toFixed(2)} each`}</span>
                </div>
                <div className="summary-row">
                  <span className="muted">Taxes &amp; carrier charges</span>
                  <span>included</span>
                </div>
                <div className="summary-row total">
                  <span>Total</span>
                  <span>{total === null ? '—' : `€${total.toFixed(2)}`}</span>
                </div>
              </>
            ) : (
              <p className="muted">Loading flight #{flightId}…</p>
            )}
            <button
              className="btn"
              type="submit"
              form="passenger-form"
              disabled={saving || !user}
              style={{ width: '100%', marginTop: 12 }}
            >
              {saving ? 'Creating booking…' : 'Continue to payment'}
            </button>
            <p className="field-hint" style={{ textAlign: 'center' }}>
              Seats are held for 20 minutes.
            </p>
          </div>
        </aside>
      </div>
    </>
  )
}
