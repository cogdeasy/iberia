import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { PageMeta } from '../lib/pages'
import { api } from '../lib/api'
import SearchWidget, {
  CABINS,
  readPassengerCount,
  type SearchCriteria,
} from '../components/SearchWidget'

export const meta: PageMeta = {
  path: '/flights',
  title: 'Book',
  section: 'customer',
  nav: 'primary',
  order: 10,
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

interface SearchResults {
  results: FlightOffer[]
  count: number
  query_ms: number
}

const SORTS = [
  { value: 'departure', label: 'Departure time' },
  { value: 'fare', label: 'Lowest fare' },
  { value: 'fare_desc', label: 'Highest fare' },
  { value: 'number', label: 'Flight number' },
]

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' })
}

function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

function statusBadge(status: string): { className: string; label: string } {
  if (status === 'cancelled') return { className: 'badge crit', label: 'Cancelled' }
  if (status === 'delayed') return { className: 'badge warn', label: 'Delayed' }
  return { className: 'badge ok', label: 'On time' }
}

export default function FlightsPage() {
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [directOnly, setDirectOnly] = useState(false)

  const criteria = useMemo<SearchCriteria>(
    () => ({
      origin: params.get('origin') ?? 'MAD',
      destination: params.get('destination') ?? 'BCN',
      date: params.get('date') ?? '',
      passengers: readPassengerCount(params.get('passengers')),
      cabin: params.get('cabin') ?? 'economy',
      sort: params.get('sort') ?? 'departure',
    }),
    [params],
  )

  const search = useCallback(() => {
    setLoading(true)
    setError(null)
    const query = new URLSearchParams({
      passengers: String(criteria.passengers),
      cabin: criteria.cabin,
      sort: criteria.sort,
    })
    if (criteria.origin) query.set('origin', criteria.origin)
    if (criteria.destination) query.set('destination', criteria.destination)
    if (criteria.date) query.set('date', criteria.date)

    api<SearchResults>(`/api/flights/search?${query.toString()}`)
      .then(setData)
      .catch((err: Error) => {
        setError(err.message)
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [criteria])

  useEffect(() => {
    search()
  }, [search])

  const results = (data?.results ?? []).filter(
    (offer) => !directOnly || offer.duration_minutes < 240,
  )
  const cheapest = results.length ? Math.min(...results.map((offer) => offer.fare_eur)) : null
  const cabinLabel = CABINS.find((cabin) => cabin.value === criteria.cabin)?.label ?? 'Economy'

  return (
    <>
      <div className="page-head">
        <h1>
          {criteria.origin || 'Anywhere'} → {criteria.destination || 'Anywhere'}
        </h1>
        <p>
          {cabinLabel} · {criteria.passengers} passenger{criteria.passengers > 1 ? 's' : ''}
          {criteria.date ? ` · ${formatDate(criteria.date)}` : ' · all dates'}
        </p>
      </div>

      <SearchWidget
        initial={criteria}
        busy={loading}
        onSearch={(next) => setParams(next)}
      />

      {error && <div className="error">{error}</div>}

      <div className="layout-sidebar">
        <aside>
          <div className="card">
            <h3>Filter</h3>
            <div className="field">
              <label htmlFor="sort">Sort by</label>
              <select
                id="sort"
                value={criteria.sort}
                onChange={(event) => {
                  const next = new URLSearchParams(params)
                  next.set('sort', event.target.value)
                  setParams(next)
                }}
              >
                {SORTS.map((sort) => (
                  <option key={sort.value} value={sort.value}>
                    {sort.label}
                  </option>
                ))}
              </select>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 500 }}>
              <input
                type="checkbox"
                style={{ width: 16 }}
                checked={directOnly}
                onChange={(event) => setDirectOnly(event.target.checked)}
              />
              Short-haul only (under 4h)
            </label>
            <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0' }} />
            <div className="summary-row">
              <span className="muted">Flights found</span>
              <strong>{results.length}</strong>
            </div>
            <div className="summary-row">
              <span className="muted">Lowest fare</span>
              <strong>{cheapest === null ? '—' : `€${cheapest.toFixed(2)}`}</strong>
            </div>
            <div className="summary-row">
              <span className="muted">Search time</span>
              <strong>{data ? `${data.query_ms} ms` : '—'}</strong>
            </div>
          </div>
        </aside>

        <div>
          {!results.length ? (
            <div className="card empty">
              <h3>{loading ? 'Searching the schedule…' : 'No flights match this search'}</h3>
              <p className="muted">Try another date, cabin or destination.</p>
            </div>
          ) : (
            results.map((offer) => {
              const badge = statusBadge(offer.status)
              return (
                <article className="flight-card" key={offer.flight_id}>
                  <div>
                    <div className="flight-times">
                      <div className="flight-endpoint">
                        <div className="time">{formatTime(offer.scheduled_departure)}</div>
                        <div className="place">{offer.origin}</div>
                      </div>
                      <div className="flight-path">
                        {formatDuration(offer.duration_minutes)}
                        <div className="line" />
                        Direct
                      </div>
                      <div className="flight-endpoint">
                        <div className="time">{formatTime(offer.scheduled_arrival)}</div>
                        <div className="place">{offer.destination}</div>
                      </div>
                    </div>
                    <div className="flight-meta">
                      <strong>{offer.flight_number}</strong>
                      <span>{formatDate(offer.scheduled_departure)}</span>
                      <span className={badge.className}>{badge.label}</span>
                      <span>{offer.seats_available} seats left</span>
                    </div>
                  </div>
                  <div className="flight-buy">
                    <div className="fare">€{offer.fare_eur.toFixed(2)}</div>
                    <div className="fare-note">
                      per passenger · {cabinLabel.toLowerCase()}
                    </div>
                    <Link
                      className="btn"
                      to={`/book/${offer.flight_id}?cabin=${criteria.cabin}&passengers=${criteria.passengers}`}
                    >
                      Select fare
                    </Link>
                  </div>
                </article>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
