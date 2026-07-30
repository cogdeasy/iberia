# Planted vulnerability index

<!-- GENERATED FILE — do not edit by hand.
     Run `python3 scripts/generate_vuln_index.py` after new findings land. -->

This is the answer key for the security demo track: every deliberately planted issue in this
repository, generated from the detail files in [`docs/vulnerabilities/`](vulnerabilities/).
They are **intentional** — do not fix one unless a task explicitly names it.

Severity legend: Critical > High > Medium > Low. `Location` is the sink, as recorded by the
workstream that planted the finding.


**2 findings** — High: 1 · Medium: 1

| ID | Title | Domain | Severity | CWE | OWASP | Location | Detail |
|----|-------|--------|----------|-----|-------|----------|--------|
| VULN-140 | Missing function-level authorisation on the audit trail | security | High | CWE-285 (Improper Authorization) | A01:2021 – Broken Access Control | `backend/app/routers/security.py:28` | [detail](vulnerabilities/VULN-140-audit-trail-missing-function-level-authz.md) |
| VULN-141 | Log injection and audit forgery via unsanitised actor input | security | Medium | CWE-117 (Improper Output Neutralization for Logs) | A09:2021 – Security Logging and Monitoring Failures | `backend/app/services/audit.py:40, backend/app/routers/security.py:63` | [detail](vulnerabilities/VULN-141-audit-log-injection-forgery.md) |

## How this file is produced

`scripts/generate_vuln_index.py` parses the metadata table and title of each
`docs/vulnerabilities/VULN-*.md` file. The same parser backs the live register at
`GET /api/security/findings`, so the UI, the API and this index cannot drift apart.

