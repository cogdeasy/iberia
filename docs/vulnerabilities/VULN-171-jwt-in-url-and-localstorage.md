# VULN-171 — Session JWT kept in `localStorage` and leaked into the URL by "share this page"

| Field | Value |
|-------|-------|
| ID | VULN-171 |
| Domain | frontend / platform support console |
| CWE | CWE-598 (Use of GET Request Method With Sensitive Query Strings) / CWE-522 (Insufficiently Protected Credentials) |
| OWASP Top 10 (2021) | A02:2021 – Cryptographic Failures (with A07 session-handling impact) |
| Severity | High |
| Location | `frontend/src/lib/share.ts:15-24`, `frontend/src/pages/support.page.tsx:121-127` (trigger), `frontend/src/lib/api.ts:1-25` (localStorage store) |
| Introduced by | Workstream 12 — platform (`devin/iberia-platform`) |

## Description

Two weaknesses compound:

1. The access token is stored in `localStorage` under `iberia.token` (`lib/api.ts`), so it is
   readable by **any** script running on the origin — exactly what VULN-170 provides.
2. The support console's *Share this page* button calls `buildShareUrl()`, which copies that same
   token into the URL query string (`?session_token=<jwt>&shared_by=<email>`), pushes it into the
   address bar with `history.replaceState`, and copies it to the clipboard:

```ts
url.searchParams.set(TOKEN_QUERY_PARAM, token)
url.searchParams.set('shared_by', getUser()?.email ?? 'anonymous')
```

Tokens are valid for 12 hours (`IBERIA_JWT_TTL_MINUTES=720`) and the API has no revocation, so a
leaked URL is a working credential for the rest of the day. With no `Referrer-Policy`
(VULN-151) the full URL — token included — is sent in the `Referer` header of every outbound
link, and it also lands in browser history, bookmarks, sync, chat previews and any proxy or
analytics log that records URLs.

## Reproduction

1. Sign in at http://localhost:5173 as `customer@iberia.demo` / `Iberia2026!`.
2. Open **Support** (`/support`) and click **Share this page**.
3. The address bar (and clipboard) now read:
   `http://localhost:5173/support?session_token=eyJhbGciOiJIUzI1NiIs...&shared_by=customer@iberia.demo`
4. Replay the leaked token from anywhere:

```bash
TOKEN="<the session_token value from the shared URL>"
curl -s http://127.0.0.1:8000/api/platform/support/messages -H "Authorization: Bearer $TOKEN"
```

Also verify the storage side:

```js
// in any script on the origin (e.g. the XSS payload from VULN-170)
localStorage.getItem('iberia.token')
```

Expected insecure result: the token from the URL authenticates API calls as the victim; the
same token is readable by any injected script.

## Blast radius

Full account takeover for 12 hours per leaked link: bookings, passenger PII, payment history and
loyalty balances, plus anything the victim's role permits (an `admin` share link hands over the
whole console). Because the token appears in third-party referrer and proxy logs, the leak can be
passive — no user interaction with an attacker is required.

## Intended remediation

* Never place credentials in URLs. Make share links carry only a resource identifier and require
  the recipient to authenticate; if pre-authorised sharing is needed, mint a short-lived,
  single-resource, audience-scoped share token server-side.
* Move the session to a `Secure`, `HttpOnly`, `SameSite=Strict` cookie with CSRF protection so
  script cannot read it; keep tokens short-lived (minutes) with refresh + server-side revocation.
* Set `Referrer-Policy: strict-origin-when-cross-origin` and a strict CSP (VULN-151).
* Scrub `session_token`-style parameters in access logs and never log full URLs.

## Detection hints

* Grep: `searchParams.set('session_token'`, `session_token=`, `localStorage.getItem('iberia.token')`,
  `history.replaceState`.
* Access logs / Loki: `{job="iberia-backend"} |= "session_token="`.
* Any URL containing a `eyJ`-prefixed value is a JWT in a query string.
