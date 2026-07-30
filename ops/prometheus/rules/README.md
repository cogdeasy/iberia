# Prometheus rule files

`prometheus.yml` loads every file matching `/etc/prometheus/rules/*.yml` (mounted from this
directory), so each workstream contributes **its own file** and no shared file is ever edited.

## Naming convention

```
<domain>.rules.yml        # e.g. booking.rules.yml, payments.rules.yml, platform.rules.yml
```

Inside a file, use one group per concern:

```yaml
groups:
  - name: <domain>-golden-signals
    interval: 30s
    rules:
      - alert: <DomainConcernAlert>          # PascalCase, matches docs/runbooks/<AlertName>.md
        expr: <PromQL over iberia_http_* / iberia_domain_events_total>
        for: 5m
        labels:
          severity: critical | warning | info
          service: iberia-api
          domain: <domain>
        annotations:
          summary: one line, includes the affected route or service
          runbook: docs/runbooks/<AlertName>.md
```

Rules:

* Every `alert` name must have a matching runbook file (`docs/runbooks/<AlertName>.md`).
* Always set `severity`, `service` and `domain` labels — the Grafana dashboards and the
  incident console filter on them.
* Recording rules go in a `<domain>-recording` group and are named
  `iberia:<metric>:<aggregation>` (e.g. `iberia:http_error_ratio:rate5m`).
* Validate before committing: `docker run --rm -v "$PWD/ops/prometheus:/p"
  prom/prometheus:v2.53.0 promtool check rules /p/rules/<file>.yml`.
