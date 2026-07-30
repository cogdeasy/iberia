# VULN-090 — Broken object-level authorisation on Iberia Plus member lookup

| Field | Value |
|-------|-------|
| ID | VULN-090 |
| Domain | loyalty |
| CWE | CWE-639 (Authorization Bypass Through User-Controlled Key) |
| OWASP Top 10 (2021) | A01:2021 – Broken Access Control |
| Severity | High |
| Location | `backend/app/routers/loyalty.py:52-72` (`get_member`, sink at line 60) |
| Introduced by | Workstream 6 — Iberia Plus loyalty |

## Description

`GET /api/loyalty/members/{plus_number}` resolves the account purely from the path
parameter. The endpoint requires a valid bearer token (`Depends(current_user)`) but never
checks that the caller owns the account, nor that the caller holds a servicing role such as
`agent` or `admin`. Any logged-in customer can therefore read another member's full name,
Avios balance, tier, tier points and complete transaction ledger.

The impact is amplified because Iberia Plus numbers are short, structured and
**sequentially allocated** (`IB1234567`, `IB7654321`, … — a two-letter prefix plus seven
digits). An attacker does not need to know a victim's number: the whole keyspace can be
walked with a simple loop, and there is no rate limiting on the route, so the entire
membership base can be scraped from a single low-privilege account.

## Reproduction

```bash
# any customer token works — here the low-tier customer reads the elite member's account
TOKEN=$(cd backend && .venv/bin/python -c \
  "from app.core.security import create_access_token; print(create_access_token('customer@iberia.demo','customer'))")

curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/loyalty/members/IB7654321

# enumeration: the same token walks the sequential number space
for n in $(seq 1234560 1234570); do
  curl -s -o /dev/null -w "IB$n %{http_code}\n" \
    -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/loyalty/members/IB$n
done
```

Expected insecure result: HTTP 200 with
`{"plus_number":"IB7654321","full_name":"Marco Ortega","tier":"Platino","avios_balance":186500,...}`
including the member's full transaction history, and a 200/404 oracle that reveals which
Iberia Plus numbers exist.

## Blast radius

Full read access to every Iberia Plus membership: member identity (name), loyalty status
(tier, tier points) and financial value (Avios balance) plus a travel history that leaks
routes flown. Combined with VULN-091 the attacker can pick high-balance targets discovered
by enumeration and then drain them.

## Intended remediation

* Return the caller's own account unless the caller holds a servicing role:
  `if account.user_id != user.id and user.role not in {"agent", "admin"}: raise HTTPException(403)`
  — i.e. wrap the servicing path in `Depends(require_roles("agent", "admin"))` and keep
  `GET /api/loyalty/me` as the self-service route.
* Return 404 (not 403) uniformly for accounts the caller may not see, so the endpoint is not
  an existence oracle.
* Add rate limiting / anomaly detection on member lookups, and stop allocating Iberia Plus
  numbers sequentially (use a non-guessable public identifier).

## Detection hints

* Grep: `routers/loyalty.py` for a path parameter used directly in a `select(...).where(...)`
  with no comparison against `user.id`.
* Grep for handlers that depend on `current_user` but never reference `user` other than for
  logging.
* Logs: `iberia.loyalty` emits `loyalty member lookup` with `caller` and `plus_number`; a
  single `caller` hitting many distinct `plus_number` values within minutes is enumeration.
* Metric: `iberia_domain_events_total{domain="loyalty",event="member_lookup"}` spiking
  relative to `member_viewed`.
