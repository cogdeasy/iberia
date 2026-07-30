# Planted vulnerability register

One file per finding, named `VULN-<id>-<slug>.md`, following `TEMPLATE.md`.
`docs/VULNERABILITIES.md` is the generated index over this directory.

Rules:

* Every finding must be reachable over HTTP against the running app.
* The happy path and the test suite must still pass with the vulnerability present.
* Never remove another team's finding; never fix one unless the task explicitly says so.

ID ranges are reserved per workstream to avoid collisions:

| Range | Workstream |
|-------|------------|
| 001–019 | identity & auth |
| 020–029 | flights & inventory |
| 030–049 | booking & PNR |
| 050–069 | payments |
| 070–089 | check-in & travel documents |
| 090–099 | loyalty |
| 100–109 | irregular operations |
| 110–129 | notifications & webhooks |
| 130–149 | security console & audit |
| 150–169 | platform / config / dependencies |
| 170–189 | frontend |
| 190–199 | reliability / chaos tooling |
