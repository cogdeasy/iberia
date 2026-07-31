import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiService } from '../core/api.service';
import {
  Incident,
  IncidentsService,
  TIMELINE_KINDS,
  TimelineEntry,
  TimelineKind,
  formatDuration,
  formatTime,
  runbookUrl,
  severityClass,
  statusClass,
} from '../core/incidents.service';

interface Postmortem {
  incident_id: number;
  markdown: string;
}

@Component({
  selector: 'app-incident-detail-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    @if (error && !incident) {
      <div class="error">{{ error }}</div>
    } @else if (!incident) {
      <p class="muted">Loading incident…</p>
    } @else {
      <section class="hero">
        <h1>{{ incident.reference }} · {{ incident.title }}</h1>
        <p>
          {{ incident.service }} · commander {{ incident.commander ?? 'unassigned' }} ·
          {{ formatDuration(incident.duration_minutes) }} elapsed
        </p>
      </section>

      @if (error) {
        <div class="error">{{ error }}</div>
      }

      <div class="grid cols-4">
        <div class="card">
          <div class="kpi-label">Severity</div>
          <div class="kpi">
            <span [class]="severityClass(incident.severity)">Sev{{ incident.severity }}</span>
          </div>
          <p class="muted">{{ incident.response_expectation }}</p>
        </div>
        <div class="card">
          <div class="kpi-label">Status</div>
          <div class="kpi">
            <span [class]="statusClass(incident.status)">{{ incident.status }}</span>
          </div>
          <p class="muted">
            started {{ formatTime(incident.started_at) }} · resolved
            {{ formatTime(incident.resolved_at) }}
          </p>
        </div>
        <div class="card">
          <div class="kpi-label">SLO impact</div>
          <p>{{ incident.slo_impact ?? 'not assessed' }}</p>
        </div>
        <div class="card">
          <div class="kpi-label">Runbook</div>
          @if (runbookUrl(incident.runbook); as href) {
            <p><a [href]="href" target="_blank" rel="noreferrer">{{ incident.runbook }}</a></p>
          } @else {
            <p class="muted">no runbook linked</p>
          }
          @if (incident.alert_name) {
            <p class="muted">alert <code>{{ incident.alert_name }}</code></p>
          }
        </div>
      </div>

      <div class="grid cols-2">
        <div class="card">
          <h3>Timeline</h3>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Kind</th>
                <th>Author</th>
                <th>Entry</th>
              </tr>
            </thead>
            <tbody>
              @for (entry of incident.timeline; track entry.id) {
                <tr>
                  <td>{{ formatTime(entry.ts) }}</td>
                  <td><span class="badge">{{ entry.kind }}</span></td>
                  <td>{{ entry.author }}</td>
                  <!-- NOTE(demo): planted VULN-130 — responder notes are rendered as raw HTML. -->
                  <td [innerHTML]="entryHtml(entry)"></td>
                </tr>
              }
            </tbody>
          </table>

          <form (ngSubmit)="addEntry()" style="margin-top: 16px">
            <div class="field">
              <label for="entry-kind">Entry kind</label>
              <select id="entry-kind" name="entry-kind" [(ngModel)]="kind">
                @for (option of timelineKinds; track option) {
                  <option [value]="option">{{ option }}</option>
                }
              </select>
            </div>
            <div class="field">
              <label for="entry-message">Add to timeline</label>
              <textarea
                id="entry-message"
                name="entry-message"
                rows="3"
                [(ngModel)]="message"
                placeholder="Scaled workers 4 → 12, backlog draining"
              ></textarea>
            </div>
            <button class="btn" type="submit" [disabled]="busy">Add entry</button>
          </form>
        </div>

        <div class="card">
          <h3>Mitigation actions</h3>
          <p class="muted">{{ incident.summary }}</p>
          <div class="field">
            <label for="resolution">Resolution note</label>
            <textarea
              id="resolution"
              name="resolution"
              rows="3"
              [ngModel]="resolution || (incident.resolution ?? '')"
              (ngModelChange)="resolution = $event"
              placeholder="What made the system healthy again?"
            ></textarea>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <button
              class="btn gold"
              type="button"
              [disabled]="busy || incident.status === 'mitigated'"
              (click)="transition('mitigated')"
            >
              Mark mitigated
            </button>
            <button
              class="btn"
              type="button"
              [disabled]="busy || incident.status === 'resolved'"
              (click)="transition('resolved')"
            >
              Resolve incident
            </button>
            <button
              class="btn ghost"
              type="button"
              [disabled]="busy || incident.status === 'open'"
              (click)="transition('open')"
            >
              Re-open
            </button>
            <a class="btn ghost" routerLink="/ops/alerts">Firing alerts</a>
            <a class="btn ghost" routerLink="/ops/incidents">Back to board</a>
          </div>

          <h3 style="margin-top: 24px">Postmortem</h3>
          <button class="btn ghost" type="button" [disabled]="busy" (click)="generatePostmortem()">
            Generate postmortem
          </button>
          @if (postmortem) {
            <pre
              style="margin-top: 12px; max-height: 420px; overflow: auto; white-space: pre-wrap; font-size: 12px; background: #f8fafc; padding: 12px; border-radius: 6px"
              >{{ postmortem.markdown }}</pre
            >
          }
        </div>
      </div>
    }
  `,
})
export class IncidentDetailPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly incidentsApi = inject(IncidentsService);
  private readonly route = inject(ActivatedRoute);
  private readonly sanitizer = inject(DomSanitizer);

  readonly timelineKinds = TIMELINE_KINDS;
  readonly severityClass = severityClass;
  readonly statusClass = statusClass;
  readonly formatTime = formatTime;
  readonly formatDuration = formatDuration;
  readonly runbookUrl = runbookUrl;

  id: string | null = null;
  incident: Incident | null = null;
  error: string | null = null;
  message = '';
  kind: TimelineKind = 'note';
  resolution = '';
  postmortem: Postmortem | null = null;
  busy = false;

  ngOnInit(): void {
    this.id = this.route.snapshot.paramMap.get('id');
    void this.load();
  }

  entryHtml(entry: TimelineEntry): SafeHtml {
    // NOTE(demo): planted VULN-130 — responder notes are rendered as raw HTML.
    return this.sanitizer.bypassSecurityTrustHtml(entry.message);
  }

  async load(): Promise<void> {
    if (!this.id) return;
    try {
      this.incident = await this.incidentsApi.getIncident(this.id);
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  async addEntry(): Promise<void> {
    if (!this.id || !this.message.trim()) return;
    this.busy = true;
    try {
      await this.api.post(`/api/incidents/${this.id}/timeline`, {
        kind: this.kind,
        message: this.message,
      });
      this.message = '';
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  async transition(status: 'open' | 'mitigated' | 'resolved'): Promise<void> {
    if (!this.id) return;
    this.busy = true;
    try {
      const body: Record<string, string> = { status };
      if (status === 'resolved' && this.resolution.trim()) body['resolution'] = this.resolution;
      await this.api.patch(`/api/incidents/${this.id}`, body);
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  async generatePostmortem(): Promise<void> {
    if (!this.id) return;
    this.busy = true;
    try {
      this.postmortem = await this.api.get<Postmortem>(`/api/incidents/${this.id}/postmortem`);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }
}
