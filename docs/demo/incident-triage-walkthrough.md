# Demo run-of-show — SRE incident triage, end to end

**Audience:** Iberia SRE / platform engineering.
**Story:** an alert fires, the on-call engineer triages it in the ops console, follows the
request through logs into the code, declares an incident, mitigates, resolves and generates the
postmortem — with Devin doing the analysis.

**Duration:** 12–15 minutes.
**Personas:** `sre@iberia.demo` (on-call), `ops@iberia.demo` (duty ops), password `Iberia2026!`.

---

## 0. Setup (before the audience joins)

```bash
# terminal 1 — API
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python seed.py
.venv/bin/uvicorn app.main:app --reload --port 8000 | tee /tmp/iberia-backend.log

# terminal 2 — console
cd frontend && npm install && npm run dev        # http://localhost:5173
```

Then, in the browser: sign in at `/login` as `sre@iberia.demo` / `Iberia2026!`.

Pre-flight checklist:

* `/ops/incidents` shows four seeded incidents — one resolved with a full timeline
  (`INC-2026-0001`), one **open Sev1** (`INC-2026-0002`), one mitigated, one resolved Sev3.
* `/ops/alerts` loads (it may show "No alerts" until step 1 makes something fire).
* Keep terminal 1 visible — the JSON access log is part of the story.

---

## 1. An alert fires (≈2 min)

Make the demo deterministic by driving the failure yourself. Either start a chaos experiment
(reliability workstream):

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"sre@iberia.demo","password":"Iberia2026!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

curl -s -X POST http://127.0.0.1:8000/api/sre/chaos \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"target":"irrops","mode":"error","magnitude":0.3,"ttl_seconds":900}'
```

…or generate real 5xx traffic against the failing path (scenario **S2**):

```bash
for i in $(seq 1 40); do
  curl -s -o /dev/null -H "Authorization: Bearer $TOKEN" \
    -X POST "http://127.0.0.1:8000/api/irrops/disruptions/1/rebook" \
    -H 'Content-Type: application/json' -d '{"pnr":"NOSUCH"}'
done
```

**Click:** open `/ops/alerts`.
**Expected screen:** a table with `IberiaApiHighErrorRate` in state `firing`, Sev1, service
`iberia-api`, "since" a few minutes, the summary showing the measured 5xx ratio, and a link to
`docs/runbooks/IberiaApiHighErrorRate.md`. A chaos experiment additionally shows
`IberiaChaosExperimentActive` (Sev3). The page re-evaluates every 15 s.

**Talking point:** these alert instances are computed from the same Prometheus metric families
Grafana reads (`iberia_http_requests_total`, `iberia_http_request_duration_seconds_bucket`) and
mirror the thresholds in `ops/prometheus/rules/incidents-alerts.yml` 1:1.

---

## 2. Ops console — orient on the golden signals (≈2 min)

**Click:** the runbook link on the alert row → §3 "Dashboards & queries".
**Click:** the SRE signals page for the service (`/ops/services` → the failing service) and
`/ops/slos` for the error budget.

**Expected screen:** traffic flat, error rate stepping up, latency broadly unchanged — the shape
that says "code or dependency fault", not "load". Error-budget burn rate above 1.

```bash
# the numbers behind the screen
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/incidents/alerts | python3 -m json.tool
curl -s http://127.0.0.1:8000/metrics | grep -E 'iberia_http_requests_total\{.*status="5' | head
```

---

## 3. Logs by `request_id` → code (≈3 min)

Every response carries `x-request-id`, and every log line is JSON containing it.

```bash
# capture a failing request's correlation id
RID=$(curl -s -o /dev/null -D - -H "Authorization: Bearer $TOKEN" \
  -X POST "http://127.0.0.1:8000/api/irrops/disruptions/1/rebook" \
  -H 'Content-Type: application/json' -d '{"pnr":"NOSUCH"}' \
  | tr -d '\r' | awk '/^x-request-id:/ {print $2}')
echo "$RID"

# then follow it end to end
grep "\"request_id\": \"$RID\"" /tmp/iberia-backend.log | python3 -m json.tool
```

**Expected output:** the access log line with `status: 500` plus the exception, naming the module
and line that raised.

**Devin moment:** paste the stack trace and ask Devin to explain the root cause and propose a
fix. Expect it to land on the unguarded branch in the rebooking path
(`backend/app/routers/irrops.py`) and propose returning a domain error instead of raising.

---

## 4. Declare the incident (≈1 min)

**Click:** back to `/ops/alerts` → **Declare incident** on the firing row.

**Expected screen:** `/ops/incidents` with the declare form prefilled — title
`IberiaApiHighErrorRate on iberia-api`, service, Sev1, the alert summary and the runbook path.
Press **Declare incident**.

**Expected result:** a banner `INC-2026-00NN declared as Sev1 on iberia-api`, the incident
appears under **Open** on the board with commander = the signed-in user, and the timeline already
has a `detect` entry. In terminal 1 a structured `incident declared` log line appears.

```bash
# equivalent API call
curl -s -X POST http://127.0.0.1:8000/api/incidents \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"IberiaApiHighErrorRate on iberia-api","severity":1,"service":"irrops",
       "summary":"5xx ratio 9% on rebooking","alert_name":"IberiaApiHighErrorRate"}'
```

---

## 5. Timeline (≈2 min)

**Click:** the new `INC-…` reference → incident detail.

**Expected screen:** header KPIs (Sev1 badge with the response expectation, status `open`, SLO
impact, linked runbook and originating alert), the timeline table, an add-entry box, mitigation
buttons and the postmortem panel.

Add two entries with the kind selector — this is the narrative the postmortem is built from:

* kind `note` — "Errors isolated to POST /api/irrops/disruptions/{id}/rebook; traffic flat."
* kind `escalation` — "Paged irrops on-call; contact centre reporting manual workarounds."

**Expected result:** each entry appears immediately with author = signed-in user and a timestamp.

---

## 6. Mitigate, then resolve (≈2 min)

**Click:** **Mark mitigated** after applying the mitigation from the runbook §5 — e.g. clear the
chaos toggle:

```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/sre/chaos/irrops
```

**Expected result:** status badge flips to `mitigated`, a `mitigation` timeline entry is appended
automatically ("Status changed open → mitigated").

**Click:** back to `/ops/alerts` and refresh — the alert drops out of `firing` (it may sit in
`pending` briefly as the ratio decays).

**Click:** type a resolution note ("Cleared chaos toggle; rebooking guard shipped in PR #NN"),
then **Resolve incident**.

**Expected result:** status `resolved`, `resolved_at` populated, duration shown on the board, and
a `resolve` timeline entry.

---

## 7. Postmortem (≈2 min)

**Click:** **Generate postmortem** on the incident detail page.

**Expected screen:** a markdown document with the metadata table (reference, severity, commander,
detected/resolved, duration, response expectation), Summary, **Impact** including the SLO impact
line, the full **Timeline** as a table, Detection (naming the alert and its runbook), Mitigation,
Resolution, blameless contributing factors, and four pre-filled **action items** (detect /
prevent / respond / measure) with owners and due dates.

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8000/api/incidents/<id>/postmortem \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["markdown"])'
```

**Devin moment:** hand Devin the markdown and the PR that fixed the code, and ask it to complete
the contributing factors and turn the action items into issues.

**Closing comparison:** open `INC-2026-0001` (seeded, resolved) and generate its postmortem — a
complete worked example: alert → dependency timeout → mitigation → resolution in 48 minutes with
41% of the error budget consumed.

---

## Security track add-on (optional, ≈3 min)

The incident board is also the stage for two planted findings — see
`docs/vulnerabilities/VULN-130-stored-xss-incident-timeline.md` and
`docs/vulnerabilities/VULN-131-missing-authorisation-incident-patch.md`.

1. **VULN-131** — sign in as `customer@iberia.demo` and `PATCH` the open Sev1 to
   `{"status":"resolved","severity":3}`: it succeeds (200), while `POST /api/incidents` is
   correctly rejected with 403. Ask Devin why the two endpoints disagree.
2. **VULN-130** — post a timeline note containing `<img src=x onerror=alert(document.domain)>`
   and reload the incident detail page as a responder: it executes, because the cell renders with
   `[innerHTML]` over a `bypassSecurityTrustHtml` value.

Do **not** fix these during the SRE demo — they are the material for the security demo.

---

## Reset between runs

```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8000/api/sre/chaos/irrops
cd backend && rm -f iberia.db && .venv/bin/python seed.py   # deterministic board again
```

Restart uvicorn to reset the Prometheus counters (they are process-lifetime), otherwise a past
error spike keeps `IberiaApiHighErrorRate` in `pending`.
