# VULN-005 — JWT alg-confusion & excessively long-lived tokens

| Field | Value |
|-------|-------|
| ID | VULN-005 |
| Domain | identity |
| CWE | CWE-347 (Improper Verification of Cryptographic Signature), CWE-613 (Insufficient Session Expiration) |
| OWASP Top 10 (2021) | A02:2021 – Cryptographic Failures / A07:2021 – Identification and Authentication Failures |
| Severity | Critical |
| Location | `backend/app/routers/identity.py:49-85` |
| Introduced by | Workstream 1 — Identity (devin/iberia-identity) |

## Description

Two related JWT weaknesses:

1. **Alg confusion** — the identity token verifier (`identity_user`, used by `GET /api/auth/me`
   and the API-key endpoints) accepts `algorithms=["HS256", "none"]` and, when the token header
   says `alg: none`, decodes it with `verify_signature=False`. An attacker can forge a completely
   unsigned token for any subject/role and be authenticated as, e.g., `admin`.
2. **Excessively long-lived tokens with no revocation** — `login` mints tokens with a 30-day
   lifetime (`LONG_LIVED_TTL`) and there is no revocation list, so a leaked token stays valid for
   weeks.

The normal HS256 login flow continues to work unchanged.

## Reproduction

```bash
# Forge an unsigned admin token (no secret needed) and call an authenticated endpoint.
FORGED=$(python3 -c 'import jwt;print(jwt.encode({"sub":"admin@iberia.demo","role":"admin"},key="",algorithm="none"))')
curl -s http://127.0.0.1:8000/api/auth/me -H "Authorization: Bearer $FORGED"
# -> {"email":"admin@iberia.demo","role":"admin", ...}

# Long-lived token: a normal login token carries an exp ~30 days out.
python3 -c 'import jwt,sys;print(jwt.decode(sys.argv[1],options={"verify_signature":False})["exp"])' "$LOGIN_TOKEN"
```

Expected insecure result: authentication as any user/role with a forged, unsigned token; leaked
tokens remain usable for a month.

## Blast radius

Complete authentication bypass on any endpoint resolved via `identity_user`; prolonged validity
of stolen tokens across the whole platform.

## Intended remediation

Verify with a fixed `algorithms=["HS256"]` only (never accept `none`), reject tokens whose header
alg is not the expected one, shorten the token TTL (e.g. 15–60 minutes) with refresh tokens, and
add a revocation/deny-list mechanism.

## Detection hints

* `algorithms=["HS256", "none"]` or `verify_signature=False` in a token decoder.
* `jwt.get_unverified_header` branching on `alg == "none"`.
* Token `exp` set days/weeks into the future.
