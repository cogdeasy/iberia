# VULN-091 — Unvalidated Avios transfer amount and non-atomic balance check

| Field | Value |
|-------|-------|
| ID | VULN-091 |
| Domain | loyalty |
| CWE | CWE-840 (Business Logic Errors), with CWE-20 (Improper Input Validation) and CWE-367 (Time-of-check Time-of-use) |
| OWASP Top 10 (2021) | A04:2021 – Insecure Design |
| Severity | Critical |
| Location | `backend/app/routers/loyalty.py:147-196` (`transfer`, sink at lines 162-186) |
| Introduced by | Workstream 6 — Iberia Plus loyalty |

## Description

`POST /api/loyalty/transfer` moves Avios between two Iberia Plus accounts. Two defects
combine:

1. **No sign validation.** `avios` is typed as `int` and never checked for being positive.
   The guard `if account.avios_balance < payload.avios` trivially passes for a negative
   amount, and the debit/credit pair is then applied as
   `sender += -avios` / `recipient += avios`. With `avios = -50000` the *sender* is credited
   50 000 Avios and the *recipient* is debited 50 000 — a negative transfer **steals** from
   the target account. Any member number obtained via VULN-090 can be drained this way.
2. **Time-of-check / time-of-use.** The balance is read, then the sender's debit is committed
   and the recipient's credit is committed in a *second* transaction, with no row locking,
   `SELECT ... FOR UPDATE`, or single-transaction wrapper. Concurrent requests all read the
   same pre-transfer balance and all pass the check, so N parallel transfers of the full
   balance move N × balance Avios (double-spend). The split commits also mean a failure
   between them loses Avios entirely — the ledger stops balancing.

The normal transfer path (a positive amount within the sender's balance) behaves correctly,
so the feature and the test suite look healthy.

## Reproduction

```bash
TOKEN=$(cd backend && .venv/bin/python -c \
  "from app.core.security import create_access_token; print(create_access_token('customer@iberia.demo','customer'))")

# baseline: victim IB7654321 holds 186,500 Avios
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/loyalty/members/IB7654321

# steal 50,000 Avios FROM the victim by transferring a negative amount TO them
curl -s -X POST http://127.0.0.1:8000/api/loyalty/transfer \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"to_plus_number":"IB7654321","avios":-50000}'

curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/loyalty/members/IB7654321
```

Expected insecure result: the attacker's own response shows
`{"balance": 54800}` (up from 4 800) while the victim's balance drops to `136500`. Repeating
the call with a large negative amount drives the victim's balance negative without limit.

Double-spend variant:

```bash
# 5 concurrent full-balance transfers all pass the same stale balance check
for i in 1 2 3 4 5; do
  curl -s -X POST http://127.0.0.1:8000/api/loyalty/transfer \
    -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d '{"to_plus_number":"IB7654321","avios":4800}' &
done; wait
```

## Blast radius

Direct theft of loyalty currency — Avios are a monetary liability, redeemable for flights and
upgrades. An attacker with one free customer account plus enumeration (VULN-090) can drain
every elite member, mint unlimited Avios into their own account through double-spend, and
corrupt the loyalty ledger so accrual/redemption reconciliation and the airline's balance
sheet no longer agree.

## Intended remediation

* Validate the amount: `avios` must be a positive integer (use `conint(gt=0)` / `Field(gt=0)`
  in `schemas/loyalty.py`) and optionally cap it per transfer and per day.
* Make the whole transfer one atomic unit of work: a single transaction with a locked read
  (`with_for_update()`) on both accounts, one `db.commit()` at the end, and a database
  `CHECK (avios_balance >= 0)` constraint as a backstop.
* Require re-authentication / step-up verification for transfers and log both legs with the
  same correlation id for reconciliation.

## Detection hints

* Grep for `avios` (or any amount field) reaching a balance mutation without a `> 0` check,
  and for handlers containing more than one `db.commit()`.
* Assertion for a regression test: `POST /api/loyalty/transfer` with a negative `avios` must
  return 400 and leave both balances unchanged.
* Logs: `iberia.loyalty` emits `avios transferred` with `avios`; any record where `avios < 0`
  is an exploit attempt.
* Ledger invariant check: `SELECT SUM(avios) FROM loyalty_transactions GROUP BY account_id`
  compared with `loyalty_accounts.avios_balance`, plus any account with a negative balance.
