import { Component, OnInit, inject } from '@angular/core';

import { NAV_PAGES } from '../app.routes';
import { ApiService } from '../core/api.service';

interface Health {
  status: string;
  env: string;
  service: string;
}

@Component({
  selector: 'app-home-page',
  standalone: true,
  template: `
    <section class="hero">
      <h1>Iberia Digital Platform</h1>
      <p>Booking, airline operations and reliability engineering in one demo estate.</p>
    </section>

    <div class="grid cols-3">
      <div class="card">
        <div class="kpi-label">API health</div>
        <div class="kpi">
          @if (error) {
            <span class="badge crit">unreachable</span>
          } @else {
            {{ health?.status ?? '…' }}
          }
        </div>
        <p class="muted">{{ error ?? 'env: ' + (health?.env ?? '-') }}</p>
      </div>
      <div class="card">
        <div class="kpi-label">Registered surfaces</div>
        <div class="kpi">{{ pageCount }}</div>
        <p class="muted">registered pages</p>
      </div>
      <div class="card">
        <div class="kpi-label">Demo credentials</div>
        <p class="muted" style="margin-bottom: 0">
          <code>customer&#64;iberia.demo</code> · <code>ops&#64;iberia.demo</code> ·
          <code>sre&#64;iberia.demo</code>
          <br />
          password <code>Iberia2026!</code>
        </p>
      </div>
    </div>
  `,
})
export class HomePageComponent implements OnInit {
  private readonly api = inject(ApiService);

  health: Health | null = null;
  error: string | null = null;
  readonly pageCount = NAV_PAGES.filter((page) => page.title).length;

  async ngOnInit(): Promise<void> {
    try {
      this.health = await this.api.get<Health>('/healthz');
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'unreachable';
    }
  }
}
