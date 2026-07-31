import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BarChartModule, Color, PieChartModule, ScaleType } from '@swimlane/ngx-charts';

import { ApiService } from '../core/api.service';

interface Finding {
  id: string;
  title: string;
  severity: string;
  cwe: string;
  owasp: string;
  location: string;
  status: string;
  description: string;
  remediation: string;
  domain: string;
}

interface Posture {
  score: number;
  total: number;
  counts: { critical: number; high: number; medium: number; low: number };
  categories: { category: string; count: number }[];
}

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

type Severity = (typeof SEVERITIES)[number];

const SEVERITY_COLOURS: Record<string, string> = {
  critical: '#b91c1c',
  high: '#d7192d',
  medium: '#f0b323',
  low: '#0f7b52',
};

function severityBadge(severity: string): string {
  if (severity === 'critical' || severity === 'high') return 'badge crit';
  if (severity === 'medium') return 'badge warn';
  return 'badge ok';
}

function scoreBadge(score: number): string {
  if (score >= 80) return 'badge ok';
  if (score >= 50) return 'badge warn';
  return 'badge crit';
}

@Component({
  selector: 'app-security-posture-page',
  standalone: true,
  imports: [FormsModule, PieChartModule, BarChartModule],
  template: `
    <section class="hero">
      <h1>Security posture</h1>
      <p>
        Findings register parsed live from <code>docs/vulnerabilities/</code>, scored by severity
        and mapped to the OWASP Top 10 (2021).
      </p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }
    @if (loading && !error) {
      <div class="notice">Loading findings register…</div>
    }

    <div class="grid cols-4">
      <div class="card">
        <div class="kpi-label">Posture score</div>
        <div class="kpi">{{ posture?.score ?? '–' }}</div>
        <span [class]="scoreBadge(posture?.score ?? 0)">
          {{ (posture?.score ?? 0) >= 80 ? 'acceptable' : 'needs work' }}
        </span>
      </div>
      <div class="card">
        <div class="kpi-label">Open findings</div>
        <div class="kpi">{{ posture?.total ?? findings.length }}</div>
        <p class="muted">across all domains</p>
      </div>
      <div class="card">
        <div class="kpi-label">Critical / High</div>
        <div class="kpi">
          {{ (posture?.counts?.critical ?? 0) + (posture?.counts?.high ?? 0) }}
        </div>
        <p class="muted">remediate first</p>
      </div>
      <div class="card">
        <div class="kpi-label">OWASP categories hit</div>
        <div class="kpi">{{ posture?.categories?.length ?? 0 }}</div>
        <p class="muted">of the 2021 top ten</p>
      </div>
    </div>

    <div class="grid cols-2">
      <div class="card">
        <h3>Findings by severity</h3>
        <div style="height: 260px">
          <ngx-charts-pie-chart
            [results]="severityData"
            [scheme]="severityScheme"
            [doughnut]="true"
            [labels]="true"
            [legend]="true"
          />
        </div>
      </div>
      <div class="card">
        <h3>Findings by OWASP category</h3>
        <div style="height: 260px">
          <ngx-charts-bar-horizontal
            [results]="categoryData"
            [scheme]="categoryScheme"
            [xAxis]="true"
            [yAxis]="true"
          />
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Findings register</h3>
      <div class="field" style="max-width: 240px">
        <label for="severity-filter">Severity</label>
        <select id="severity-filter" name="severity-filter" [(ngModel)]="severity">
          <option value="all">All severities</option>
          @for (name of severities; track name) {
            <option [value]="name">{{ name }}</option>
          }
        </select>
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Domain</th>
            <th>Severity</th>
            <th>CWE</th>
            <th>OWASP</th>
            <th>Location</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (finding of visible; track finding.id) {
            <tr>
              <td>{{ finding.id }}</td>
              <td>{{ finding.title }}</td>
              <td>{{ finding.domain || '–' }}</td>
              <td><span [class]="severityBadge(finding.severity)">{{ finding.severity }}</span></td>
              <td>{{ finding.cwe }}</td>
              <td>{{ finding.owasp }}</td>
              <td><code>{{ finding.location }}</code></td>
              <td>
                <button class="btn ghost" type="button" (click)="selected = finding">Detail</button>
              </td>
            </tr>
          }
          @if (!visible.length && !loading) {
            <tr>
              <td colspan="8" class="muted">No findings for this filter.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    @if (selected; as finding) {
      <div class="card">
        <h3>
          {{ finding.id }} — {{ finding.title }}
          <span [class]="severityBadge(finding.severity)">{{ finding.severity }}</span>
        </h3>
        <p class="muted">
          {{ finding.cwe }} · {{ finding.owasp }} · <code>{{ finding.location }}</code> · status
          {{ finding.status }}
        </p>
        <h4>Description</h4>
        <pre>{{ finding.description || 'No description recorded.' }}</pre>
        <h4>Intended remediation</h4>
        <pre>{{ finding.remediation || 'No remediation recorded.' }}</pre>
        <button class="btn" type="button" (click)="selected = null">Close</button>
      </div>
    }
  `,
})
export class SecurityPosturePageComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly severities = SEVERITIES;
  readonly severityBadge = severityBadge;
  readonly scoreBadge = scoreBadge;
  readonly severityScheme: Color = {
    name: 'severity',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: SEVERITIES.map((name) => SEVERITY_COLOURS[name]),
  };
  readonly categoryScheme: Color = {
    name: 'category',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#d7192d'],
  };

  posture: Posture | null = null;
  findings: Finding[] = [];
  severity = 'all';
  selected: Finding | null = null;
  error: string | null = null;
  loading = true;
  severityData: { name: string; value: number }[] = [];
  categoryData: { name: string; value: number }[] = [];

  get visible(): Finding[] {
    return this.severity === 'all'
      ? this.findings
      : this.findings.filter((f) => f.severity === this.severity);
  }

  async ngOnInit(): Promise<void> {
    this.loading = true;
    try {
      const [posture, findings] = await Promise.all([
        this.api.get<Posture>('/api/security/posture'),
        this.api.get<Finding[]>('/api/security/findings'),
      ]);
      this.posture = posture;
      this.findings = findings;
      this.error = null;
      this.severityData = SEVERITIES.map((name: Severity) => ({
        name,
        value: posture.counts[name],
      })).filter((entry) => entry.value > 0);
      this.categoryData = posture.categories.map((entry) => ({
        name: entry.category.split(/[–-]/)[0].trim() || entry.category,
        value: entry.count,
      }));
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }
}
