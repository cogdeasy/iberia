import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import type { PageMeta } from '../lib/pages'
import type { Payment } from './checkout.page'

export const meta: PageMeta = {
  path: '/payments',
  title: 'Payments',
  section: 'customer',
  nav: 'none',
  order: 40,
}

interface Refund {
  id: number
  payment_id: number
  amount_eur: number
  status: string
  reason: string
  created_at: string
}

const STATUS_BADGE: Record<string, string> = {
  authorised: 'badge ok',
  part_refunded: 'badge warn',
  refunded: 'badge crit',
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : (err as Error).message
}

export default function PaymentsPage() {
  const navigate = useNavigate()
  const [payments, setPayments] = useState<Payment[]>([])
  const [selected, setSelected] = useState<Payment | null>(null)
  const [refunds, setRefunds] = useState<Refund[]>([])
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [pnr, setPnr] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<Payment[]>('/api/payments')
      .then(setPayments)
      .catch((err: unknown) => setError(errorMessage(err)))
  }, [])

  useEffect(load, [load])

  function select(payment: Payment) {
    setSelected(payment)
    setAmount(payment.amount_eur.toFixed(2))
    setReason('')
    api<Refund[]>(`/api/payments/${payment.id}/refunds`)
      .then(setRefunds)
      .catch((err: unknown) => setError(errorMessage(err)))
  }

  async function refund(event: React.FormEvent) {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const created = await api<Refund>(`/api/payments/${selected.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ amount_eur: Number(amount), reason }),
      })
      setRefunds((current) => [...current, created])
      load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const total = payments.reduce((sum, payment) => sum + payment.amount_eur, 0)

  return (
    <>
      <div className="page-head">
        <h1>Payments</h1>
        <p>Card authorisations taken through the Iberia checkout, and their refunds.</p>
      </div>

      {error ? <div className="error">{error}</div> : null}

      <div className="grid cols-3">
        <div className="card">
          <div className="kpi-label">Payments</div>
          <div className="kpi">{payments.length}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Authorised value</div>
          <div className="kpi">€{total.toFixed(2)}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Pay for a booking</div>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (pnr.trim()) navigate(`/checkout/${pnr.trim().toUpperCase()}`)
            }}
          >
            <div className="field">
              <input
                aria-label="PNR"
                placeholder="PNR e.g. IBDEMO"
                value={pnr}
                onChange={(event) => setPnr(event.target.value)}
              />
            </div>
            <button className="btn" type="submit">
              Go to checkout
            </button>
          </form>
        </div>
      </div>

      <div className="card">
        <h3>Transactions</h3>
        {payments.length === 0 ? (
          <p className="muted">No payments yet — take one through the checkout.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>PNR</th>
                <th>Card</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Provider reference</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td>{payment.id}</td>
                  <td>
                    <code>{payment.pnr}</code>
                  </td>
                  <td>
                    {payment.card_brand} •••• {payment.card_last4}
                  </td>
                  <td>€{payment.amount_eur.toFixed(2)}</td>
                  <td>
                    <span className={STATUS_BADGE[payment.status] ?? 'badge'}>
                      {payment.status}
                    </span>
                  </td>
                  <td>
                    <code>{payment.provider_reference}</code>
                  </td>
                  <td>
                    <button className="btn ghost" type="button" onClick={() => select(payment)}>
                      Refund
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected ? (
        <div className="grid cols-2">
          <div className="card">
            <h3>Refund payment #{selected.id}</h3>
            <p className="muted">
              {selected.pnr} · {selected.card_brand} •••• {selected.card_last4} · €
              {selected.amount_eur.toFixed(2)}
            </p>
            <form onSubmit={refund}>
              <div className="field">
                <label htmlFor="refund-amount">Amount (EUR)</label>
                <input
                  id="refund-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="refund-reason">Reason</label>
                <input
                  id="refund-reason"
                  placeholder="Flight cancelled"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <button className="btn" type="submit" disabled={busy}>
                {busy ? 'Refunding…' : 'Issue refund'}
              </button>
            </form>
          </div>
          <div className="card">
            <h3>Refund history</h3>
            {refunds.length === 0 ? (
              <p className="muted">No refunds on this payment.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {refunds.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>€{item.amount_eur.toFixed(2)}</td>
                      <td>
                        <span className="badge">{item.status}</span>
                      </td>
                      <td>{item.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}
