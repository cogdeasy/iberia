# VULN-070 — Path traversal / arbitrary file read in the travel-document download

| Field | Value |
|-------|-------|
| ID | VULN-070 |
| Domain | checkin |
| CWE | CWE-22 (Improper Limitation of a Pathname to a Restricted Directory) |
| OWASP Top 10 (2021) | A01:2021 – Broken Access Control |
| Severity | Critical |
| Location | `backend/app/routers/checkin.py:65-82` (`download_document`), sink at line 70 |
| Introduced by | Workstream 5 — Check-in & Travel Documents |

## Description

`GET /api/checkin/documents/{filename}` serves generated boarding passes and itinerary
receipts from the document store at `backend/app/documents/`. The route is declared with a
`{filename:path}` converter, so the path parameter happily captures `/` and `..` segments,
and the handler joins the caller-supplied value straight onto the document root:

```python
target = os.path.join(str(documents_dir()), filename)   # no normalisation, no allow-list
if not os.path.isfile(target):
    raise HTTPException(404, ...)
return FileResponse(target, media_type="application/octet-stream")
```

Two things make this exploitable:

1. **Dot-segment traversal** — `../../app/core/config.py` resolves out of the document root
   and back into the application package, so any file the API process can read is
   downloadable.
2. **Absolute-path override** — `os.path.join(root, "/etc/hostname")` returns
   `/etc/hostname`; Python's `join` discards the base whenever the second argument is
   absolute. A leading `/` in the path parameter therefore reads anywhere on the filesystem.

The endpoint requires a valid bearer token, but *any* role (including the low-privilege
`customer` persona) is enough.

## Reproduction

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@iberia.demo","password":"Iberia2026!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

# 1. happy path — a real generated document
curl -s http://127.0.0.1:8000/api/checkin/documents/itinerary-XK7T2P.txt \
  -H "Authorization: Bearer $TOKEN"

# 2. traversal out of the document root (--path-as-is stops curl normalising the dots)
curl -s --path-as-is \
  "http://127.0.0.1:8000/api/checkin/documents/../../app/core/config.py" \
  -H "Authorization: Bearer $TOKEN"

# 3. absolute path — os.path.join drops the base directory
curl -s --path-as-is "http://127.0.0.1:8000/api/checkin/documents//etc/hostname" \
  -H "Authorization: Bearer $TOKEN"
```

Expected insecure result: step 2 returns the source of `backend/app/core/config.py`
(including the `IBERIA_JWT_SECRET` default), and step 3 returns the contents of
`/etc/hostname`.

## Blast radius

Full read access to everything the API process can open: the JWT signing secret and other
defaults in `app/core/config.py`, the SQLite database file (`iberia.db` — password hashes,
passport numbers), `.env` files, and OS files such as `/etc/passwd`. Recovering
`IBERIA_JWT_SECRET` lets an attacker forge admin tokens, which escalates this from
information disclosure to full platform compromise. It also leaks every other passenger's
generated boarding-pass document, since filenames are predictable
(`boarding-pass-<PNR>-<passenger_id>.txt`).

## Intended remediation

* Resolve the candidate path and assert it stays under the document root before opening it:
  `resolved = (documents_dir() / filename).resolve()` then
  `if not resolved.is_relative_to(documents_dir().resolve()): raise HTTPException(400)`.
* Better: drop the free-form filename entirely. Look the document up by its database record
  (`BoardingPass.document_filename`) after an ownership check, and never let the client
  choose a path. Use `os.path.basename()` / an allow-list of known filenames at minimum.
* Reject any parameter containing `..`, a leading `/`, a backslash or a NUL byte, and keep
  the `{filename}` converter non-`:path` so `/` cannot be captured at all.
* Serve the document store from a dedicated read-only volume that contains nothing else.

## Detection hints

* Grep: `os.path.join(` with a request-derived variable; `{filename:path}` /
  `{path:path}` route converters; `FileResponse(` on an unvalidated variable.
* Logs: `iberia.checkin` emits `travel document served` with both `filename` and
  `resolved_path` — a `resolved_path` outside `app/documents` or a `filename` containing
  `..` / `%2e%2e` is a live exploit attempt.
* Test assertion: `backend/tests/test_checkin.py::test_vuln_070_path_traversal_is_present`.
