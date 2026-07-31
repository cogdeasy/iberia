import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { PageMeta } from '../lib/pages'
import { api, getUser } from '../lib/api'
import SearchWidget from '../components/SearchWidget'

export const meta: PageMeta = { path: '/', section: 'customer', nav: 'none', order: 0 }

interface FlightOffer {
  destination: string
  fare_eur: number
}

interface SearchResults {
  results: FlightOffer[]
}

const DESTINATIONS = [
  { iata: 'BCN', city: 'Barcelona', country: 'Spain', image: '/img/dest-barcelona.jpg' },
  { iata: 'JFK', city: 'New York', country: 'United States', image: '/img/dest-newyork.jpg' },
  { iata: 'EZE', city: 'Buenos Aires', country: 'Argentina', image: '/img/dest-buenosaires.jpg' },
  { iata: 'MEX', city: 'Mexico City', country: 'Mexico', image: '/img/dest-mexicocity.jpg' },
  { iata: 'CDG', city: 'Paris', country: 'France', image: '/img/dest-paris.jpg' },
  { iata: 'LHR', city: 'London', country: 'United Kingdom', image: '/img/dest-london.jpg' },
]

const SERVICES = [
  {
    icon: '🧳',
    title: 'Manage your trip',
    body: 'Change dates, add bags or request a refund on any booking.',
    to: '/bookings',
  },
  {
    icon: '🛫',
    title: 'Check in online',
    body: 'Open from 48 hours before departure. Boarding pass on your phone.',
    to: '/checkin',
  },
  {
    icon: '✈️',
    title: 'Flight status',
    body: 'Live departures, delays and rebooking options during disruption.',
    to: '/flights',
  },
  {
    icon: '💬',
    title: 'Help centre',
    body: 'Baggage, EU261 compensation and contact-centre requests.',
    to: '/support',
  },
]

export default function HomePage() {
  const navigate = useNavigate()
  const user = getUser()
  const [fares, setFares] = useState<Record<string, number>>({})

  useEffect(() => {
    api<SearchResults>('/api/flights/search?origin=MAD&sort=fare')
      .then((data) => {
        const cheapest: Record<string, number> = {}
        for (const offer of data.results) {
          const current = cheapest[offer.destination]
          if (current === undefined || offer.fare_eur < current) {
            cheapest[offer.destination] = offer.fare_eur
          }
        }
        setFares(cheapest)
      })
      .catch(() => setFares({}))
  }, [])

  const greeting = useMemo(() => {
    if (!user) return 'Where would you like to fly?'
    return `Welcome back, ${user.full_name.split(' ')[0]}.`
  }, [user])

  return (
    <>
      <section className="hero-banner" style={{ backgroundImage: 'url(/img/hero-madrid.jpg)' }}>
        <div className="wrap">
          <div className="hero-eyebrow">Iberia · Fly Spain to the world</div>
          <h1>{greeting}</h1>
          <p>
            Over 120 destinations across Europe, the Americas and Africa — book in seconds, earn
            Avios on every flight.
          </p>
        </div>
      </section>

      <div className="wrap">
        <SearchWidget
          onSearch={(params) => navigate(`/flights?${params.toString()}`)}
          variant="widget"
        />
      </div>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <h2>Popular destinations from Madrid</h2>
              <p>Lowest one-way economy fares currently loaded in the schedule.</p>
            </div>
            <Link className="btn ghost" to="/flights">
              See all flights
            </Link>
          </div>
          <div className="dest-grid">
            {DESTINATIONS.map((destination) => (
              <Link
                key={destination.iata}
                className="dest-card"
                to={`/flights?origin=MAD&destination=${destination.iata}`}
              >
                <img src={destination.image} alt={destination.city} loading="lazy" />
                <div className="dest-card-body">
                  <div>
                    <h3>{destination.city}</h3>
                    <span>
                      {destination.country} · MAD → {destination.iata}
                    </span>
                  </div>
                  <div className="dest-price">
                    <span>from</span>
                    <strong>
                      {fares[destination.iata] === undefined
                        ? '—'
                        : `€${Math.round(fares[destination.iata])}`}
                    </strong>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap">
          <div className="section-head">
            <div>
              <h2>Everything for your trip</h2>
              <p>Manage bookings, check in and get help — all in one place.</p>
            </div>
          </div>
          <div className="tiles">
            {SERVICES.map((service) => (
              <Link key={service.to} className="tile" to={service.to}>
                <div className="tile-icon">{service.icon}</div>
                <h3>{service.title}</h3>
                <p>{service.body}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="promo">
            <div>
              <h2>Iberia Plus</h2>
              <p>
                Collect Avios on every flight and spend them on seats, upgrades and companion
                tickets. Elite tiers add lounge access, extra baggage and priority boarding.
              </p>
              <Link className="btn gold" to="/loyalty">
                {user ? 'View my Avios' : 'Join Iberia Plus'}
              </Link>
            </div>
            <div className="promo-stats">
              <div className="promo-stat">
                <strong>4</strong>
                <span>Elite tiers</span>
              </div>
              <div className="promo-stat">
                <strong>2×</strong>
                <span>Avios in Business</span>
              </div>
              <div className="promo-stat">
                <strong>0 €</strong>
                <span>Award seat fees</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
