# VULN-021 — Verbose error handling leaks internals in flight search

| Field | Value |
|-------|-------|
| ID | VULN-021 |
| Domain | flights |
| CWE | CWE-209 (Generation of Error Message Containing Sensitive Information) |
| OWASP Top 10 (2021) | A05:2021 – Security Misconfiguration |
| Severity | Medium |
| Location | `backend/app/routers/flights.py:109-119` |
| Introduced by | Workstream 2 — Flights & Inventory (`devin/iberia-flights`) |

## Description

`GET /api/flights/search` wraps its query in a broad `except Exception` that returns the
raw exception, the generated SQL statement and the full Python traceback in the JSON
`detail` field:

```python
except Exception as exc:
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        detail=(
            f"flight search failed: {type(exc).__name__}: {exc}\n"
            f"query: {sql.strip()}\n"
            f"traceback: {traceback.format_exc()}"
        ),
    ) from exc
```

Any bad input (a malformed `date`, or an injection payload that produces invalid SQL)
triggers this handler and echoes internal detail back to the unauthenticated caller.

## Reproduction

```bash
curl -s "http://127.0.0.1:8000/api/flights/search?origin=MAD&date=not-a-date"
```

Expected insecure result: the response body contains the exception type and message, the
exact SQL that was built, and a stack trace including absolute server file paths
(`/home/.../backend/app/routers/flights.py`, the Python version and stdlib paths).

## Blast radius

Information disclosure that dramatically eases further attacks: it reveals the database
engine, table/column names, ORM query shape and filesystem layout, and turns VULN-020
into a convenient error-based SQL-injection oracle. Combined, an attacker can map the
schema and exfiltrate data with far less effort.

## Intended remediation

Return a generic client error (`"invalid search parameters"`) with a 400/422 status,
validate `date` up front (e.g. Pydantic `date` type) instead of catching everything, and
log the full exception server-side only — never place `str(exc)`, the SQL, or
`traceback.format_exc()` into the HTTP response.

## Detection hints

- Grep for `traceback.format_exc()` and `str(exc)` inside `HTTPException(..., detail=...)`.
- Any 4xx/5xx JSON `detail` containing `Traceback (most recent call last)` or an absolute
  file path is a positive signal.
