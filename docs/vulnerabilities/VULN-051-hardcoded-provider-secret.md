# VULN-051 — Hardcoded payment provider API key and webhook signing secret

| Field | Value |
|-------|-------|
| ID | VULN-051 |
| Domain | payments |
| CWE | CWE-798 (Use of Hard-coded Credentials) |
| OWASP Top 10 (2021) | A07:2021 – Identification and Authentication Failures (also A05:2021 – Security Misconfiguration) |
| Severity | High |
| Location | `backend/app/services/payments.py:24-31` |
| Introduced by | Workstream 4 — payments |

## Description

The payment acquirer credentials are literals in application source instead of configuration:

```python
PROVIDER_API_KEY = "sk_live_iberia_demo_51H8fakeKEYnotreal0000"
PROVIDER_WEBHOOK_SIGNING_SECRET = "whsec_iberia_demo_f4k3_s1gn1ng_s3cr3t"
PROVIDER_BASE_URL = "https://payments.provider.invalid/v1"
```

The key is named `sk_live_*`, i.e. a production secret committed to git. Anyone with repository
read access — contractors, CI logs, a mirrored fork, a leaked backup — obtains the ability to
charge and refund through the acquirer directly, and the signing secret lets them forge
provider webhook callbacks into the platform. Rotation requires a code change and redeploy, so
in practice it never happens. (Values here are obviously fake demo strings.)

## Reproduction

```bash
# the secret is reachable without any credentials — it is in the repository
grep -rn "sk_live_\|whsec_" backend/app/services/payments.py
```

Running instance (the secret is also emitted on the provider-timeout log path, so it reaches
log aggregation):

```bash
curl -s -X POST http://127.0.0.1:8000/api/sre/chaos \
  -H "Authorization: Bearer $SRE_TOKEN" -H 'Content-Type: application/json' \
  -d '{"target":"payments","mode":"latency","latency_ms":9000,"enabled":true}'
# then authorise a payment and inspect the backend logs for provider_url / provider fields
```

Expected insecure result: a live-named acquirer API key and webhook signing secret are
obtainable from source (and from log output) with no authentication at all.

## Blast radius

Full impersonation of Iberia against the payment provider: create charges, issue refunds to
attacker-controlled cards, read transaction history, and forge signed webhooks that mark
unpaid bookings as `paid`. Because the same literal is in every deployment, one leak
compromises all environments.

## Intended remediation

* Move both values into `app/core/config.py` (`settings`), sourced from environment variables /
  a secret manager; fail startup if unset in non-local environments.
* Rotate the leaked key at the provider and purge it from git history.
* Verify webhooks with the secret loaded from config using a constant-time comparison.
* Add a secret scanner (gitleaks / `detect-secrets`) to CI to prevent recurrence.

## Detection hints

* Grep patterns: `sk_live_`, `sk_test_`, `whsec_`, `API_KEY = "`, `SECRET = "`.
* Any module-level uppercase constant assigned a long opaque string literal.
* Test asserting presence: `backend/tests/test_payments.py::test_planted_vuln_051_hardcoded_provider_secret_present`.
