# VULN-050 — Reversible storage of the full card PAN

| Field | Value |
|-------|-------|
| ID | VULN-050 |
| Domain | payments |
| CWE | CWE-327 (Use of a Broken or Risky Cryptographic Algorithm) / CWE-311 (Missing Encryption of Sensitive Data) |
| OWASP Top 10 (2021) | A02:2021 – Cryptographic Failures |
| Severity | Critical |
| Location | `backend/app/services/payments.py:30-100` (key + `vault_pan`/`unvault_pan`), `backend/app/models/payments.py:25-29` (`Payment.card_pan_vault`), `backend/app/routers/payments.py:124-163` (`GET /api/payments/{id}/debug`) |
| Introduced by | Workstream 4 — payments |

## Description

Card authorisation stores the **full primary account number** rather than a provider token.
`vault_pan()` "encrypts" the PAN by XOR-ing it with the hardcoded key `PAN_VAULT_KEY =
"iberia-demo-pan-key"` and base64-encoding the result, and `unvault_pan()` reverses it with
the same key. Anyone with the source (or the ability to guess a 19-byte repeating key from
known plaintext — card numbers are all digits, so the keystream leaks immediately) can decrypt
every stored PAN.

The "vault" is then exposed over HTTP: `GET /api/payments/{payment_id}/debug` decrypts the PAN
and returns it as `card_number` (and the raw ciphertext as `card_pan_vault`). The endpoint is
also documented as a support/debug view but only requires *any* authenticated session — no
role check — and the decrypted PAN is additionally written to the application log
(`payment debug view`, field `card_number`), so the cardholder data leaks into log storage too.

The normal UI path correctly displays `card_last4` + `card_brand`; the finding is that the
full PAN remains recoverable at all.

## Reproduction

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')

# authorise a card
PAYMENT=$(curl -s -X POST http://127.0.0.1:8000/api/payments/authorise \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"pnr":"IBDEMO","card_number":"4111111111111111","card_holder":"Lucia Fernandez","expiry":"12/29","cvv":"123"}')
ID=$(echo "$PAYMENT" | python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])')

# recover the full PAN
curl -s http://127.0.0.1:8000/api/payments/$ID/debug -H "Authorization: Bearer $TOKEN"
```

Expected insecure result: the response contains `"card_number": "4111111111111111"` — the
complete PAN, plus cardholder name and expiry, i.e. everything needed for card-not-present
fraud. The same value can also be recovered straight from the SQLite file:

```bash
python3 - <<'PY'
import base64, sqlite3
key = b"iberia-demo-pan-key"
for (vault,) in sqlite3.connect("backend/iberia.db").execute("SELECT card_pan_vault FROM payments"):
    raw = base64.b64decode(vault)
    print(bytes(b ^ key[i % len(key)] for i, b in enumerate(raw)).decode())
PY
```

## Blast radius

Every card ever used on the platform. A read-only database dump, a log export, or one
authenticated low-privilege session is enough to exfiltrate full PAN + holder + expiry for all
passengers — a reportable PCI-DSS (requirements 3.4/3.5) failure with direct financial fraud
impact.

## Intended remediation

* Never persist the PAN: send it to the provider and store only the returned token plus
  `card_last4`/`card_brand`/expiry. Drop the `card_pan_vault` column.
* If any at-rest storage is unavoidable, use an authenticated AEAD cipher with keys from a KMS
  and strict key rotation — never a static XOR/base64 transform in source control.
* Delete the `/debug` endpoint (or restrict it to `require_roles("admin")` and return only
  masked data), and remove cardholder data from log fields.

## Detection hints

* Grep for `base64`, `XOR`, `^ key[`, or names like `vault`, `cipher`, `encrypt` in payment code.
* Any column holding `card`/`pan` alongside a `last4` column is suspicious.
* Log signature: `"msg": "payment debug view"` with a `card_number` field.
* Test that asserts recoverability: `backend/tests/test_payments.py::test_planted_vuln_050_pan_is_recoverable`.
