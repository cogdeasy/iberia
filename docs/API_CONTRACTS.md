# API contracts

Frozen request/response shapes that multiple workstreams depend on. If you own an endpoint
listed here, implement **exactly** these paths, field names and types (you may add fields, but
never rename or remove one). If you consume one, code against this document.

All payloads are JSON. Auth is `Authorization: Bearer <jwt>`. Errors use FastAPI's
`{"detail": ...}` shape.

## Identity — `/api/auth`, `/api/users`

```
POST /api/auth/login            {email, password} -> {access_token, token_type: "bearer", user: User}
POST /api/auth/register         {email, password, full_name} -> User
GET  /api/auth/me                                            -> User
POST /api/auth/password-reset   {email} -> {status, reset_token?}
POST /api/auth/password-reset/confirm {token, new_password} -> {status}
GET  /api/users                 (admin/agent)                -> User[]
GET  /api/users/{user_id}                                    -> User
PATCH /api/users/{user_id}      partial User                 -> User

User = {id, email, full_name, role, iberia_plus_number, is_active, created_at}
```

## Flights — `/api/flights`

```
GET /api/flights/search?origin=MAD&destination=JFK&date=2026-08-01&passengers=1&cabin=economy
    -> {results: FlightOffer[], count, query_ms}
GET /api/flights/{flight_id}            -> FlightDetail
GET /api/flights/{flight_id}/availability -> {flight_id, cabins: {economy: {seats_available, fare_eur}, business: {...}}}
GET /api/flights/airports              -> Airport[]

FlightOffer = {flight_id, flight_number, origin, destination, scheduled_departure,
               scheduled_arrival, duration_minutes, cabin, fare_eur, seats_available, status}
FlightDetail = FlightOffer & {aircraft: {registration, model}, status_detail}
Airport = {iata, name, city, country}
```

## Booking — `/api/bookings`

```
POST /api/bookings           {flight_id, cabin, passengers: [{first_name, last_name, date_of_birth, document_number?}],
                              contact_email} -> Booking
GET  /api/bookings                          -> Booking[]        (caller's bookings)
GET  /api/bookings/{pnr}                    -> Booking
POST /api/bookings/{pnr}/cancel             -> Booking
GET  /api/bookings/{pnr}/seatmap            -> {rows: [{row, seats: [{seat, cabin, available, price_eur}]}]}
POST /api/bookings/{pnr}/seats {assignments: [{passenger_id, seat}]} -> Booking

Booking = {pnr, status, flight: FlightOffer, passengers: Passenger[], total_eur,
           payment_status, created_at, contact_email}
Passenger = {id, first_name, last_name, seat, checked_in, document_number}
```

## Payments — `/api/payments`

```
POST /api/payments/authorise {pnr, card_number, card_holder, expiry, cvv} -> Payment
POST /api/payments/{payment_id}/refund {amount_eur, reason}               -> Refund
GET  /api/payments                                                        -> Payment[]
GET  /api/payments/{payment_id}                                           -> Payment

Payment = {id, pnr, status, amount_eur, card_last4, card_brand, provider_reference, created_at}
Refund  = {id, payment_id, amount_eur, status, reason, created_at}
```

## Check-in — `/api/checkin`

```
POST /api/checkin/{pnr}                {passenger_ids: [int]} -> {pnr, boarding_passes: BoardingPass[]}
GET  /api/checkin/{pnr}/boarding-pass/{passenger_id}          -> BoardingPass
GET  /api/checkin/documents/{filename}                        -> file download
POST /api/checkin/{pnr}/bags           {passenger_id, weight_kg} -> {bag_tag, fee_eur}

BoardingPass = {pnr, passenger_name, flight_number, origin, destination, boarding_time,
                gate, seat, sequence, barcode, qr_payload}
```

## Loyalty — `/api/loyalty`

```
GET  /api/loyalty/me                                  -> Member
GET  /api/loyalty/members/{plus_number}               -> Member
POST /api/loyalty/accrue   {pnr}                      -> {avios_awarded, balance}
POST /api/loyalty/redeem   {flight_id, avios}         -> {balance, redemption_id}
POST /api/loyalty/transfer {to_plus_number, avios}    -> {balance}

Member = {plus_number, full_name, tier, avios_balance, tier_points, transactions: LoyaltyTxn[]}
LoyaltyTxn = {id, created_at, description, avios, balance_after}
```

## Irregular operations — `/api/irrops`

```
GET  /api/irrops/disruptions                       -> Disruption[]
POST /api/irrops/disruptions {flight_id, kind, minutes?, reason} -> Disruption   (ops/admin)
POST /api/irrops/disruptions/{id}/rebook {pnr}     -> {pnr, rebooked_to: FlightOffer, compensation_eur}
GET  /api/irrops/compensation/{pnr}                -> {pnr, eligible, regulation, amount_eur, rationale}

Disruption = {id, flight: FlightOffer, kind: "delay"|"cancellation"|"diversion",
              minutes, reason, affected_passengers, status, created_at}
```

## Reliability — `/api/sre`

```
GET  /api/sre/services                 -> Service[]
GET  /api/sre/services/{name}/signals?window_minutes=30
     -> {service, traffic_rpm, error_rate, latency_p50_ms, latency_p95_ms, latency_p99_ms,
         saturation_pct, series: [{ts, rpm, error_rate, p95_ms}]}
GET  /api/sre/slos                     -> Slo[]
GET  /api/sre/slos/{id}/error-budget   -> {slo_id, objective, achieved, budget_remaining_pct,
                                           burn_rate_1h, burn_rate_6h, status}
GET  /api/sre/chaos                    -> ChaosToggle[]
POST /api/sre/chaos {target, mode, magnitude, ttl_seconds} -> ChaosToggle   (sre/admin)
DELETE /api/sre/chaos/{target}                             -> {status}      (sre/admin)
POST /api/sre/load  {scenario, duration_seconds, rps}      -> {status, scenario}

Service = {name, tier, owner, endpoints: [str], health: "healthy"|"degraded"|"down", version}
Slo = {id, service, name, kind: "availability"|"latency", objective_pct, window_days,
       current_pct, status: "ok"|"at_risk"|"breached"}
ChaosToggle = {target, mode: "latency"|"error"|"timeout"|"slow_query"|"saturation",
               magnitude, active, expires_at}
```

## Incidents — `/api/incidents`

```
GET  /api/incidents?status=open                 -> Incident[]
POST /api/incidents {title, severity, service, summary} -> Incident   (ops/sre/admin)
GET  /api/incidents/{id}                        -> Incident
PATCH /api/incidents/{id} {status?, severity?, commander?, resolution?} -> Incident
POST /api/incidents/{id}/timeline {kind, message} -> TimelineEntry
GET  /api/incidents/{id}/postmortem             -> {incident_id, markdown}
GET  /api/incidents/alerts                      -> Alert[]   (firing alert simulation)

Incident = {id, reference, title, severity: 0|1|2|3, status: "open"|"mitigated"|"resolved",
            service, summary, commander, started_at, resolved_at, timeline: TimelineEntry[],
            slo_impact, runbook}
TimelineEntry = {id, ts, kind: "detect"|"note"|"mitigation"|"escalation"|"resolve", message, author}
Alert = {name, severity, service, state: "firing"|"pending"|"resolved", since, summary, runbook}
```

## Notifications — `/api/notifications`

```
GET  /api/notifications                           -> Notification[]
POST /api/notifications/send {pnr, template, channel} -> Notification
GET  /api/notifications/queue                     -> {depth, workers, oldest_age_seconds, dlq_depth}
POST /api/notifications/webhooks {url, event}      -> Webhook
POST /api/notifications/webhooks/{id}/test        -> {status, response_snippet}

Notification = {id, pnr, channel: "email"|"sms"|"push", template, status, created_at, body}
Webhook = {id, url, event, active, last_status}
```

## Security — `/api/security`

```
GET  /api/security/audit?limit=100     -> AuditEvent[]    (admin/sre)
GET  /api/security/findings            -> Finding[]
GET  /api/security/findings/{id}       -> Finding
GET  /api/security/posture             -> {score, counts: {critical, high, medium, low}, categories: [...]}

AuditEvent = {id, ts, actor, action, target, ip, request_id, outcome}
Finding = {id, title, severity, cwe, owasp, location, status, description, remediation}
```
