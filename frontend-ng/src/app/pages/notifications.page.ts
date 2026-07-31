import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Color, LineChartModule, ScaleType } from '@swimlane/ngx-charts';

import { ApiService } from '../core/api.service';
import { ApiError } from '../core/session.model';

interface Notification {
  id: number;
  pnr: string;
  channel: string;
  template: string;
  status: string;
  created_at: string;
  body: string;
}

interface QueueStatus {
  depth: number;
  workers: number;
  workers_busy: number;
  oldest_age_seconds: number;
  dlq_depth: number;
  saturated: boolean;
  retries_enabled: boolean;
  processed_total: number;
  failed_total: number;
}

interface TemplateInfo {
  name: string;
  subject: string;
  channels: string[];
  variables: string[];
}

interface Webhook {
  id: number;
  url: string;
  event: string;
  active: boolean;
  last_status: string | null;
}

interface Point {
  t: string;
  depth: number;
  busy: number;
  dlq: number;
}

const CHANNELS = ['email', 'sms', 'push'];

function statusBadge(status: string): string {
  if (status === 'sent') return 'badge ok';
  if (status === 'failed') return 'badge crit';
  if (status === 'queued' || status === 'processing') return 'badge warn';
  return 'badge';
}

@Component({
  selector: 'app-notifications-page',
  standalone: true,
  imports: [FormsModule, LineChartModule],
  template: `
    <section class="hero">
      <h1>Passenger Notifications</h1>
      <p>Delivery queue, templates, partner webhooks and the S3 saturation scenario.</p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }
    @if (notice) {
      <div class="notice">{{ notice }}</div>
    }

    <div class="grid cols-4">
      <div class="card">
        <div class="kpi-label">Queue depth</div>
        <div class="kpi">{{ queue?.depth ?? '…' }}</div>
        <p class="muted">pending deliveries</p>
      </div>
      <div class="card">
        <div class="kpi-label">Workers busy</div>
        <div class="kpi">{{ queue ? queue.workers_busy + '/' + queue.workers : '…' }}</div>
        <p class="muted">
          @if (queue?.saturated) {
            <span class="badge crit">saturated</span>
          } @else {
            nominal
          }
        </p>
      </div>
      <div class="card">
        <div class="kpi-label">Oldest age</div>
        <div class="kpi">{{ queue ? queue.oldest_age_seconds.toFixed(1) + 's' : '…' }}</div>
        <p class="muted">head-of-line wait</p>
      </div>
      <div class="card">
        <div class="kpi-label">Dead-letter queue</div>
        <div class="kpi">{{ queue?.dlq_depth ?? '…' }}</div>
        <p class="muted">retries {{ queue?.retries_enabled ? 'on' : 'off' }}</p>
      </div>
    </div>

    <div class="card">
      <h3>Queue depth over time</h3>
      <div style="height: 240px">
        <ngx-charts-line-chart
          [results]="chartData"
          [scheme]="scheme"
          [xAxis]="true"
          [yAxis]="true"
          [legend]="true"
          legendTitle="Queue"
        />
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px">
        <button class="btn" type="button" (click)="toggleSaturation(true, 200)">
          Trigger S3 backlog
        </button>
        <button class="btn ghost" type="button" (click)="toggleSaturation(false)">
          Stop saturation
        </button>
        <button class="btn gold" type="button" (click)="drain()">Drain queue</button>
      </div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <h3>Send a notification</h3>
        <form (ngSubmit)="submitSend()">
          <div class="field">
            <label for="notify-pnr">PNR</label>
            <input id="notify-pnr" name="notify-pnr" [(ngModel)]="pnr" required />
          </div>
          <div class="field">
            <label for="notify-template">Template</label>
            <select id="notify-template" name="notify-template" [(ngModel)]="template">
              @for (t of templates; track t.name) {
                <option [value]="t.name">{{ t.name }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="notify-channel">Channel</label>
            <select id="notify-channel" name="notify-channel" [(ngModel)]="channel">
              @for (c of channels; track c) {
                <option [value]="c">{{ c }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="notify-message">Custom message (optional)</label>
            <textarea
              id="notify-message"
              name="notify-message"
              rows="2"
              [(ngModel)]="customMessage"
            ></textarea>
          </div>
          <button class="btn" type="submit">Queue delivery</button>
        </form>
      </div>

      <div class="card">
        <h3>Partner webhooks</h3>
        <form (ngSubmit)="submitWebhook()">
          <div class="field">
            <label for="hook-url">URL</label>
            <input id="hook-url" name="hook-url" [(ngModel)]="hookUrl" required />
          </div>
          <div class="field">
            <label for="hook-event">Event</label>
            <input id="hook-event" name="hook-event" [(ngModel)]="hookEvent" required />
          </div>
          <button class="btn" type="submit">Register webhook</button>
        </form>
        <table style="margin-top: 12px">
          <thead>
            <tr>
              <th>URL</th>
              <th>Event</th>
              <th>Last</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (w of webhooks; track w.id) {
              <tr>
                <td style="max-width: 220px; overflow: hidden; text-overflow: ellipsis">
                  {{ w.url }}
                </td>
                <td>{{ w.event }}</td>
                <td>{{ w.last_status ?? '—' }}</td>
                <td>
                  <button class="btn ghost" type="button" (click)="testWebhook(w.id)">Test</button>
                </td>
              </tr>
            }
            @if (!webhooks.length) {
              <tr>
                <td colspan="4" class="muted">No webhooks registered.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="card">
      <h3>Recent notifications</h3>
      <table>
        <thead>
          <tr>
            <th>PNR</th>
            <th>Template</th>
            <th>Channel</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          @for (n of notifications; track n.id) {
            <tr>
              <td>{{ n.pnr }}</td>
              <td>{{ n.template }}</td>
              <td>{{ n.channel }}</td>
              <td><span [class]="statusBadge(n.status)">{{ n.status }}</span></td>
              <td class="muted">{{ created(n) }}</td>
            </tr>
          }
          @if (!notifications.length) {
            <tr>
              <td colspan="5" class="muted">No notifications yet.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class NotificationsPageComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private timer: ReturnType<typeof setInterval> | null = null;
  private series: Point[] = [];

  readonly channels = CHANNELS;
  readonly statusBadge = statusBadge;
  readonly scheme: Color = {
    name: 'iberia',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#d7192d', '#b45309', '#0f7b52'],
  };

  queue: QueueStatus | null = null;
  notifications: Notification[] = [];
  templates: TemplateInfo[] = [];
  webhooks: Webhook[] = [];
  chartData: { name: string; series: { name: string; value: number }[] }[] = [];
  error: string | null = null;
  notice: string | null = null;

  pnr = 'YXR7K2';
  template = 'delay_notice';
  channel = 'email';
  customMessage = '';

  hookUrl = 'https://partner.example/hook';
  hookEvent = 'notification.sent';

  ngOnInit(): void {
    this.api
      .get<TemplateInfo[]>('/api/notifications/templates')
      .then((rows) => (this.templates = rows))
      .catch(() => undefined);
    void this.loadWebhooks();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 2000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  created(notification: Notification): string {
    return new Date(notification.created_at).toLocaleString();
  }

  async refresh(): Promise<void> {
    try {
      const [q, list] = await Promise.all([
        this.api.get<QueueStatus>('/api/notifications/queue'),
        this.api.get<Notification[]>('/api/notifications?limit=25'),
      ]);
      this.queue = q;
      this.notifications = list;
      this.error = null;
      this.series = [
        ...this.series,
        {
          t: new Date().toLocaleTimeString(),
          depth: q.depth,
          busy: q.workers_busy,
          dlq: q.dlq_depth,
        },
      ].slice(-40);
      this.chartData = [
        { name: 'depth', series: this.series.map((p) => ({ name: p.t, value: p.depth })) },
        { name: 'dlq', series: this.series.map((p) => ({ name: p.t, value: p.dlq })) },
        { name: 'busy', series: this.series.map((p) => ({ name: p.t, value: p.busy })) },
      ];
    } catch (err) {
      this.error = err instanceof ApiError ? err.message : String(err);
    }
  }

  async loadWebhooks(): Promise<void> {
    try {
      this.webhooks = await this.api.get<Webhook[]>('/api/notifications/webhooks');
    } catch {
      /* non-fatal */
    }
  }

  async submitSend(): Promise<void> {
    this.error = null;
    this.notice = null;
    try {
      const context: Record<string, string> = {};
      if (this.customMessage) context['custom_message'] = this.customMessage;
      await this.api.post<Notification>('/api/notifications/send', {
        pnr: this.pnr,
        template: this.template,
        channel: this.channel,
        context,
      });
      this.notice = `Queued ${this.template} to ${this.pnr} via ${this.channel}.`;
      await this.refresh();
    } catch (err) {
      this.error = err instanceof ApiError ? err.message : String(err);
    }
  }

  async submitWebhook(): Promise<void> {
    this.error = null;
    try {
      await this.api.post<Webhook>('/api/notifications/webhooks', {
        url: this.hookUrl,
        event: this.hookEvent,
      });
      this.notice = 'Webhook registered.';
      await this.loadWebhooks();
    } catch (err) {
      this.error = err instanceof ApiError ? err.message : String(err);
    }
  }

  async testWebhook(id: number): Promise<void> {
    this.error = null;
    try {
      const res = await this.api.post<{ status: string; response_snippet: string }>(
        `/api/notifications/webhooks/${id}/test`,
      );
      this.notice = `Webhook ${id} test → ${res.status}: ${res.response_snippet.slice(0, 120)}`;
      await this.loadWebhooks();
    } catch (err) {
      this.error = err instanceof ApiError ? err.message : String(err);
    }
  }

  async toggleSaturation(enabled: boolean, burst = 0): Promise<void> {
    this.error = null;
    try {
      await this.api.post<QueueStatus>('/api/notifications/queue/saturate', { enabled, burst });
      this.notice = enabled
        ? 'S3 saturation ENABLED — backlog will grow.'
        : 'Saturation disabled.';
      await this.refresh();
    } catch (err) {
      this.error = err instanceof ApiError ? err.message : String(err);
    }
  }

  async drain(): Promise<void> {
    this.error = null;
    try {
      await this.api.post<QueueStatus>('/api/notifications/queue/drain');
      this.notice = 'Queue and DLQ drained; saturation cleared.';
      await this.refresh();
    } catch (err) {
      this.error = err instanceof ApiError ? err.message : String(err);
    }
  }
}
