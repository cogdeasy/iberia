# VULN-032 — Client-supplied booking total (price override)

| Field | Value |
|-------|-------|
| ID | VULN-032 |
| Domain | booking |
| CWE | CWE-602 (Client-Side Enforcement of Server-Side Security) / CWE-841 (Improper Enforcement of Behavioral Workflow) |
| OWASP Top 10 (2021) | A04:2021 – Insecure Design |
| Severity | High |
| Location | `backend/app/routers/booking.py:67-69`, `backend/app/schemas/booking.py:39-47` (`BookingCreate.total_eur`) |
| Introduced by | Workstream 3 — Booking & PNR |

## Description

`BookingCreate` accepts an optional `total_eur`. `create_booking` computes the correct price
(`quote_total` = fare × cabin multiplier × passengers) but then discards it whenever the request
body carries a total:

```python
quoted = booking_service.quote_total(flight, payload.cabin, len(payload.passengers))
total_eur = payload.total_eur if payload.total_eur is not None else quoted
```

The field is undocumented in `docs/API_CONTRACTS.md` and the web UI never sends it, so the
happy path always prices correctly — the flaw is only reachable by crafting the request
directly. The persisted `total_eur` is what the payments domain later authorises, so a €0
booking becomes a €0 (or €0.01) card authorisation for a real seat.

## Reproduction

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' | jq -r .access_token)

curl -s -X POST http://127.0.0.1:8000/api/bookings -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"flight_id":1,"cabin":"business","contact_email":"customer@iberia.demo","total_eur":0,
       "passengers":[{"first_name":"Zero","last_name":"Cost"}]}'
```

Expected insecure result: HTTP 201 with `"total_eur": 0.0` on a business-cabin PNR whose real
fare is `base_fare_eur × 2.75`.

## Blast radius

Direct revenue loss with no upper bound: any authenticated customer can self-serve free or
arbitrarily discounted tickets in any cabin, and the fraud is invisible to the payments domain
because the amount it authorises matches the booking record. Detectable only by reconciling
`bookings.total_eur` against the published fare after the fact.

## Intended remediation

* Remove `total_eur` from `BookingCreate` entirely (server-side pricing only) and forbid
  unknown fields with `model_config = ConfigDict(extra="forbid")`.
* Keep the fare snapshot server-side; if a discount is genuinely needed, accept a signed
  promotion/voucher code and re-price on the server.
* Add a test asserting a request containing `total_eur` is rejected (422) or ignored.

## Detection hints

* Grep: assignments of a request-body field to a money column — `payload.total_eur`,
  `payload.amount`, `payload.price`.
* Log signature: `"booking created"` lines where `total_eur` differs from `quoted_eur`.
* Reconciliation query: `SELECT pnr FROM bookings WHERE total_eur = 0`.
