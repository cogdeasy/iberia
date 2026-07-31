import { Component, OnDestroy, OnInit, inject } from '@angular/core';

import { ErrorBudget, Slo, SreApiService, statusBadge } from '../core/sre.service';

function burnBadge(rate: number): string {
  if (rate >= 6) return 'crit';
  if (rate >= 1) return 'warn';
  return 'ok';
}

function budgetColour(remaining: number): string {
  if (remaining <= 10) return 'var(--crit)';
  if (remaining <= 50) return 'var(--warn)';
  return 'var(--ok)';
}

@Component({
  selector: 'app-sre-slos-page',
  standalone: true,
  template: `
    <section class="hero">
      <h1>Service level objectives</h1>
      <p>Objective vs achieved, error budget remaining and burn rates over 1h and 6h.</p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }

    <div class="grid cols-3">
      <div class="card">
        <div class="kpi-label">Objectives tracked</div>
        <div class="kpi">{{ slos.length }}</div>
      </div>
      <div class="card">
        <div class="kpi-label">At risk</div>
        <div class="kpi">{{ atRisk }}</div>
        <p class="muted">burning budget faster than plan</p>
      </div>
      <div class="card">
        <div class="kpi-label">Breached</div>
        <div class="kpi">{{ breached }}</div>
        <p class="muted">objective already missed</p>
      </div>
    </div>

    <div class="card">
      <h3>Error budgets</h3>
      <table>
        <thead>
          <tr>
            <th>SLO</th>
            <th>Service</th>
            <th>Kind</th>
            <th>Objective</th>
            <th>Achieved</th>
            <th>Budget remaining</th>
            <th>Burn 1h</th>
            <th>Burn 6h</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          @for (slo of slos; track slo.id) {
            <tr>
              <td>
                <strong>{{ slo.name }}</strong>
                <br />
                <span class="muted"><code>{{ slo.id }}</code> · {{ slo.window_days }}d window</span>
              </td>
              <td>{{ slo.service }}</td>
              <td>{{ slo.kind }}{{ slo.threshold_ms ? ' < ' + slo.threshold_ms + ' ms' : '' }}</td>
              <td>{{ slo.objective_pct.toFixed(2) }}%</td>
              <td>{{ slo.current_pct.toFixed(2) }}%</td>
              <td>
                <div
                  style="background: var(--line); border-radius: 999px; height: 8px; overflow: hidden; margin-bottom: 4px"
                >
                  <div
                    [style.width.%]="clamp(remaining(slo))"
                    [style.background]="budgetColour(remaining(slo))"
                    style="height: 100%"
                  ></div>
                </div>
                <span class="muted">{{ remaining(slo).toFixed(1) }}%</span>
              </td>
              <td>
                <span class="badge {{ burnBadge(burn1h(slo)) }}">{{ burn1h(slo).toFixed(2) }}x</span>
              </td>
              <td>
                <span class="badge {{ burnBadge(burn6h(slo)) }}">{{ burn6h(slo).toFixed(2) }}x</span>
              </td>
              <td><span class="badge {{ statusBadge(slo.status) }}">{{ slo.status }}</span></td>
            </tr>
          }
          @if (!slos.length) {
            <tr>
              <td colspan="9" class="muted">No SLOs defined.</td>
            </tr>
          }
        </tbody>
      </table>
      <p class="muted">
        A burn rate above 1x means the budget for the window will be exhausted before it ends;
        above 6x pages immediately (<code>ErrorBudgetBurnFast</code>).
      </p>
    </div>
  `,
})
export class SreSlosPageComponent implements OnInit, OnDestroy {
  private readonly sre = inject(SreApiService);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly burnBadge = burnBadge;
  readonly budgetColour = budgetColour;
  readonly statusBadge = statusBadge;

  slos: Slo[] = [];
  budgets: Record<string, ErrorBudget> = {};
  error: string | null = null;

  get breached(): number {
    return this.slos.filter((slo) => slo.status === 'breached').length;
  }

  get atRisk(): number {
    return this.slos.filter((slo) => slo.status === 'at_risk').length;
  }

  ngOnInit(): void {
    void this.load();
    this.timer = setInterval(() => void this.load(), 20000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  clamp(remaining: number): number {
    return Math.min(Math.max(remaining, 0), 100);
  }

  remaining(slo: Slo): number {
    return this.budgets[slo.id]?.budget_remaining_pct ?? 0;
  }

  burn1h(slo: Slo): number {
    return this.budgets[slo.id]?.burn_rate_1h ?? 0;
  }

  burn6h(slo: Slo): number {
    return this.budgets[slo.id]?.burn_rate_6h ?? 0;
  }

  private async load(): Promise<void> {
    try {
      const rows = await this.sre.listSlos();
      this.slos = rows;
      const results = await Promise.all(
        rows.map((slo) => this.sre.getErrorBudget(slo.id).catch(() => null)),
      );
      const next: Record<string, ErrorBudget> = {};
      results.forEach((budget) => {
        if (budget) next[budget.slo_id] = budget;
      });
      this.budgets = next;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }
}
