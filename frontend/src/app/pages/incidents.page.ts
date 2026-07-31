import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';

import { ApiService } from '../core/api.service';
import {
  Incident,
  IncidentStatus,
  IncidentsService,
  STATUSES,
  STATUS_LABELS,
  formatDuration,
  formatTime,
  severityClass,
  statusClass,
} from '../core/incidents.service';

const SEVERITIES = [0, 1, 2, 3];

@Component({
  selector: 'app-incidents-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="hero">
      <h1>Incident board</h1>
      <p>Declare, triage and resolve incidents across the Iberia estate.</p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }
    @if (notice) {
      <div class="notice">{{ notice }}</div>
    }

    <div class="grid cols-4">
      <div class="card">
        <div class="kpi-label">Open</div>
        <div class="kpi">{{ openCount }}</div>
      </div>
      <div class="card">
        <div class="kpi-label">Sev0 / Sev1</div>
        <div class="kpi">{{ sev1Count }}</div>
      </div>
      <div class="card">
        <div class="kpi-label">Total shown</div>
        <div class="kpi">{{ incidents.length }}</div>
      </div>
      <div class="card">
        <div class="kpi-label">Filter</div>
        <select
          name="status-filter"
          aria-label="status filter"
          [ngModel]="statusFilter"
          (ngModelChange)="setStatusFilter($event)"
        >
          <option value="">all statuses</option>
          @for (status of statuses; track status) {
            <option [value]="status">{{ statusLabels[status] }}</option>
          }
        </select>
      </div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <h3>Declare incident</h3>
        <form (ngSubmit)="declare()">
          <div class="field">
            <label for="incident-title">Title</label>
            <input
              id="incident-title"
              name="incident-title"
              [(ngModel)]="title"
              required
              placeholder="Checkout latency breach"
            />
          </div>
          <div class="field">
            <label for="incident-service">Service</label>
            <input
              id="incident-service"
              name="incident-service"
              [(ngModel)]="service"
              required
              placeholder="payments"
            />
          </div>
          <div class="field">
            <label for="incident-severity">Severity</label>
            <select id="incident-severity" name="incident-severity" [(ngModel)]="severity">
              @for (level of severities; track level) {
                <option [ngValue]="level">Sev{{ level }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="incident-summary">Summary</label>
            <textarea
              id="incident-summary"
              name="incident-summary"
              rows="3"
              [(ngModel)]="summary"
              placeholder="What is the customer impact?"
            ></textarea>
          </div>
          @if (alertName) {
            <p class="muted">From alert <code>{{ alertName }}</code></p>
          }
          <button class="btn" type="submit" [disabled]="submitting">
            {{ submitting ? 'Declaring…' : 'Declare incident' }}
          </button>
        </form>
      </div>

      <div class="card">
        <h3>Response expectations</h3>
        <table>
          <thead>
            <tr>
              <th>Severity</th>
              <th>Expectation</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="badge crit">Sev0</span></td>
              <td>Journey down · page duty manager · 5 min ack · comms every 15 min</td>
            </tr>
            <tr>
              <td><span class="badge crit">Sev1</span></td>
              <td>Major degradation or SLO breach · page on-call · 10 min ack</td>
            </tr>
            <tr>
              <td><span class="badge warn">Sev2</span></td>
              <td>Partial degradation with workaround · 1 h ack</td>
            </tr>
            <tr>
              <td><span class="badge">Sev3</span></td>
              <td>Minor or cosmetic · next working day</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    @for (group of grouped; track group.status) {
      <div class="card">
        <h3>
          {{ statusLabels[group.status] }} <span class="muted">({{ group.items.length }})</span>
        </h3>
        @if (!group.items.length) {
          <p class="muted">Nothing here.</p>
        } @else {
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Sev</th>
                <th>Title</th>
                <th>Service</th>
                <th>Commander</th>
                <th>Started</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              @for (incident of group.items; track incident.id) {
                <tr>
                  <td>
                    <a [routerLink]="['/ops/incidents', incident.id]">{{ incident.reference }}</a>
                  </td>
                  <td>
                    <span [class]="severityClass(incident.severity)">Sev{{ incident.severity }}</span>
                  </td>
                  <td>{{ incident.title }}</td>
                  <td>{{ incident.service }}</td>
                  <td>{{ incident.commander ?? '—' }}</td>
                  <td>{{ formatTime(incident.started_at) }}</td>
                  <td>
                    <span [class]="statusClass(incident.status)">
                      {{ formatDuration(incident.duration_minutes) }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    }
  `,
})
export class IncidentsPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly incidentsApi = inject(IncidentsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private subscription: Subscription | null = null;

  readonly statuses = STATUSES;
  readonly statusLabels = STATUS_LABELS;
  readonly severities = SEVERITIES;
  readonly severityClass = severityClass;
  readonly statusClass = statusClass;
  readonly formatTime = formatTime;
  readonly formatDuration = formatDuration;

  incidents: Incident[] = [];
  error: string | null = null;
  notice: string | null = null;
  submitting = false;
  statusFilter = '';

  title = '';
  service = '';
  severity = 2;
  summary = '';
  alertName = '';
  runbook = '';

  get grouped(): { status: IncidentStatus; items: Incident[] }[] {
    return STATUSES.map((status) => ({
      status,
      items: this.incidents.filter((incident) => incident.status === status),
    }));
  }

  get openCount(): number {
    return this.incidents.filter((incident) => incident.status === 'open').length;
  }

  get sev1Count(): number {
    return this.incidents.filter((incident) => incident.severity <= 1).length;
  }

  ngOnInit(): void {
    this.subscription = this.route.queryParams.subscribe((params: Params) => {
      this.statusFilter = (params['status'] as string) ?? '';
      void this.load();

      // "Declare incident from alert" on /ops/alerts links here with the fields prefilled.
      const fromAlert = params['alert'] as string | undefined;
      if (!fromAlert) return;
      this.alertName = fromAlert;
      this.title = (params['title'] as string) ?? fromAlert;
      this.service = (params['service'] as string) ?? '';
      this.severity = Number(params['severity'] ?? 2);
      this.summary = (params['summary'] as string) ?? '';
      this.runbook = (params['runbook'] as string) ?? '';
    });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }

  setStatusFilter(status: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: status ? { status } : {},
    });
  }

  async load(): Promise<void> {
    try {
      this.incidents = await this.incidentsApi.listIncidents(
        this.statusFilter ? `?status=${encodeURIComponent(this.statusFilter)}` : '',
      );
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  async declare(): Promise<void> {
    this.submitting = true;
    this.error = null;
    try {
      const created = await this.api.post<Incident>('/api/incidents', {
        title: this.title,
        severity: this.severity,
        service: this.service,
        summary: this.summary,
        alert_name: this.alertName || null,
        runbook: this.runbook || null,
      });
      this.notice = `${created.reference} declared as Sev${created.severity} on ${created.service}`;
      this.title = '';
      this.summary = '';
      this.service = '';
      this.alertName = '';
      this.runbook = '';
      this.severity = 2;
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.submitting = false;
    }
  }
}
