import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService } from '../core/api.service';

interface AuditEvent {
  id: number;
  ts: string;
  actor: string;
  action: string;
  target: string;
  ip: string | null;
  request_id: string | null;
  outcome: string;
}

const LIMITS = [25, 50, 100, 250, 500];

function outcomeBadge(outcome: string): string {
  if (outcome === 'failure' || outcome === 'denied') return 'badge crit';
  if (outcome === 'accepted') return 'badge warn';
  return 'badge ok';
}

@Component({
  selector: 'app-security-audit-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="hero">
      <h1>Audit trail</h1>
      <p>
        Every authenticated mutating request and every explicit <code>record_audit</code> call,
        correlated to the platform <code>request_id</code>.
      </p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }

    <div class="grid cols-4">
      <div class="card">
        <div class="kpi-label">Events shown</div>
        <div class="kpi">{{ events.length }}</div>
        <p class="muted">newest first</p>
      </div>
      <div class="card">
        <div class="kpi-label">Distinct actors</div>
        <div class="kpi">{{ distinctActors.length }}</div>
        <p class="muted">in this window</p>
      </div>
      <div class="card">
        <div class="kpi-label">Failed / denied</div>
        <div class="kpi">{{ failedCount }}</div>
        <p class="muted">worth triaging</p>
      </div>
      <div class="card">
        <div class="kpi-label">Latest event</div>
        <div class="kpi" style="font-size: 18px">{{ latest }}</div>
        <p class="muted">{{ loading ? 'refreshing…' : 'up to date' }}</p>
      </div>
    </div>

    <div class="card">
      <h3>Filters</h3>
      <div class="grid cols-4">
        <div class="field">
          <label for="filter-actor">Actor</label>
          <input
            id="filter-actor"
            name="filter-actor"
            [(ngModel)]="actor"
            (ngModelChange)="load()"
            placeholder="admin@iberia.demo"
          />
        </div>
        <div class="field">
          <label for="filter-action">Action</label>
          <input
            id="filter-action"
            name="filter-action"
            [(ngModel)]="action"
            (ngModelChange)="load()"
            placeholder="auth.login"
          />
        </div>
        <div class="field">
          <label for="filter-outcome">Outcome</label>
          <select
            id="filter-outcome"
            name="filter-outcome"
            [(ngModel)]="outcome"
            (ngModelChange)="load()"
          >
            <option value="">Any</option>
            <option value="success">success</option>
            <option value="accepted">accepted</option>
            <option value="failure">failure</option>
            <option value="denied">denied</option>
          </select>
        </div>
        <div class="field">
          <label for="filter-limit">Limit</label>
          <select
            id="filter-limit"
            name="filter-limit"
            [(ngModel)]="limit"
            (ngModelChange)="load()"
          >
            @for (value of limits; track value) {
              <option [ngValue]="value">{{ value }}</option>
            }
          </select>
        </div>
      </div>
      <button class="btn" type="button" (click)="load()" [disabled]="loading">
        {{ loading ? 'Loading…' : 'Refresh' }}
      </button>
    </div>

    <div class="card">
      <h3>Events</h3>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Outcome</th>
            <th>IP</th>
            <th>Request id</th>
          </tr>
        </thead>
        <tbody>
          @for (event of events; track event.id) {
            <tr>
              <td>{{ time(event.ts) }}</td>
              <td>{{ event.actor }}</td>
              <td><code>{{ event.action }}</code></td>
              <td>{{ event.target || '–' }}</td>
              <td><span [class]="outcomeBadge(event.outcome)">{{ event.outcome }}</span></td>
              <td>{{ event.ip ?? '–' }}</td>
              <td><code>{{ event.request_id ?? '–' }}</code></td>
            </tr>
          }
          @if (!events.length && !loading) {
            <tr>
              <td colspan="7" class="muted">No audit events match these filters.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class SecurityAuditPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly limits = LIMITS;
  readonly outcomeBadge = outcomeBadge;

  events: AuditEvent[] = [];
  actor = '';
  action = '';
  outcome = '';
  limit = 100;
  error: string | null = null;
  loading = true;

  get distinctActors(): string[] {
    return [...new Set(this.events.map((event) => event.actor))].sort();
  }

  get failedCount(): number {
    return this.events.filter((e) => e.outcome === 'failure' || e.outcome === 'denied').length;
  }

  get latest(): string {
    return this.events[0] ? new Date(this.events[0].ts).toLocaleString() : '–';
  }

  ngOnInit(): void {
    void this.load();
  }

  time(ts: string): string {
    return new Date(ts).toLocaleString();
  }

  async load(): Promise<void> {
    const params = new URLSearchParams({ limit: String(this.limit) });
    if (this.actor) params.set('actor', this.actor);
    if (this.action) params.set('action', this.action);
    if (this.outcome) params.set('outcome', this.outcome);
    this.loading = true;
    try {
      this.events = await this.api.get<AuditEvent[]>(`/api/security/audit?${params.toString()}`);
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }
}
