import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { ApiService } from '../core/api.service';
import { ApiError, SessionUser } from '../core/session.model';
import { SessionService } from '../core/session.service';
import { ShareService } from '../core/share.service';

interface SupportMessage {
  id: number;
  author_email: string;
  subject: string;
  body_html: string;
  channel: string;
  resolved: boolean;
  created_at: string;
}

interface Preview {
  subject: string;
  html: string;
  rendered_by: string;
}

interface Broadcast {
  id: number;
  audience: string;
  subject: string;
  body_html: string;
  sent_by: string;
  created_at: string;
}

interface PlatformConfig {
  env: string;
  app_name: string;
  cors_origins: string[];
  cors_allow_all: boolean;
  jwt_ttl_minutes: number;
  security_headers: Record<string, boolean>;
}

const SAMPLE_REPLY =
  '<p>Dear passenger, your seats on <strong>IB3170</strong> have been re-assigned.</p>';

@Component({
  selector: 'app-support-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="hero">
      <h1>Passenger support</h1>
      <p>
        Support inbox, reply composer and operational broadcasts for the Iberia contact centre.
      </p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }
    @if (status) {
      <div class="notice">{{ status }}</div>
    }

    <div class="grid cols-2">
      <div class="card">
        <h3>Your conversations</h3>
        @if (!messages.length) {
          <p class="muted">No support messages yet.</p>
        } @else {
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Channel</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              @for (message of messages; track message.id) {
                <tr>
                  <td>
                    <strong>{{ message.subject }}</strong>
                    <br />
                    <span class="muted">{{ message.author_email }}</span>
                  </td>
                  <td>{{ message.channel }}</td>
                  <td>
                    <span class="badge" [class.ok]="message.resolved" [class.warn]="!message.resolved">
                      {{ message.resolved ? 'resolved' : 'open' }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      <div class="card">
        <h3>Reply composer</h3>
        <div class="field">
          <label for="support-draft">Message body (rich text / HTML)</label>
          <textarea id="support-draft" name="support-draft" rows="6" [(ngModel)]="draft"></textarea>
        </div>
        <button class="btn" type="button" (click)="renderPreview()">Render preview</button>
        <button class="btn ghost" type="button" (click)="share()">Share this page</button>
        @if (previewHtml) {
          <h4 style="margin-top: 18px">Preview</h4>
          <!-- NOTE(demo): planted VULN-170 — unsanitised server echo injected into the DOM -->
          <div class="notice" [innerHTML]="previewHtml"></div>
          <p class="muted">rendered by {{ preview?.rendered_by }}</p>
        }
        @if (shareUrl) {
          <p class="muted" style="word-break: break-all">
            Share link {{ shareCopied ? '(copied to clipboard)' : '' }}: <code>{{ shareUrl }}</code>
          </p>
        }
      </div>
    </div>

    <!-- NOTE(demo): planted VULN-172 — client-side-only authorisation. The panel is hidden for
         non-admins, but POST /api/platform/support/broadcast has no role dependency. -->
    <div class="card" [style.display]="isAdmin ? 'block' : 'none'">
      <h3>Operations broadcast <span class="badge crit">admin only</span></h3>
      <p class="muted">Sends a push/email broadcast to every passenger in the audience.</p>
      <div class="grid cols-3">
        <div class="field">
          <label for="broadcast-subject">Subject</label>
          <input id="broadcast-subject" name="broadcast-subject" [(ngModel)]="broadcastSubject" />
        </div>
        <div class="field">
          <label for="broadcast-audience">Audience</label>
          <select id="broadcast-audience" name="broadcast-audience" [(ngModel)]="audience">
            <option value="all">all passengers</option>
            <option value="elite">Iberia Plus elite</option>
            <option value="disrupted">disrupted passengers</option>
          </select>
        </div>
        <div class="field">
          <label for="broadcast-body">Body</label>
          <input id="broadcast-body" name="broadcast-body" [(ngModel)]="broadcastBody" />
        </div>
      </div>
      <button class="btn gold" type="button" (click)="sendBroadcast()">Send broadcast</button>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <h3>Recent broadcasts</h3>
        @if (!broadcasts.length) {
          <p class="muted">Nothing sent yet.</p>
        } @else {
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Audience</th>
                <th>Sent by</th>
              </tr>
            </thead>
            <tbody>
              @for (broadcast of broadcasts.slice(0, 8); track broadcast.id) {
                <tr>
                  <td>{{ broadcast.subject }}</td>
                  <td><span class="badge">{{ broadcast.audience }}</span></td>
                  <td class="muted">{{ broadcast.sent_by }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>

      <div class="card">
        <h3>Platform posture</h3>
        @if (config; as platform) {
          <p class="muted">
            env <code>{{ platform.env }}</code> · token TTL {{ platform.jwt_ttl_minutes }} min ·
            CORS
            <code>{{ platform.cors_allow_all ? '*' : platform.cors_origins.join(', ') }}</code>
          </p>
          <table>
            <thead>
              <tr>
                <th>Security header</th>
                <th>Present</th>
              </tr>
            </thead>
            <tbody>
              @for (entry of securityHeaders; track entry.header) {
                <tr>
                  <td><code>{{ entry.header }}</code></td>
                  <td>
                    <span class="badge" [class.ok]="entry.present" [class.crit]="!entry.present">
                      {{ entry.present ? 'yes' : 'missing' }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <p class="muted">Platform config unavailable.</p>
        }
      </div>
    </div>
  `,
})
export class SupportPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly shareService = inject(ShareService);
  private readonly sanitizer = inject(DomSanitizer);

  user: SessionUser | null = this.session.getUser();
  messages: SupportMessage[] = [];
  config: PlatformConfig | null = null;
  draft = SAMPLE_REPLY;
  preview: Preview | null = null;
  previewHtml: SafeHtml | null = null;
  broadcasts: Broadcast[] = [];
  broadcastSubject = 'Operational update';
  broadcastBody = '<p>Madrid–Barcelona services are running with delays this evening.</p>';
  audience = 'all';
  shareUrl: string | null = null;
  shareCopied = false;
  status: string | null = null;
  error: string | null = null;

  get isAdmin(): boolean {
    return this.user?.role === 'admin';
  }

  get securityHeaders(): { header: string; present: boolean }[] {
    return Object.entries(this.config?.security_headers ?? {}).map(([header, present]) => ({
      header,
      present,
    }));
  }

  async ngOnInit(): Promise<void> {
    this.api
      .get<PlatformConfig>('/api/platform/config')
      .then((config) => (this.config = config))
      .catch(() => (this.config = null));
    await this.loadInbox();
  }

  async loadInbox(): Promise<void> {
    try {
      this.messages = await this.api.get<SupportMessage[]>('/api/platform/support/messages');
    } catch (err) {
      this.error =
        err instanceof ApiError && err.status === 401
          ? 'Sign in to see your support inbox.'
          : err instanceof Error
            ? err.message
            : String(err);
    }
    try {
      this.broadcasts = await this.api.get<Broadcast[]>('/api/platform/support/broadcasts');
    } catch {
      this.broadcasts = [];
    }
  }

  async renderPreview(): Promise<void> {
    this.error = null;
    try {
      // The backend echoes the body back as HTML; we bind it below with [innerHTML] through
      // bypassSecurityTrustHtml. NOTE(demo): planted VULN-170 — reflected XSS sink.
      this.preview = await this.api.post<Preview>('/api/platform/support/preview', {
        subject: 'Preview',
        body: this.draft,
      });
      this.previewHtml = this.sanitizer.bypassSecurityTrustHtml(this.preview.html);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  async sendBroadcast(): Promise<void> {
    this.error = null;
    this.status = null;
    try {
      const created = await this.api.post<Broadcast>('/api/platform/support/broadcast', {
        subject: this.broadcastSubject,
        body: this.broadcastBody,
        audience: this.audience,
      });
      this.status = `Broadcast #${created.id} sent to "${created.audience}".`;
      await this.loadInbox();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  async share(): Promise<void> {
    // NOTE(demo): planted VULN-171 — puts the session JWT in the URL/history.
    const url = this.shareService.buildShareUrl('/support');
    this.shareUrl = url;
    this.shareService.publishShareUrlToHistory(url);
    this.shareCopied = await this.shareService.copyShareUrl(url);
  }
}
