import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import type { PageMeta } from '../lib/pages'
import Steps from '../components/Steps'

export const meta: PageMeta = { path: '/checkout/:pnr', section: 'customer', nav: 'none', order: 41 }

export interface Payment {
  id: number
  pnr: string
  status: string
  amount_eur: number
  card_last4: string
  card_brand: string
  provider_reference: string
  created_at: string
}

interface BookingFlight {
  flight_number: string
  origin: string
  destination: string
  scheduled_departure: string
  cabin: string
}

interface BookingPassenger {
  id: number
  first_name: string
  last_name: string
  seat: string | null
}

interface Booking {
  pnr: string
  status: string
  total_eur: number
  payment_status: string
  contact_email: string
  flight: BookingFlight
  passengers: BookingPassenger[]
}

const TEST_CARDS = [
  { label: 'Visa', number: '4111 1111 1111 1111' },
  { label: 'Mastercard', number: '5555 5555 5555 4444' },
  { label: 'Amex', number: '3782 822463 10005' },
]

export default function CheckoutPage() {
  const { pnr = '' } = useParams<{ pnr: string }>()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [cardNumber, setCardNumber] = useState('')
  const [cardHolder, setCardHolder] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvv, setCvv] = useState('')
  const [payment, setPayment] = useState<Payment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!pnr) return
    api<Booking>(`/api/bookings/${pnr}`)
      .then(setBooking)
      .catch(() => setBooking(null))
  }, [pnr])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await api<Payment>('/api/payments/authorise', {
        method: 'POST',
        body: JSON.stringify({
          pnr,
          card_number: cardNumber.replace(/\s+/g, ''),
          card_holder: cardHolder,
          expiry,
          cvv,
        }),
      })
      setPayment(created)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err as Error).message
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  if (payment) {
    return (
      <>
        <Steps current={4} />
        <div className="page-head">
          <h1>Your trip is booked</h1>
          <p>
            We have emailed the confirmation to{' '}
            <strong>{booking?.contact_email ?? 'your contact address'}</strong>.
          </p>
        </div>

        <div className="boarding-pass">
          <div className="boarding-pass-main">
            <div className="boarding-pass-head">
              <div>
                <div className="datum-label">Booking reference</div>
                <div className="kpi">{payment.pnr}</div>
              </div>
              <span className="badge ok">{payment.status}</span>
            </div>
            <div className="boarding-pass-grid">
              <div>
                <div className="datum-label">Route</div>
                <div className="datum-value">
                  {booking ? `${booking.flight.origin} → ${booking.flight.destination}` : '—'}
                </div>
              </div>
              <div>
                <div className="datum-label">Flight</div>
                <div className="datum-value">{booking?.flight.flight_number ?? '—'}</div>
              </div>
              <div>
                <div className="datum-label">Departs</div>
                <div className="datum-value">
                  {booking
                    ? new Date(booking.flight.scheduled_departure).toLocaleString([], {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'}
                </div>
              </div>
              <div>
                <div className="datum-label">Passengers</div>
                <div className="datum-value">{booking?.passengers.length ?? '—'}</div>
              </div>
            </div>
          </div>
          <div className="boarding-pass-stub">
            <div>
              <div className="datum-label">Paid</div>
              <div className="stub-code">€{payment.amount_eur.toFixed(2)}</div>
            </div>
            <div>
              <div className="datum-label">
                {payment.card_brand} •••• {payment.card_last4}
              </div>
              <div className="barcode" />
            </div>
          </div>
        </div>

        <div className="stack">
          <Link className="btn" to="/checkin">
            Check in
          </Link>
          <Link className="btn ghost" to="/bookings">
            My trips
          </Link>
          <Link className="btn ghost" to="/payments">
            Payments &amp; receipts
          </Link>
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          Provider reference <code>{payment.provider_reference}</code> · payment #{payment.id}
        </p>
      </>
    )
  }

  return (
    <>
      <Steps current={3} />

      <div className="page-head">
        <h1>Payment</h1>
        <p>
          Booking <strong>{pnr || '—'}</strong> is held. Demo environment — use one of the fake test
          cards, never a real card.
        </p>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="layout-sidebar" style={{ gridTemplateColumns: '1fr 320px' }}>
        <div>
          <div className="card">
            <h3>Card details</h3>
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="card-number">Card number</label>
                <input
                  id="card-number"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="4111 1111 1111 1111"
                  value={cardNumber}
                  onChange={(event) => setCardNumber(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="card-holder">Cardholder name</label>
                <input
                  id="card-holder"
                  placeholder="LUCIA FERNANDEZ"
                  value={cardHolder}
                  onChange={(event) => setCardHolder(event.target.value)}
                  required
                />
              </div>
              <div className="grid cols-2">
                <div className="field">
                  <label htmlFor="expiry">Expiry</label>
                  <input
                    id="expiry"
                    placeholder="12/29"
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value)}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="cvv">CVV</label>
                  <input
                    id="cvv"
                    inputMode="numeric"
                    placeholder="123"
                    value={cvv}
                    onChange={(event) => setCvv(event.target.value)}
                    required
                  />
                </div>
              </div>
              <button className="btn" type="submit" disabled={busy || !pnr}>
                {busy ? 'Authorising…' : `Pay ${booking ? `€${booking.total_eur.toFixed(2)}` : 'now'}`}
              </button>
            </form>
          </div>

          <div className="card">
            <div className="card-title">
              <h3>Test cards</h3>
              <span className="badge">simulated acquirer</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Number</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {TEST_CARDS.map((card) => (
                  <tr key={card.label}>
                    <td>{card.label}</td>
                    <td>
                      <code>{card.number}</code>
                    </td>
                    <td>
                      <button
                        className="btn ghost sm"
                        type="button"
                        onClick={() => {
                          setCardNumber(card.number)
                          setCardHolder(cardHolder || 'LUCIA FERNANDEZ')
                          setExpiry('12/29')
                          setCvv(card.label === 'Amex' ? '1234' : '123')
                        }}
                      >
                        Use
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside>
          <div className="card summary-card">
            <h3>Trip summary</h3>
            {booking ? (
              <>
                <div className="datum-value">
                  {booking.flight.origin} → {booking.flight.destination}
                </div>
                <p className="muted" style={{ marginTop: 4 }}>
                  {booking.flight.flight_number} ·{' '}
                  {new Date(booking.flight.scheduled_departure).toLocaleString([], {
                    weekday: 'short',
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <div className="summary-row">
                  <span className="muted">Cabin</span>
                  <span>{booking.flight.cabin.replace('_', ' ')}</span>
                </div>
                {booking.passengers.map((passenger) => (
                  <div className="summary-row" key={passenger.id}>
                    <span className="muted">
                      {passenger.first_name} {passenger.last_name}
                    </span>
                    <span>{passenger.seat ?? 'seat at check-in'}</span>
                  </div>
                ))}
                <div className="summary-row total">
                  <span>Total</span>
                  <span>€{booking.total_eur.toFixed(2)}</span>
                </div>
              </>
            ) : (
              <p className="muted">Loading booking {pnr}…</p>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}
