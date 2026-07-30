# VULN-101 — Insecure direct object reference on rebooking leaks itinerary and passenger PII

| Field | Value |
|-------|-------|
| ID | VULN-101 |
| Domain | irregular operations (`irrops`) |
| CWE | CWE-639 (Authorization Bypass Through User-Controlled Key), with CWE-200 (Exposure of Sensitive Information) |
| OWASP Top 10 (2021) | A01:2021 – Broken Access Control |
| Severity | High |
| Location | `backend/app/routers/irrops.py:115-183` (dependency at line 122, response at line 182); schema field `backend/app/schemas/irrops.py:45-51` |
| Introduced by | Workstream 7 — irregular operations & rebooking |

## Description

`POST /api/irrops/disruptions/{id}/rebook` takes the target PNR straight from the request body
and acts on it:

```python
itinerary = load_itinerary(db, payload.pnr.upper())    # line 128
```

Two controls are missing:

1. **No ownership check.** The handler never compares the itinerary's owner (its
   `contact_email`, or the booking's `user_id` when the booking domain is deployed) with
   `user.email`. Any authenticated caller can rebook *any* PNR.
2. **No role check.** Re-accommodation is an agent/ops action but the dependency is
   `Depends(current_user)` (line 122) rather than `Depends(require_roles("agent", "ops", "admin"))`.

The impact is amplified by the response body, which echoes the whole itinerary back to the
caller (line 182, `"booking": itinerary.as_payload()`), including `contact_email` and each
passenger's `document_number` (passport/ID). PNRs are short, uppercase and low-entropy, so they
can be enumerated.

## Reproduction

```bash
# Log in as customer@iberia.demo — the owner of PNR IB3ZT9 is frequent@iberia.demo
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# Rebook somebody else's PNR onto the next flight and read their PII back
curl -s -X POST http://127.0.0.1:8000/api/irrops/disruptions/2/rebook \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"pnr":"IB3ZT9"}' | python3 -m json.tool
```

Expected insecure result: `HTTP 200` with the victim's itinerary, e.g.

```json
{
  "pnr": "IB3ZT9",
  "rebooked_to": { "flight_number": "IB4019", "origin": "MAD", "destination": "JFK", "...": "..." },
  "compensation_eur": 600.0,
  "booking": {
    "contact_email": "frequent@iberia.demo",
    "passengers": [
      { "first_name": "Marco", "last_name": "Ortega", "seat": "2A", "document_number": "ESP771904K" }
    ]
  }
}
```

The victim's flight has actually been changed (their itinerary now points at the replacement
flight with status `rebooked`), and a `RebookingEvent` is written attributing the change to the
attacker. Enumerating the PNR space (`IB` + 4 alphanumerics) harvests contact e-mails and
document numbers at scale.

## Blast radius

* **Confidentiality:** passenger name, seat, contact e-mail, travel-document number and fare
  paid for any PNR in the system — everything needed for passenger impersonation at a call
  centre or airport desk.
* **Integrity:** an attacker can move arbitrary passengers onto different flights, causing
  missed connections and no-shows.
* **Availability/cost:** each call records a compensation figure (up to €600) against the
  disruption, inflating EU261 liability reporting.
* Combined with **VULN-100**, an unprivileged user can cancel a flight and then move other
  people's PNRs around it end-to-end.

## Intended remediation

```diff
-    user: User = Depends(current_user),
+    user: User = Depends(require_roles("agent", "ops", "admin")),
```

and an object-level check plus a minimal response body:

```python
if user.role == "customer" and itinerary.contact_email != user.email:
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown PNR")
```

* Return `404` (not `403`) so the endpoint cannot be used as a PNR oracle.
* Drop the `booking` field from `RebookOut`, or restrict it to the caller's own itinerary and
  mask `document_number` to its last two characters.
* Record every rebooking in the security audit log with actor, PNR and outcome, and rate-limit
  the endpoint to defeat enumeration.

## Detection hints

* Grep for user-supplied identifiers used without an ownership comparison:
  `rg -n "load_itinerary|payload.pnr" backend/app/routers/irrops.py` and check for any
  `contact_email`/`user_id` comparison nearby (there is none).
* Grep for PII leaving the API: `rg -n "document_number" backend/app` — a response payload
  builder (`as_payload`) is a strong signal.
* Runtime signal: `grep '"msg": "pnr rebooked"' api.log` and compare `actor` against the PNR
  owner; a customer actor on a PNR they do not own is exploitation. A single actor with many
  distinct `pnr` values in a short window indicates enumeration.
* Test pinning the behaviour: `backend/tests/test_irrops.py::test_vuln_101_rebook_leaks_other_passengers_pii`.
