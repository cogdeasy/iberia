# VULN-XXX — <short title>

| Field | Value |
|-------|-------|
| ID | VULN-XXX |
| Domain | <identity / booking / payments / ...> |
| CWE | CWE-XXX (<name>) |
| OWASP Top 10 (2021) | AXX:2021 – <name> |
| Severity | Critical / High / Medium / Low |
| Location | `backend/app/routers/<file>.py:<lines>` |
| Introduced by | <session/PR> |

## Description

What is wrong and why it is exploitable.

## Reproduction

```bash
# a copy-pasteable request against a locally running app
curl -s http://127.0.0.1:8000/api/...
```

Expected insecure result: <what an attacker gets>.

## Blast radius

What an attacker can reach, and which data or users are affected.

## Intended remediation

The fix a reviewer should propose (parameterised query, ownership check, role dependency,
output encoding, allow-list, etc.).

## Detection hints

Grep patterns, log signatures or test assertions that reveal the issue.
