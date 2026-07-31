import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AreaChartModule, Color, ScaleType } from '@swimlane/ngx-charts';

import { ApiService } from '../core/api.service';

interface LoyaltyTxn {
  id: number;
  created_at: string;
  description: string;
  avios: number;
  balance_after: number;
}

interface Member {
  plus_number: string;
  full_name: string;
  tier: string;
  avios_balance: number;
  tier_points: number;
  transactions: LoyaltyTxn[];
}

const TIER_BADGE: Record<string, string> = {
  Clásica: 'badge',
  Plata: 'badge',
  Oro: 'badge warn',
  Platino: 'badge ok',
};

const TIER_THRESHOLDS: [string, number][] = [
  ['Plata', 1200],
  ['Oro', 3600],
  ['Platino', 7200],
];

function formatAvios(value: number): string {
  return value.toLocaleString('en-GB');
}

@Component({
  selector: 'app-loyalty-page',
  standalone: true,
  imports: [FormsModule, AreaChartModule],
  template: `
    <section class="hero">
      <h1>Iberia Plus</h1>
      <p>Your Avios balance, tier progress and account activity.</p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }
    @if (notice) {
      <div class="notice">{{ notice }}</div>
    }

    @if (member; as account) {
      <div class="grid cols-4">
        <div class="card">
          <div class="kpi-label">Avios balance</div>
          <div class="kpi">{{ formatAvios(account.avios_balance) }}</div>
          <p class="muted">{{ account.plus_number }}</p>
        </div>
        <div class="card">
          <div class="kpi-label">Tier</div>
          <div class="kpi"><span [class]="tierBadge(account.tier)">{{ account.tier }}</span></div>
          <p class="muted">{{ account.full_name }}</p>
        </div>
        <div class="card">
          <div class="kpi-label">Tier points</div>
          <div class="kpi">{{ formatAvios(account.tier_points) }}</div>
          <p class="muted">{{ nextTier(account.tier_points) }}</p>
        </div>
        <div class="card">
          <div class="kpi-label">Activity</div>
          <div class="kpi">{{ account.transactions.length }}</div>
          <p class="muted">ledger entries</p>
        </div>
      </div>

      <div class="card">
        <h3>Avios balance over time</h3>
        <div style="height: 260px">
          <ngx-charts-area-chart
            [results]="series"
            [scheme]="scheme"
            [xAxis]="true"
            [yAxis]="true"
            [roundDomains]="true"
            [yAxisTickFormatting]="formatAvios"
          />
        </div>
      </div>

      <div class="grid cols-2">
        <div class="card">
          <h3>Transactions</h3>
          <table class="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Avios</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              @for (txn of reversedTransactions; track txn.id) {
                <tr>
                  <td>{{ txnDate(txn) }}</td>
                  <td>{{ txn.description }}</td>
                  <td [style.color]="txn.avios < 0 ? 'var(--crit)' : 'var(--ok)'">
                    {{ txn.avios > 0 ? '+' : '' }}{{ formatAvios(txn.avios) }}
                  </td>
                  <td>{{ formatAvios(txn.balance_after) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <div class="card">
          <h3>Transfer Avios</h3>
          <form (ngSubmit)="submitTransfer()">
            <div class="field">
              <label for="to-plus-number">Recipient Iberia Plus number</label>
              <input
                id="to-plus-number"
                name="to-plus-number"
                [(ngModel)]="toPlusNumber"
                placeholder="IB7654321"
                required
              />
            </div>
            <div class="field">
              <label for="transfer-avios">Avios</label>
              <input
                id="transfer-avios"
                name="transfer-avios"
                type="number"
                [(ngModel)]="transferAvios"
                required
              />
            </div>
            <button class="btn" type="submit" [disabled]="busy">
              {{ busy ? 'Transferring…' : 'Transfer Avios' }}
            </button>
          </form>
          <p class="muted">
            Avios move instantly between Iberia Plus accounts. Household transfers are free.
          </p>
        </div>
      </div>
    }
  `,
})
export class LoyaltyPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly formatAvios = formatAvios;
  readonly scheme: Color = {
    name: 'iberia',
    selectable: true,
    group: ScaleType.Ordinal,
    domain: ['#d7192d'],
  };

  member: Member | null = null;
  error: string | null = null;
  notice: string | null = null;
  toPlusNumber = '';
  transferAvios = '1000';
  busy = false;
  series: { name: string; series: { name: string; value: number }[] }[] = [];

  get reversedTransactions(): LoyaltyTxn[] {
    return [...(this.member?.transactions ?? [])].reverse();
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    try {
      this.member = await this.api.get<Member>('/api/loyalty/me');
      this.error = null;
      this.series = [
        {
          name: 'Avios balance',
          series: this.member.transactions.map((txn) => ({
            name: new Date(txn.created_at).toLocaleDateString('en-GB', {
              month: 'short',
              year: '2-digit',
            }),
            value: txn.balance_after,
          })),
        },
      ];
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load Iberia Plus account';
    }
  }

  tierBadge(tier: string): string {
    return TIER_BADGE[tier] ?? 'badge';
  }

  nextTier(tierPoints: number): string {
    const next = TIER_THRESHOLDS.find(([, threshold]) => tierPoints < threshold);
    if (!next) return 'Top tier reached';
    return `${formatAvios(next[1] - tierPoints)} tier points to ${next[0]}`;
  }

  txnDate(txn: LoyaltyTxn): string {
    return new Date(txn.created_at).toLocaleDateString('en-GB');
  }

  async submitTransfer(): Promise<void> {
    this.busy = true;
    this.notice = null;
    this.error = null;
    try {
      const result = await this.api.post<{ balance: number }>('/api/loyalty/transfer', {
        to_plus_number: this.toPlusNumber,
        avios: Number(this.transferAvios),
      });
      this.notice =
        `Transferred ${formatAvios(Number(this.transferAvios))} Avios to ${this.toPlusNumber}. ` +
        `New balance ${formatAvios(result.balance)}.`;
      this.toPlusNumber = '';
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Transfer failed';
    } finally {
      this.busy = false;
    }
  }
}
