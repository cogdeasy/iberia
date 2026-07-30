# Demo notes — Booking & PNR

## Surfaces

| Surface | Path |
|---------|------|
| Passenger entry / PNR creation | `/book/:flightId` |
| My bookings (status, seats, cancel) | `/bookings` |
| API | `/api/bookings` (create, list, get, cancel, seatmap, seats) |

Seeded PNRs (deterministic, `python seed.py`):

| PNR | Owner | Route | Cabin | Payment |
|-----|-------|-------|-------|---------|
| `QX7T4M` | customer@iberia.demo | MAD→JFK | economy | paid |
| `RB2K9D` | customer@iberia.demo | MAD→BCN | economy | unpaid |
| `ZL5V8P` | frequent@iberia.demo | MAD→LHR | business | paid |
| `HD3N6W` | frequent@iberia.demo | MAD→MEX | business | unpaid |

## SRE track

Booking is the checkout path used by scenario **S1 — checkout latency** (payment-provider
timeout cascading into a booking p95 breach) and is the traffic source for the booking
availability SLO. Signals to point at during the demo:

* `iberia_domain_events_total{domain="booking",event=~"created|cancelled|seats_assigned"}`
  — business throughput; a flat `created` line while traffic continues means checkout is broken.
* `iberia_http_request_duration_seconds{route="/api/bookings"}` — p95 for the SLO burn rate.
* `iberia_http_requests_total{route=~"/api/bookings.*",status=~"5.."}` — error-rate signal.
* Log drill-down: JSON lines `"booking created"` / `"booking cancelled"` carry `pnr`,
  `request_id`, `total_eur` and `quoted_eur`, so an incident can be traced from an alert to a
  single PNR.

`POST /api/bookings` reads the flight, counts sold seats and writes the PNR plus passengers in
one transaction, so chaos-injected database slow-queries surface here first.

## Security track

Three planted findings live in this domain — see
`docs/vulnerabilities/VULN-030-booking-idor.md`, `VULN-031-passport-pii-exposure.md` and
`VULN-032-client-supplied-total.md`. Suggested narrative: read another customer's PNR with a
throwaway account (VULN-030), show the passport number in the response and in the log line
(VULN-031), then book a business seat for €0 (VULN-032).
