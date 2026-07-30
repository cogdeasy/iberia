# VULN-112 — Template injection / unescaped notification rendering

| Field | Value |
|-------|-------|
| ID | VULN-112 |
| Domain | notifications |
| CWE | CWE-79 (Improper Neutralization of Input During Web Page Generation) / CWE-116 (Improper Encoding or Escaping of Output) |
| OWASP Top 10 (2021) | A03:2021 – Injection |
| Severity | Medium |
| Location | `backend/app/services/notifications.py:138-148` (`render_template`) + `backend/app/routers/notifications.py:92-95` (`send`) |
| Introduced by | Workstream 10 — notifications (branch `devin/iberia-notifications`) |

## Description

`POST /api/notifications/send` accepts a free-form `context` mapping that is merged into the
chosen template and interpolated into the notification body with **no output encoding**:

```python
merged = default_context(...) | {k: str(v) for k, v in context.items()}
return template.body.format_map(_SafeDict(merged))   # planted VULN-112
```

The caller controls values such as `custom_message`, `passenger_name`, `flight_number`, etc.
Those values are:

1. **stored** on the notification row and later rendered in the ops console table and,
   crucially, in the HTML/rich-text email body that is "delivered" to passengers — a stored
   HTML/email-injection / XSS vector; and
2. **reflected verbatim** in the `POST /api/notifications/send` JSON response `body` field —
   a reflected vector for any client that renders that field as HTML.

Because passenger/agent-supplied text is neither HTML-escaped nor stripped, an attacker can
inject markup, links, tracking pixels, or `<script>` into the message that other users and
downstream email clients render.

## Reproduction

```bash
TOKEN=$(cd backend && .venv/bin/python -c \
  "from app.core.security import create_access_token; print(create_access_token('ops@iberia.demo','ops'))")

curl -s -X POST http://127.0.0.1:8000/api/notifications/send \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"pnr":"HACK01","template":"delay_notice","channel":"email",
       "context":{"custom_message":"<script>alert(document.cookie)</script>"}}'
```

Observed insecure result (verified against a running app):

```json
{
  "body": "Dear Iberia Plus Member, flight IB3001 from MAD to BCN is delayed by 45 minutes. New departure: 18:30. We apologise for the inconvenience. <script>alert(document.cookie)</script>",
  ...
}
```

Expected insecure result: the raw `<script>`/markup is stored and echoed unescaped; a client
or email renderer that treats `body` as HTML executes it / renders the injected content.

## Blast radius

* **Stored XSS** in the ops notifications console and any admin view that renders the body as
  HTML → session/token theft for operators and agents (who hold privileged roles).
* **Email/SMS content injection**: phishing links, spoofed instructions, or hidden tracking
  injected into genuine Iberia-branded passenger comms — reputational and fraud impact at
  passenger scale.
* Combined with a credential-bearing recipient, injected script can drive authenticated
  requests to the rest of the API.

## Intended remediation

* **Encode on output for the sink.** HTML-escape every interpolated value when the body is
  HTML (e.g. `markupsafe.escape` / Jinja2 autoescaping), and use a text-only renderer for
  SMS/push. Escaping must happen at render time, per channel.
* Treat templates as data: render with an autoescaping engine (Jinja2 `autoescape=True`)
  rather than `str.format_map`, and only expose an explicit, typed set of variables.
* Validate/normalise caller-supplied fields (length limits, strip control chars); do not let
  callers override structural fields like `flight_number` with arbitrary markup.
* Do not reflect the fully-rendered HTML body back in the API response; return a preview that
  is itself escaped, or a plain-text rendering.

## Detection hints

* Grep: `.format(` / `.format_map(` / f-strings / `% ` building a message body from request
  data; `Template(...).substitute`; any body built without `escape(...)`.
* Look for user-controlled keys flowing into `render_template(..., context)` and the result
  being returned in a response or stored for later HTML display.
* Test assertion for the fixed version: sending `custom_message="<script>x</script>"` must
  yield a body containing `&lt;script&gt;` (escaped), not the raw tag.
