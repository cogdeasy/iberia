import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  Alert,
  IncidentsService,
  formatTime,
  runbookUrl,
  severityClass,
  sinceLabel,
} from '../core/incidents.service';

function stateClass(state: string): string {
  if (state === 'firing') return 'badge crit';
  if (state === 'pending') return 'badge warn';
  return 'badge ok';
}

@Component({
  selector: 'app-alerts-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="hero">
      <h1>Alerts</h1>
      <p>
        Evaluated live from the API golden signals and any active chaos experiment, mirroring the
        rules in <code>ops/prometheus/rules/incidents-alerts.yml</code>.
      </p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }

    <div class="grid cols-3">
      <div class="card">
        <div class="kpi-label">Firing</div>
        <div class="kpi">{{ firing.length }}</div>
      </div>
      <div class="card">
        <div class="kpi-label">Pending</div>
        <div class="kpi">{{ pending.length }}</div>
      </div>
      <div class="card">
        <div class="kpi-label">Last evaluated</div>
        <p>{{ formatTime(refreshedAt) }}</p>
        <button class="btn ghost" type="button" (click)="load()">Refresh now</button>
      </div>
    </div>

    <div class="card">
      <h3>Alert instances</h3>
      @if (!alerts.length) {
        <p class="muted">
          No alerts. Everything is inside threshold — drive some errors or start a chaos experiment
          to make one fire.
        </p>
      } @else {
        <table>
          <thead>
            <tr>
              <th>Alert</th>
              <th>Sev</th>
              <th>State</th>
              <th>Service</th>
              <th>Since</th>
              <th>Summary</th>
              <th>Runbook</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (alert of alerts; track alert.name + '-' + alert.service) {
              <tr>
                <td>{{ alert.name }}</td>
                <td><span [class]="severityClass(alert.severity)">Sev{{ alert.severity }}</span></td>
                <td><span [class]="stateClass(alert.state)">{{ alert.state }}</span></td>
                <td>{{ alert.service }}</td>
                <td>{{ sinceLabel(alert.since) }}</td>
                <td>{{ alert.summary }}</td>
                <td>
                  @if (runbookUrl(alert.runbook); as href) {
                    <a [href]="href" target="_blank" rel="noreferrer">runbook</a>
                  } @else {
                    <span class="muted">—</span>
                  }
                </td>
                <td>
                  <a
                    class="btn ghost"
                    routerLink="/ops/incidents"
                    [queryParams]="declareParams(alert)"
                  >
                    Declare incident
                  </a>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
})
export class AlertsPageComponent implements OnInit, OnDestroy {
  private readonly incidents = inject(IncidentsService);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly formatTime = formatTime;
  readonly severityClass = severityClass;
  readonly sinceLabel = sinceLabel;
  readonly runbookUrl = runbookUrl;
  readonly stateClass = stateClass;

  alerts: Alert[] = [];
  error: string | null = null;
  refreshedAt: string | null = null;

  get firing(): Alert[] {
    return this.alerts.filter((alert) => alert.state === 'firing');
  }

  get pending(): Alert[] {
    return this.alerts.filter((alert) => alert.state === 'pending');
  }

  ngOnInit(): void {
    void this.load();
    this.timer = setInterval(() => void this.load(), 15000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async load(): Promise<void> {
    try {
      this.alerts = await this.incidents.listAlerts();
      this.refreshedAt = new Date().toISOString();
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  declareParams(alert: Alert): Record<string, string> {
    const params: Record<string, string> = {
      alert: alert.name,
      title: `${alert.name} on ${alert.service}`,
      service: alert.service,
      severity: String(alert.severity),
      summary: alert.summary,
    };
    if (alert.runbook) params['runbook'] = alert.runbook;
    return params;
  }
}
