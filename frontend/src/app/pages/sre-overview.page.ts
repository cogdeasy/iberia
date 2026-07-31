import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Color, LineChartModule, ScaleType } from '@swimlane/ngx-charts';

import {
  Signals,
  SreApiService,
  SreService,
  clockTime,
  healthBadge,
} from '../core/sre.service';

const WINDOWS = [15, 30, 60, 180];

interface ChartSeries {
  name: string;
  series: { name: string; value: number }[];
}

@Component({
  selector: 'app-sre-overview-page',
  standalone: true,
  imports: [FormsModule, LineChartModule],
  template: `
    <section class="hero">
      <h1>Reliability console</h1>
      <p>Golden signals per service, computed from the live Prometheus registry.</p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }

    <div class="grid cols-4">
      <div class="card">
        <div class="kpi-label">Traffic</div>
        <div class="kpi">{{ signals ? signals.traffic_rpm.toFixed(0) : '…' }}</div>
        <p class="muted">requests / minute</p>
      </div>
      <div class="card">
        <div class="kpi-label">Error rate</div>
        <div class="kpi">{{ signals ? (signals.error_rate * 100).toFixed(2) + '%' : '…' }}</div>
        <p class="muted">5xx share of requests</p>
      </div>
      <div class="card">
        <div class="kpi-label">Latency p95</div>
        <div class="kpi">{{ signals ? signals.latency_p95_ms.toFixed(0) + ' ms' : '…' }}</div>
        <p class="muted">
          p50 {{ signals ? signals.latency_p50_ms.toFixed(0) : '-' }} ms · p99
          {{ signals ? signals.latency_p99_ms.toFixed(0) : '-' }} ms
        </p>
      </div>
      <div class="card">
        <div class="kpi-label">Saturation</div>
        <div class="kpi">{{ signals ? signals.saturation_pct.toFixed(0) + '%' : '…' }}</div>
        <p class="muted">of provisioned capacity</p>
      </div>
    </div>

    <div class="card">
      <h3>Service health</h3>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Tier</th>
            <th>Owner</th>
            <th>Version</th>
            <th>Endpoints</th>
            <th>Health</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (service of services; track service.name) {
            <tr>
              <td><strong>{{ service.name }}</strong></td>
              <td>T{{ service.tier }}</td>
              <td>{{ service.owner }}</td>
              <td><code>{{ service.version }}</code></td>
              <td class="muted">{{ service.endpoints.join(', ') }}</td>
              <td><span class="badge {{ healthBadge(service.health) }}">{{ service.health }}</span></td>
              <td>
                <button
                  [class]="service.name === selected ? 'btn' : 'btn ghost'"
                  type="button"
                  (click)="select(service.name)"
                >
                  Signals
                </button>
              </td>
            </tr>
          }
          @if (!services.length) {
            <tr>
              <td colspan="7" class="muted">No services registered.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <div class="card">
      <h3>
        {{ selected ?? 'Service' }} · last {{ windowMinutes }} minutes
        @if (signals?.synthetic) {
          <span class="badge warn">synthetic history</span>
        }
      </h3>
      <div class="field">
        <label for="sre-window">Window</label>
        <select
          id="sre-window"
          name="sre-window"
          [ngModel]="windowMinutes"
          (ngModelChange)="setWindow($event)"
        >
          @for (minutes of windows; track minutes) {
            <option [ngValue]="minutes">{{ minutes }} minutes</option>
          }
        </select>
      </div>
      <div style="height: 260px">
        <ngx-charts-line-chart
          [results]="chartData"
          [scheme]="scheme"
          [xAxis]="true"
          [yAxis]="true"
          [legend]="true"
          legendTitle="Signals"
        />
      </div>
      <p class="muted">
        Refreshes every 15 seconds. Fire the load generator from the chaos console to fill the
        series with real traffic.
      </p>
    </div>
  `,
})
export class SreOverviewPageComponent implements OnInit, OnDestroy {
  private readonly sre = inject(SreApiService);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly windows = WINDOWS;
  readonly healthBadge = healthBadge;
  readonly scheme: Color = {
    name: 'iberia',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#d7192d', '#1d4ed8', '#b45309'],
  };

  services: SreService[] = [];
  selected: string | null = null;
  windowMinutes = 30;
  signals: Signals | null = null;
  chartData: ChartSeries[] = [];
  error: string | null = null;

  ngOnInit(): void {
    void this.load();
    this.timer = setInterval(() => void this.refreshSignals(), 15000);
  }

  private async load(): Promise<void> {
    try {
      this.services = await this.sre.listServices();
      this.selected = this.selected ?? this.services[0]?.name ?? null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
    await this.refreshSignals();
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  select(name: string): void {
    this.selected = name;
    void this.refreshSignals();
  }

  setWindow(minutes: number): void {
    this.windowMinutes = minutes;
    void this.refreshSignals();
  }

  async refreshSignals(): Promise<void> {
    if (!this.selected) return;
    try {
      this.signals = await this.sre.getSignals(this.selected, this.windowMinutes);
      const points = this.signals.series;
      this.chartData = [
        {
          name: 'requests/min',
          series: points.map((point) => ({ name: clockTime(point.ts), value: point.rpm })),
        },
        {
          name: 'p95 ms',
          series: points.map((point) => ({ name: clockTime(point.ts), value: point.p95_ms })),
        },
        {
          name: 'errors %',
          series: points.map((point) => ({
            name: clockTime(point.ts),
            value: Number((point.error_rate * 100).toFixed(3)),
          })),
        },
      ];
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }
}
