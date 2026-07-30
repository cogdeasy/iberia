# VULN-030 — IDOR on PNR retrieval and cancellation

| Field | Value |
|-------|-------|
| ID | VULN-030 |
| Domain | booking |
| CWE | CWE-639 (Authorization Bypass Through User-Controlled Key) |
| OWASP Top 10 (2021) | A01:2021 – Broken Access Control |
| Severity | Critical |
| Location | `backend/app/routers/booking.py:122-165` (`get_booking`, `cancel_booking`) |
| Introduced by | Workstream 3 — Booking & PNR |

## Description

`GET /api/bookings/{pnr}` and `POST /api/bookings/{pnr}/cancel` look the booking up purely by
its record locator (`_load()`) and never compare `booking.user_id` with the authenticated
caller. Any valid bearer token — including a plain `customer` account — is therefore enough to
read or cancel **any** PNR in the system. Only `GET /api/bookings` (the list endpoint) and
`POST /api/bookings/{pnr}/seats` scope results to the caller, which makes the gap easy to miss
in review: the domain *looks* like it enforces ownership.

Record locators are 6 characters from a 32-symbol alphabet, so they are also enumerable at
scale (~10^9 combinations, no rate limiting on the endpoint).

## Reproduction

```bash
# customer@iberia.demo owns the seeded PNR QX7T4M; frequent@iberia.demo does not.
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"frequent@iberia.demo","password":"Iberia2026!"}' | jq -r .access_token)

# read someone else's booking
curl -s http://127.0.0.1:8000/api/bookings/QX7T4M -H "Authorization: Bearer $TOKEN"

# and cancel it
curl -s -X POST http://127.0.0.1:8000/api/bookings/QX7T4M/cancel -H "Authorization: Bearer $TOKEN"
```

Expected insecure result: HTTP 200 with the full booking of another customer (names, passport
numbers, contact email, price), and a second 200 showing `"status": "cancelled"`.

## Blast radius

Every booking in the estate. An attacker with one throwaway account can harvest passenger PII
for the whole airline (see also VULN-031, which puts passport numbers in that same response)
and can perform destructive cancellations, releasing seats and triggering refund workflows for
travellers they have no relationship with.

## Intended remediation

Add an ownership guard shared by both handlers, e.g.

```python
def _load_owned(db: Session, pnr: str, user: User) -> Booking:
    booking = _load(db, pnr)
    if booking.user_id != user.id and user.role not in ("agent", "ops", "admin"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "PNR not found")
    return booking
```

Return 404 (not 403) so locators cannot be enumerated, mirror the same check on
`/seatmap`, and add regression tests asserting cross-user access fails.

## Detection hints

* Grep: `_load(db, pnr)` used without a following `user_id` comparison.
* Any handler that takes a user-controlled identifier and calls `db.scalar(select(Booking)...)`
  without a `Booking.user_id ==` predicate.
* Log signature: `"booking retrieved"` lines where `actor` does not correspond to `owner_id`.
