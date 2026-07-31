import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'

export interface Airport {
  iata: string
  name: string
  city: string
  country: string
}

export interface SearchCriteria {
  origin: string
  destination: string
  date: string
  passengers: number
  cabin: string
  sort: string
}

interface SearchWidgetProps {
  /** Called with the criteria encoded as query params. */
  onSearch: (params: URLSearchParams, criteria: SearchCriteria) => void
  initial?: Partial<SearchCriteria>
  /** `widget` is the raised homepage panel; `panel` is the inline card used on results. */
  variant?: 'widget' | 'panel'
  busy?: boolean
}

export const CABINS = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium economy' },
  { value: 'business', label: 'Business' },
]

/** Origin and destination are always emitted so an explicit "any" survives the round-trip. */
export function criteriaToParams(criteria: SearchCriteria): URLSearchParams {
  const params = new URLSearchParams({
    origin: criteria.origin,
    destination: criteria.destination,
    passengers: String(criteria.passengers),
    cabin: criteria.cabin,
    sort: criteria.sort,
  })
  if (criteria.date) params.set('date', criteria.date)
  return params
}

/** Cabins the booking backend prices; the widget itself only sells the first three. */
export const BOOKABLE_CABINS = ['economy', 'premium_economy', 'business', 'first']

/** Falls back to economy for a missing or unknown query-string cabin. */
export function readCabin(value: string | null): string {
  return value && BOOKABLE_CABINS.includes(value) ? value : 'economy'
}

/** Clamps a query-string passenger count to the 1–9 range the widget offers. */
export function readPassengerCount(value: string | null): number {
  const count = Number(value)
  return Number.isFinite(count) ? Math.min(9, Math.max(1, Math.trunc(count))) : 1
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function SearchWidget({
  onSearch,
  initial,
  variant = 'panel',
  busy = false,
}: SearchWidgetProps) {
  const [airports, setAirports] = useState<Airport[]>([])
  const sort = initial?.sort ?? 'departure'
  /** Sort is owned by the results page, so it is excluded here: re-seeding on a sort
   * change would wipe itinerary edits the traveller has typed but not yet submitted. */
  const initialCriteria = useMemo<SearchCriteria>(
    () => ({
      origin: initial?.origin ?? 'MAD',
      destination: initial?.destination ?? 'BCN',
      date: initial?.date ?? '',
      passengers: initial?.passengers ?? 1,
      cabin: initial?.cabin ?? 'economy',
      sort,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initial?.origin, initial?.destination, initial?.date, initial?.passengers, initial?.cabin],
  )
  const [criteria, setCriteria] = useState<SearchCriteria>(initialCriteria)

  useEffect(() => {
    setCriteria(initialCriteria)
  }, [initialCriteria])

  useEffect(() => {
    api<Airport[]>('/api/flights/airports')
      .then(setAirports)
      .catch(() => setAirports([]))
  }, [])

  const set = <K extends keyof SearchCriteria>(key: K, value: SearchCriteria[K]) =>
    setCriteria((current) => ({ ...current, [key]: value }))

  const swap = () =>
    setCriteria((current) => ({ ...current, origin: current.destination, destination: current.origin }))

  /** Keeps the select showing the selected IATA code while the airport list is still loading. */
  const pending = (iata: string) =>
    iata && !airports.some((airport) => airport.iata === iata) ? (
      <option value={iata}>{iata}</option>
    ) : null

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const next = { ...criteria, sort }
    onSearch(criteriaToParams(next), next)
  }

  return (
    <form className={variant === 'widget' ? 'search-widget' : 'card'} onSubmit={submit}>
      {variant === 'widget' && (
        <div className="search-tabs">
          <button type="button" className="search-tab is-active">
            Book a flight
          </button>
          <Link className="search-tab" to="/checkin">
            Check-in
          </Link>
          <Link className="search-tab" to="/bookings">
            My trips
          </Link>
        </div>
      )}
      <div className="search-row">
        <div className="field">
          <label htmlFor="origin">From</label>
          <select id="origin" value={criteria.origin} onChange={(e) => set('origin', e.target.value)}>
            <option value="">Any origin</option>
            {pending(criteria.origin)}
            {airports.map((airport) => (
              <option key={airport.iata} value={airport.iata}>
                {airport.city} ({airport.iata})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="destination">
            To{' '}
            <button
              type="button"
              className="link-swap"
              onClick={swap}
              aria-label="Swap origin and destination"
            >
              ⇄ swap
            </button>
          </label>
          <select
            id="destination"
            value={criteria.destination}
            onChange={(e) => set('destination', e.target.value)}
          >
            <option value="">Any destination</option>
            {pending(criteria.destination)}
            {airports.map((airport) => (
              <option key={airport.iata} value={airport.iata}>
                {airport.city} ({airport.iata})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="date">Departure</label>
          <input
            id="date"
            type="date"
            value={criteria.date}
            min={today()}
            onChange={(e) => set('date', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="passengers">Passengers</label>
          <select
            id="passengers"
            value={criteria.passengers}
            onChange={(e) => set('passengers', Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'passenger' : 'passengers'}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cabin">Cabin</label>
          <select id="cabin" value={criteria.cabin} onChange={(e) => set('cabin', e.target.value)}>
            {CABINS.map((cabin) => (
              <option key={cabin.value} value={cabin.value}>
                {cabin.label}
              </option>
            ))}
          </select>
        </div>
        <div className="search-submit">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Searching…' : 'Search flights'}
          </button>
        </div>
      </div>
    </form>
  )
}
