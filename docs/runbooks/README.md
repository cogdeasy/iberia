# Runbooks

One markdown file per alert rule, named after the alert (`<AlertName>.md`), each containing:

1. **Alert** — expression, `for` duration, severity, and the service it fires on.
2. **Impact** — what a passenger or agent experiences.
3. **Dashboards & queries** — the exact PromQL / log queries to run first.
4. **Triage steps** — ordered checks with expected outputs.
5. **Mitigations** — the safe short-term action (feature flag, scale, disable chaos toggle).
6. **Root-cause pointers** — code paths that historically cause this alert.
7. **Escalation** — who to page next.
