import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PageMeta } from '../lib/pages'
import { api } from '../lib/api'

export const meta: PageMeta = {
  path: '/flights',
  title: 'Flights',
  section: 'customer',
  order: 10,
}

interface Airport {
  iata: string
  name: string
  city: string
  country: string
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

const CABINS = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium economy' },
  { value: 'business', label: 'Business' },
]

const SORTS = [
  { value: 'departure', label: 'Departure time' },
  { value: 'fare', label: 'Lowest fare' },
  { value: 'fare_desc', label: 'Highest fare' },
  { value: 'number', label: 'Flight number' },
]

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short' })
}

function formatDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

function statusClass(status: string): string {
  if (status === 'cancelled') return 'badge crit'
  if (status === 'delayed') return 'badge warn'
  return 'badge ok'
}

export default function FlightsPage() {
  const [airports, setAirports] = useState<Airport[]>([])
  const [origin, setOrigin] = useState('MAD')
  const [destination, setDestination] = useState('BCN')
  const [date, setDate] = useState('')
  const [passengers, setPassengers] = useState(1)
  const [cabin, setCabin] = useState('economy')
  const [sort, setSort] = useState('departure')
  const [data, setData] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Airport[]>('/api/flights/airports')
      .then(setAirports)
      .catch((err: Error) => setError(err.message))
  }, [])

  const search = useCallback(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      passengers: String(passengers),
      cabin,
      sort,
    })
    if (origin) params.set('origin', origin)
    if (destination) params.set('destination', destination)
    if (date) params.set('date', date)

    api<SearchResults>(`/api/flights/search?${params.toString()}`)
      .then(setData)
      .catch((err: Error) => {
        setError(err.message)
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [origin, destination, date, passengers, cabin, sort])

  useEffect(() => {
    search()
    // Initial load only; subsequent searches are driven by the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    search()
  }

  return (
    <>
      <section className="hero">
        <h1>Find a flight</h1>
        <p>Live schedule, availability and cabin-adjusted fares across the Iberia network.</p>
      </section>

      {error && <div className="error">{error}</div>}

      <form className="card" onSubmit={onSubmit}>
        <div className="grid cols-3">
          <div className="field">
            <label htmlFor="origin">From</label>
            <select id="origin" value={origin} onChange={(e) => setOrigin(e.target.value)}>
              <option value="">Any origin</option>
              {airports.map((a) => (
                <option key={a.iata} value={a.iata}>
                  {a.city} ({a.iata})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="destination">To</label>
            <select
              id="destination"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              <option value="">Any destination</option>
              {airports.map((a) => (
                <option key={a.iata} value={a.iata}>
                  {a.city} ({a.iata})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="date">Departure date</label>
            <input
              id="date"
              type="date"
              value={date}
              min={today()}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="passengers">Passengers</label>
            <select
              id="passengers"
              value={passengers}
              onChange={(e) => setPassengers(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cabin">Cabin</label>
            <select id="cabin" value={cabin} onChange={(e) => setCabin(e.target.value)}>
              {CABINS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sort">Sort by</label>
            <select id="sort" value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn" type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Search flights'}
        </button>
      </form>

      <div className="grid cols-3">
        <div className="card">
          <div className="kpi-label">Offers found</div>
          <div className="kpi">{data?.count ?? '—'}</div>
          <p className="muted">for {passengers} passenger(s)</p>
        </div>
        <div className="card">
          <div className="kpi-label">Search latency</div>
          <div className="kpi">{data ? `${data.query_ms} ms` : '—'}</div>
          <p className="muted">backend query time</p>
        </div>
        <div className="card">
          <div className="kpi-label">Cabin</div>
          <div className="kpi">{CABINS.find((c) => c.value === cabin)?.label}</div>
          <p className="muted">business ≈ 2.5× base fare</p>
        </div>
      </div>

      <div className="card">
        <h2>Results</h2>
        {!data?.results.length ? (
          <p className="muted">
            {loading ? 'Searching the schedule…' : 'No flights match this search.'}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Flight</th>
                <th>Route</th>
                <th>Departs</th>
                <th>Arrives</th>
                <th>Duration</th>
                <th>Seats</th>
                <th>Status</th>
                <th>Fare</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.results.map((offer) => (
                <tr key={offer.flight_id}>
                  <td>
                    <strong>{offer.flight_number}</strong>
                  </td>
                  <td>
                    {offer.origin} → {offer.destination}
                  </td>
                  <td>
                    {formatDate(offer.scheduled_departure)} {formatTime(offer.scheduled_departure)}
                  </td>
                  <td>
                    {formatDate(offer.scheduled_arrival)} {formatTime(offer.scheduled_arrival)}
                  </td>
                  <td>{formatDuration(offer.duration_minutes)}</td>
                  <td>{offer.seats_available}</td>
                  <td>
                    <span className={statusClass(offer.status)}>{offer.status}</span>
                  </td>
                  <td>
                    <strong>€{offer.fare_eur.toFixed(2)}</strong>
                  </td>
                  <td>
                    <Link className="btn" to={`/book/${offer.flight_id}`}>
                      Select
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
