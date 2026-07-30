# VULN-020 — SQL injection in flight search

| Field | Value |
|-------|-------|
| ID | VULN-020 |
| Domain | flights |
| CWE | CWE-89 (Improper Neutralization of Special Elements used in an SQL Command) |
| OWASP Top 10 (2021) | A03:2021 – Injection |
| Severity | Critical |
| Location | `backend/app/routers/flights.py:91-106` |
| Introduced by | Workstream 2 — Flights & Inventory (`devin/iberia-flights`) |

## Description

`GET /api/flights/search` builds its SQL by string-formatting caller-supplied query
parameters straight into the statement instead of binding them. Both the `origin`
(and `destination`) filters and the `sort` parameter are concatenated into the raw
`text(...)` query:

```python
if origin:
    clauses.append(f"f.origin = '{origin}'")
...
order_sql = SORT_COLUMNS.get(sort, sort)   # unknown sort key used verbatim as ORDER BY
sql = SEARCH_SQL.format(where_sql=" AND ".join(clauses), order_sql=order_sql, limit=SEARCH_LIMIT)
rows = db.execute(text(sql)).mappings().all()
```

Because the endpoint is public (no auth), an unauthenticated attacker fully controls
part of the `WHERE` predicate and the entire `ORDER BY` clause.

## Reproduction

```bash
# Break out of the origin filter — returns EVERY flight, not just those from MAD.
curl -s "http://127.0.0.1:8000/api/flights/search?origin=MAD'%20OR%20'1'='1"

# Inject a raw ORDER BY expression through the sort parameter.
curl -s "http://127.0.0.1:8000/api/flights/search?origin=MAD&sort=f.base_fare_eur%20DESC"
```

Expected insecure result: the `origin=MAD' OR '1'='1` request returns all 112 seeded
flights across every origin (the injected `OR '1'='1'` neutralises the filter), proving
the predicate is attacker-controlled. Malformed injections surface the raw database
error (see VULN-021), giving the attacker an error-based oracle to enumerate the schema.

## Blast radius

The `flights`/`aircraft` tables leak in full, and a UNION-based payload through the same
sink can pivot to any table in the SQLite database (users, bookings, payments, …). No
authentication is required, so this is reachable by any internet client.

## Intended remediation

Use bound parameters instead of string formatting, e.g.
`text("... WHERE f.origin = :origin").bindparams(origin=origin)` or the SQLAlchemy ORM
(`select(Flight).where(Flight.origin == origin)`), and restrict `sort` to an allow-list
of known columns/directions (reject anything not in `SORT_COLUMNS`).

## Detection hints

- Grep for `text(f"` / `.format(` feeding `db.execute(...)` in routers.
- Grep for `f"f.origin = '{` and `SORT_COLUMNS.get(sort, sort)`.
- A request with `origin=MAD' OR '1'='1` returning flights from more than one origin is a
  positive signal.
