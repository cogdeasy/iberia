import { useCallback, useEffect, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '../lib/api'
import type { PageMeta } from '../lib/pages'

export const meta: PageMeta = {
  path: '/loyalty',
  title: 'Iberia Plus',
  section: 'customer',
  nav: 'primary',
  order: 40,
}

interface LoyaltyTxn {
  id: number
  created_at: string
  description: string
  avios: number
  balance_after: number
}

interface Member {
  plus_number: string
  full_name: string
  tier: string
  avios_balance: number
  tier_points: number
  transactions: LoyaltyTxn[]
}

const TIER_BADGE: Record<string, string> = {
  Clásica: 'badge',
  Plata: 'badge',
  Oro: 'badge warn',
  Platino: 'badge ok',
}

const TIER_THRESHOLDS: [string, number][] = [
  ['Plata', 1200],
  ['Oro', 3600],
  ['Platino', 7200],
]

function formatAvios(value: number): string {
  return value.toLocaleString('en-GB')
}

function nextTier(tierPoints: number): string {
  const next = TIER_THRESHOLDS.find(([, threshold]) => tierPoints < threshold)
  if (!next) return 'Top tier reached'
  return `${formatAvios(next[1] - tierPoints)} tier points to ${next[0]}`
}

export default function LoyaltyPage() {
  const [member, setMember] = useState<Member | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [toPlusNumber, setToPlusNumber] = useState('')
  const [transferAvios, setTransferAvios] = useState('1000')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<Member>('/api/loyalty/me')
      .then((data) => {
        setMember(data)
        setError(null)
      })
      .catch((err: Error) => setError(err.message))
  }, [])

  useEffect(load, [load])

  async function submitTransfer(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const result = await api<{ balance: number }>('/api/loyalty/transfer', {
        method: 'POST',
        body: JSON.stringify({
          to_plus_number: toPlusNumber,
          avios: Number(transferAvios),
        }),
      })
      setNotice(
        `Transferred ${formatAvios(Number(transferAvios))} Avios to ${toPlusNumber}. ` +
          `New balance ${formatAvios(result.balance)}.`,
      )
      setToPlusNumber('')
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const series = (member?.transactions ?? []).map((txn) => ({
    date: new Date(txn.created_at).toLocaleDateString('en-GB', {
      month: 'short',
      year: '2-digit',
    }),
    balance: txn.balance_after,
  }))

  return (
    <>
      <div className="page-head">
        <h1>Iberia Plus</h1>
        <p>Your Avios balance, tier progress and account activity.</p>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {member && (
        <>
          <div className="grid cols-4">
            <div className="card">
              <div className="kpi-label">Avios balance</div>
              <div className="kpi">{formatAvios(member.avios_balance)}</div>
              <p className="muted">{member.plus_number}</p>
            </div>
            <div className="card">
              <div className="kpi-label">Tier</div>
              <div className="kpi">
                <span className={TIER_BADGE[member.tier] ?? 'badge'}>{member.tier}</span>
              </div>
              <p className="muted">{member.full_name}</p>
            </div>
            <div className="card">
              <div className="kpi-label">Tier points</div>
              <div className="kpi">{formatAvios(member.tier_points)}</div>
              <p className="muted">{nextTier(member.tier_points)}</p>
            </div>
            <div className="card">
              <div className="kpi-label">Activity</div>
              <div className="kpi">{member.transactions.length}</div>
              <p className="muted">ledger entries</p>
            </div>
          </div>

          <div className="card">
            <h3>Avios balance over time</h3>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis fontSize={12} tickFormatter={(value: number) => formatAvios(value)} />
                  <Tooltip formatter={(value: number) => formatAvios(value)} />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    stroke="#d7192d"
                    fill="#d7192d"
                    fillOpacity={0.15}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid cols-2">
            <div className="card">
              <h3>Transactions</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Avios</th>
                    <th>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {[...member.transactions].reverse().map((txn) => (
                    <tr key={txn.id}>
                      <td>{new Date(txn.created_at).toLocaleDateString('en-GB')}</td>
                      <td>{txn.description}</td>
                      <td style={{ color: txn.avios < 0 ? 'var(--crit)' : 'var(--ok)' }}>
                        {txn.avios > 0 ? '+' : ''}
                        {formatAvios(txn.avios)}
                      </td>
                      <td>{formatAvios(txn.balance_after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <h3>Transfer Avios</h3>
              <form onSubmit={submitTransfer}>
                <div className="field">
                  <label htmlFor="to-plus-number">Recipient Iberia Plus number</label>
                  <input
                    id="to-plus-number"
                    value={toPlusNumber}
                    onChange={(event) => setToPlusNumber(event.target.value)}
                    placeholder="IB7654321"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="transfer-avios">Avios</label>
                  <input
                    id="transfer-avios"
                    type="number"
                    value={transferAvios}
                    onChange={(event) => setTransferAvios(event.target.value)}
                    required
                  />
                </div>
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? 'Transferring…' : 'Transfer Avios'}
                </button>
              </form>
              <p className="muted">
                Avios move instantly between Iberia Plus accounts. Household transfers are free.
              </p>
            </div>
          </div>
        </>
      )}
    </>
  )
}
