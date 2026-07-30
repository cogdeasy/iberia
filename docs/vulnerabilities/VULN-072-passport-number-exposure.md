# VULN-072 — Passport / travel-document numbers exposed in API payloads and logs

| Field | Value |
|-------|-------|
| ID | VULN-072 |
| Domain | checkin |
| CWE | CWE-532 (Insertion of Sensitive Information into Log File), CWE-359 (Exposure of Private Personal Information) |
| OWASP Top 10 (2021) | A02:2021 – Cryptographic Failures (sensitive data exposure) |
| Severity | High |
| Location | `backend/app/schemas/checkin.py:48-49` (response field), `backend/app/routers/checkin.py:138-151` (log line, `passport_number` at 148), `backend/app/services/checkin.py:82-91` (`qr_payload`), `backend/app/services/checkin.py:94-113` (on-disk document), `backend/app/models/checkin.py:75-77` (plaintext column) |
| Introduced by | Workstream 5 — Check-in & Travel Documents |

## Description

The check-in flow treats the passport / national-ID number as ordinary, non-sensitive data
and spreads it across four sinks:

1. **API response** — `BoardingPassOut` exposes `document_number` verbatim, so every
   boarding-pass response (`POST /api/checkin/{pnr}` and
   `GET /api/checkin/{pnr}/boarding-pass/{passenger_id}`) carries the full document number.
2. **Scannable payload** — `build_qr_payload()` embeds `PASSPORT:<number>` inside
   `qr_payload`, which the frontend renders on screen and which survives in any screenshot,
   browser cache or CDN log.
3. **Structured logs** — the `passenger checked in` log line is emitted with
   `passport_number=passenger.document_number`, so the number lands in the JSON log stream
   that the SRE track ships to central logging and retains for weeks.
4. **On-disk documents** — `write_boarding_pass_document()` writes `Document : <number>`
   into `app/documents/boarding-pass-<PNR>-<id>.txt`, which is world-readable to anyone who
   can reach VULN-070.

Nothing is masked, tokenised or encrypted at rest: `checkin_passengers.document_number` and
`boarding_passes.document_number` are plain `String` columns.

## Reproduction

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

curl -s -X POST http://127.0.0.1:8000/api/checkin/XK7T2P \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}' \
  | python3 -m json.tool
```

Expected insecure result:

```json
{
  "qr_payload": "IB|XK7T2P|IB3166|MADLHR|12A|0001|PASSPORT:ESP-PA4471902|7ab04ff104",
  "document_number": "ESP-PA4471902"
}
```

and, in the backend's stdout:

```json
{"level": "INFO", "logger": "iberia.checkin", "msg": "passenger checked in",
 "passport_number": "ESP-PA4471902", "passenger_name": "Lucía Fernández", "pnr": "XK7T2P"}
```

## Blast radius

Passport numbers are special-category identity data. Because the same value appears in the
API response, the log pipeline and the document store, a single compromise of *any* of those
tiers (a log-aggregator misconfiguration, the VULN-070 file read, the VULN-071 IDOR, or a
support engineer with log access) discloses identity documents for every checked-in
passenger — sufficient for identity fraud and directly reportable under GDPR Art. 33.
Log retention also means the exposure long outlives the flight.

## Intended remediation

* Remove `document_number` from `BoardingPassOut` entirely, or expose a masked form
  (`ESP-PA****902`) behind an explicit `agent`/`admin` role check.
* Drop the document number from `qr_payload`; a BCBP payload needs the PNR, flight, seat and
  sequence, not the passport. Use the existing opaque `digest` instead.
* Redact before logging: log a salted hash or the last three characters, and add
  `passport_number` / `document_number` to a deny-list in `JsonFormatter` so the field can
  never be serialised even if a future caller passes it.
* Encrypt `document_number` at rest (or store only a tokenised reference to a dedicated
  document vault) and omit it from generated files.

## Detection hints

* Grep: `document_number`, `passport`, `passport_number` in `routers/`, `schemas/` and any
  `log_event(` call; `qr_payload` construction that interpolates a document field.
* Log query: `logger:"iberia.checkin" AND _exists_:passport_number` should return zero hits
  after remediation.
* Test assertion: `backend/tests/test_checkin.py::test_vuln_072_document_number_is_exposed`.
