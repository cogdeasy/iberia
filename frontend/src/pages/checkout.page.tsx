import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import type { PageMeta } from '../lib/pages'

export const meta: PageMeta = { path: '/checkout/:pnr', section: 'customer', order: 41 }

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

const TEST_CARDS = [
  { label: 'Visa', number: '4111 1111 1111 1111' },
  { label: 'Mastercard', number: '5555 5555 5555 4444' },
  { label: 'Amex', number: '3782 822463 10005' },
]

export default function CheckoutPage() {
  const { pnr = '' } = useParams<{ pnr: string }>()
  const [cardNumber, setCardNumber] = useState('')
  const [cardHolder, setCardHolder] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvv, setCvv] = useState('')
  const [payment, setPayment] = useState<Payment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
        <section className="hero">
          <h1>Payment confirmed</h1>
          <p>
            Booking <strong>{payment.pnr}</strong> is paid. Keep the provider reference for your
            records.
          </p>
        </section>
        <div className="grid cols-3">
          <div className="card">
            <div className="kpi-label">Amount charged</div>
            <div className="kpi">€{payment.amount_eur.toFixed(2)}</div>
            <span className="badge ok">{payment.status}</span>
          </div>
          <div className="card">
            <div className="kpi-label">Card</div>
            <div className="kpi">•••• {payment.card_last4}</div>
            <p className="muted">{payment.card_brand}</p>
          </div>
          <div className="card">
            <div className="kpi-label">Provider reference</div>
            <div className="kpi" style={{ fontSize: 20 }}>
              <code>{payment.provider_reference}</code>
            </div>
            <p className="muted">payment #{payment.id}</p>
          </div>
        </div>
        <div className="card">
          <Link className="btn" to="/payments">
            View payments &amp; refunds
          </Link>
        </div>
      </>
    )
  }

  return (
    <>
      <section className="hero">
        <h1>Checkout</h1>
        <p>
          Pay for booking <strong>{pnr || '—'}</strong>. Demo environment: use one of the fake test
          cards below, never a real card.
        </p>
      </section>

      <div className="grid cols-2">
        <div className="card">
          <h3>Card details</h3>
          {error ? <div className="error">{error}</div> : null}
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
              {busy ? 'Authorising…' : 'Pay now'}
            </button>
          </form>
        </div>

        <div className="card">
          <h3>Test cards</h3>
          <p className="muted">Fake numbers accepted by the simulated acquirer.</p>
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
                      className="btn ghost"
                      type="button"
                      onClick={() => {
                        setCardNumber(card.number)
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
    </>
  )
}
