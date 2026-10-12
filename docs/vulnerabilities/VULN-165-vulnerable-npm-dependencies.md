# VULN-165 — Vulnerable npm dependencies pinned in the frontend

| Field | Value |
|-------|-------|
| ID | VULN-165 |
| Domain | platform |
| CWE | CWE-1395 (Dependency on Vulnerable Third-Party Component) / CWE-937 |
| OWASP Top 10 (2021) | A06:2021 – Vulnerable and Outdated Components |
| Severity | High |
| Location | `frontend/package.json` (`axios@0.21.0`, `lodash@4.17.15`, `js-yaml@3.13.1`), `frontend/package-lock.json` |
| Status | remediated |
| Introduced by | CVE-remediation demo track |

## Remediation status

**Remediated** — all three pins now sit on patched releases:

| Package | Was | Now | Note |
|---------|-----|-----|------|
| `axios` | 0.21.0 | 1.20.0 | Major bump; no call sites to migrate (the app uses `fetch` in `src/lib/api.ts`) |
| `lodash` | 4.17.15 | ^4.18.1 | In-major |
| `js-yaml` | 3.13.1 | 4.3.2 | Major bump; no call sites to migrate (nothing imports `js-yaml`), and v4 drops the `argparse@1` → `sprintf-js` chain |

`js-yaml` was first moved to 3.15.0; GHSA-5p4m-2wfm-xmqj (quadratic CPU consumption in `!!omap`
resolution) subsequently landed against that release and is fixed in 3.15.1, still in-major.
GHSA-2883-xcg3-v3hh / CVE-2026-84375 (`maxTotalMergeKeys` does not bound CPU use for empty
merge sources) then landed against 3.15.1 and is fixed in 3.15.2; the dev-only `js-yaml@4`
copies pulled in by `eslint` were moved to 4.3.2 in the lockfile at the same time.

GHSA-hp3w-g68c-fv3c / CVE-2026-97058 (denial of service through unbounded precision specifiers)
then landed against `sprintf-js <= 1.1.3` with no patched release. `js-yaml@3` pulls it in through
`argparse@1`; `js-yaml@4` depends on `argparse@2`, which has no `sprintf-js` dependency, so the pin
moved to 4.3.2 (the release that carries the GHSA-2883-xcg3-v3hh fix on the v4 line) and both
`argparse@1` and `sprintf-js` left the lockfile.

A transitive advisory against `nanoid` (dev-only, pulled in by `postcss` via `vite`) was cleared
in the lockfile at the same time: GHSA-2v37-7h3g-55p8 (infinite loop in custom generators when
`size` is zero) affects `nanoid < 3.3.18`, so the lockfile now resolves `nanoid@3.3.18`.

`axios` was first moved to 1.18.1; twelve advisories (GHSA-vh66-26gq-q6x8, GHSA-9fr6-4gfg-395g,
GHSA-c29m-xwm3-cm6r, GHSA-mghh-pgcx-3jjj, GHSA-x97p-jq2g-jp4f, GHSA-3pq3-5fj3-cg6v,
GHSA-542g-h47m-68v8, GHSA-j8rh-479h-cp32, GHSA-4hqw-qxg8-jxx2, GHSA-m8m8-qj5v-23w3,
GHSA-44g4-m2mj-wpvx, GHSA-r4gj-5m52-g5wh — prototype-pollution gadgets, ReDoS, proxy/redirect
bypasses) then landed against the 1.x line below 1.20.0, so the pin moved to 1.20.0, still in-major.

Residual frontend advisories after remediation are unrelated to this finding: `react-router`
(fix only in the v7 major). The history below is kept as the demo narrative.

## Description

The frontend pinned three long-outdated packages, mirroring the "legacy pin carried over from an
older estate" pattern that VULN-152 covers on the Python side:

| Package | Pinned | Notable advisory | Fixed in |
|---------|--------|------------------|----------|
| `axios` | 0.21.0 | CVE-2020-28168 — SSRF via proxy handling on redirect (plus a long tail of later prototype-pollution and `no_proxy` bypass advisories) | 0.21.1 for CVE-2020-28168; current 1.x for the rest |
| `lodash` | 4.17.15 | CVE-2020-8203 — prototype pollution in `zipObjectDeep`/`set` | 4.17.20 |
| `js-yaml` | 3.13.1 | CVE-2019-… / GHSA — denial of service and unsafe `load()` semantics | 4.x (`load` is safe by default) |

They sit in `dependencies`, so they ship in the lockfile and are picked up by any SCA scan even
though no module imports them yet. That is exactly the real-world shape of dependency debt: the
risk is in the manifest and the build, not in a line of application code.

## Reproduction

Against the pre-remediation pins:

```bash
cd frontend && npm audit
# 22 vulnerabilities (1 moderate, 21 high)

./scripts/audit.sh          # both halves of the monorepo in one pass
```

Expected insecure result: `npm audit` reports high-severity advisories for `axios` and
transitive packages, with `npm audit fix --force` proposing major-version bumps.

## Blast radius

Nothing is exploitable through the running app today because the packages are not imported —
but they are shipped, they fail any supply-chain gate (NIS2, SOC 2, customer security review),
and the moment a developer reaches for `axios` the SSRF and prototype-pollution paths become
live. Treat as High: a vulnerable dependency in the lockfile is a finding in its own right.

## Intended remediation

Upgrade to the current majors (`axios@^1`, `lodash@^4.17.21`, `js-yaml@^4`), re-run
`npm run lint && npm run build` and the E2E suite, and commit the refreshed lockfile. Where the
major bump changes an API (`js-yaml` `safeLoad` → `load`), adapt the call sites in the same PR.
Then keep it from recurring: Dependabot/Renovate on a weekly cadence and `npm audit --audit-level=high`
as a CI gate.

See `docs/demo/CVE-REMEDIATION.md` for the full remediation walkthrough.

## Detection hints

- `npm audit --json` / `pip-audit --format json`, or any SCA scanner on the lockfiles.
- Grep for pinned exact versions in `frontend/package.json` that are several majors behind.
- CI check: `npm audit --audit-level=high` exits non-zero today.
