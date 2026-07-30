# VULN-031 — Passport numbers exposed in responses and structured logs

| Field | Value |
|-------|-------|
| ID | VULN-031 |
| Domain | booking |
| CWE | CWE-532 (Insertion of Sensitive Information into Log File) / CWE-359 (Exposure of Private Information) |
| OWASP Top 10 (2021) | A02:2021 – Cryptographic Failures |
| Severity | High |
| Location | `backend/app/routers/booking.py:95-107`, `backend/app/schemas/booking.py:28-37`, `backend/app/models/booking.py:37-39` |
| Introduced by | Workstream 3 — Booking & PNR |

## Description

Travel-document numbers are treated as ordinary business data:

1. `Passenger.document_number` is stored in clear text in SQLite (no encryption, no tokenisation).
2. `PassengerOut` returns `document_number` unmasked on **every** booking response, to any
   caller who can reach the PNR (trivially easy given VULN-030).
3. `create_booking` writes the whole list of passport numbers into the JSON application log via
   `log_event(..., passenger_documents=[p.document_number for p in booking.passengers])`, so the
   PII lands in the log pipeline, the SRE dashboards' log drill-down, and any log backup.

## Reproduction

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' | jq -r .access_token)

curl -s -X POST http://127.0.0.1:8000/api/bookings -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"flight_id":1,"cabin":"economy","contact_email":"customer@iberia.demo",
       "passengers":[{"first_name":"Sara","last_name":"Molina","document_number":"PAX000999"}]}'

# response contains "document_number":"PAX000999"
# and the backend stdout contains:
# {"msg":"booking created", ..., "passenger_documents":["PAX000999"]}
```

Expected insecure result: the passport number is echoed back in the API response and appears
verbatim in the structured log line.

## Blast radius

All passengers ever booked. Anyone with log access (a much wider group than those with
production database access: SREs, log vendor, anyone reading a support ticket with a pasted log
snippet) obtains passport numbers linked to full name, date of birth and itinerary — enough for
identity fraud and immigration-document abuse. Combined with VULN-030 it is bulk-extractable
over plain HTTP.

## Intended remediation

* Mask on output: return only `document_number_masked` (e.g. `PAX****999`), or drop the field
  from customer-facing responses and expose it exclusively to `agent`/`admin` roles.
* Never log document numbers — log a passenger count and PNR instead, and add a log redaction
  filter for `document_number`/`passport` keys in `app/core/observability.py`.
* Encrypt the column at rest (or store a hash plus last 3 characters) and add a
  data-retention/purge job after travel completion.

## Detection hints

* Grep: `document_number` reaching `log_event(`, `print(`, or any response schema.
* Search logs for `passenger_documents` — the field should not exist at all.
* Test assertion: `assert "document_number" not in response.json()["passengers"][0]` for a
  customer-role caller.
