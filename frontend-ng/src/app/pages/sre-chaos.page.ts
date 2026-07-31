import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  CHAOS_MODES,
  CHAOS_TARGETS,
  ChaosMode,
  ChaosToggle,
  LOAD_SCENARIOS,
  LoadScenario,
  MODE_UNITS,
  SreApiService,
  secondsUntil,
} from '../core/sre.service';

@Component({
  selector: 'app-sre-chaos-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="hero">
      <h1>Chaos &amp; load control</h1>
      <p>
        Arm a fault on a dependency, watch the SLO burn, then stop it. Toggles expire on their own
        so a demo can never leave the platform degraded.
      </p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }
    @if (notice) {
      <div class="notice">{{ notice }}</div>
    }

    <div class="grid cols-2">
      <div class="card">
        <h3>Fault injection</h3>
        <div class="field">
          <label for="chaos-target">Target</label>
          <select id="chaos-target" name="chaos-target" [(ngModel)]="target">
            @for (name of chaosTargets; track name) {
              <option [value]="name">{{ name }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="chaos-mode">Mode</label>
          <select id="chaos-mode" name="chaos-mode" [(ngModel)]="mode">
            @for (name of chaosModes; track name) {
              <option [value]="name">{{ name }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="chaos-magnitude">Magnitude ({{ modeUnits[mode] }})</label>
          <input
            id="chaos-magnitude"
            name="chaos-magnitude"
            type="number"
            min="0"
            [(ngModel)]="magnitude"
          />
        </div>
        <div class="field">
          <label for="chaos-ttl">Auto-expiry (seconds)</label>
          <input
            id="chaos-ttl"
            name="chaos-ttl"
            type="number"
            min="1"
            max="3600"
            [(ngModel)]="ttl"
          />
        </div>
        <button class="btn" type="button" (click)="arm()">Arm injection</button>
      </div>

      <div class="card">
        <h3>Synthetic traffic</h3>
        <div class="field">
          <label for="load-scenario">Scenario</label>
          <select id="load-scenario" name="load-scenario" [(ngModel)]="scenario">
            @for (name of loadScenarios; track name) {
              <option [value]="name">{{ name }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="load-duration">Duration (seconds)</label>
          <input
            id="load-duration"
            name="load-duration"
            type="number"
            min="1"
            max="600"
            [(ngModel)]="duration"
          />
        </div>
        <div class="field">
          <label for="load-rps">Requests per second</label>
          <input id="load-rps" name="load-rps" type="number" min="1" max="200" [(ngModel)]="rps" />
        </div>
        <button class="btn gold" type="button" (click)="fireLoad()">Start load generator</button>
        <p class="muted">
          Traffic is driven against this deployment's own endpoints, so the reliability console
          fills with real Prometheus data.
        </p>
      </div>
    </div>

    <div class="card">
      <h3>Active toggles</h3>
      <table>
        <thead>
          <tr>
            <th>Target</th>
            <th>Mode</th>
            <th>Magnitude</th>
            <th>Expires in</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (toggle of toggles; track toggle.target) {
            <tr>
              <td><strong>{{ toggle.target }}</strong></td>
              <td><span class="badge crit">{{ toggle.mode }}</span></td>
              <td>{{ toggle.magnitude }} {{ modeUnits[toggle.mode] }}</td>
              <td>{{ secondsUntil(toggle.expires_at) }}s</td>
              <td>
                <button class="btn ghost" type="button" (click)="stop(toggle.target)">Stop</button>
              </td>
            </tr>
          }
          @if (!toggles.length) {
            <tr>
              <td colspan="5" class="muted">No faults armed — the platform is running clean.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class SreChaosPageComponent implements OnInit, OnDestroy {
  private readonly sre = inject(SreApiService);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly chaosTargets = CHAOS_TARGETS;
  readonly chaosModes = CHAOS_MODES;
  readonly loadScenarios = LOAD_SCENARIOS;
  readonly modeUnits = MODE_UNITS;
  readonly secondsUntil = secondsUntil;

  toggles: ChaosToggle[] = [];
  target = CHAOS_TARGETS[1];
  mode: ChaosMode = 'latency';
  magnitude = 700;
  ttl = 300;
  scenario: LoadScenario = 'checkout_rush';
  duration = 60;
  rps = 10;
  notice: string | null = null;
  error: string | null = null;

  ngOnInit(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 5000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    try {
      this.toggles = await this.sre.listChaos();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  async arm(): Promise<void> {
    this.error = null;
    try {
      const toggle = await this.sre.armChaos({
        target: this.target,
        mode: this.mode,
        magnitude: this.magnitude,
        ttl_seconds: this.ttl,
      });
      this.notice = `${toggle.mode} injection armed on ${toggle.target} for ${this.ttl}s`;
      await this.refresh();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  async stop(name: string): Promise<void> {
    this.error = null;
    try {
      await this.sre.stopChaos(name);
      this.notice = `fault injection cleared on ${name}`;
      await this.refresh();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  async fireLoad(): Promise<void> {
    this.error = null;
    try {
      const response = await this.sre.startLoad({
        scenario: this.scenario,
        duration_seconds: this.duration,
        rps: this.rps,
      });
      this.notice = `${response.scenario} load started: ${response.requests_planned} requests over ${response.duration_seconds}s`;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }
}
