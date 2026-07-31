import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { ApiService } from '../core/api.service';
import { ApiError } from '../core/session.model';
import { Payment } from './checkout.page';

interface Refund {
  id: number;
  payment_id: number;
  amount_eur: number;
  status: string;
  reason: string;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  authorised: 'badge ok',
  part_refunded: 'badge warn',
  refunded: 'badge crit',
};

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

@Component({
  selector: 'app-payments-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="hero">
      <h1>Payments</h1>
      <p>Card authorisations taken through the Iberia checkout, and their refunds.</p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }

    <div class="grid cols-3">
      <div class="card">
        <div class="kpi-label">Payments</div>
        <div class="kpi">{{ payments.length }}</div>
      </div>
      <div class="card">
        <div class="kpi-label">Authorised value</div>
        <div class="kpi">€{{ total.toFixed(2) }}</div>
      </div>
      <div class="card">
        <div class="kpi-label">Pay for a booking</div>
        <form (ngSubmit)="goToCheckout()">
          <div class="field">
            <input
              aria-label="PNR"
              name="pnr"
              placeholder="PNR e.g. IBDEMO"
              [(ngModel)]="pnr"
            />
          </div>
          <button class="btn" type="submit">Go to checkout</button>
        </form>
      </div>
    </div>

    <div class="card">
      <h3>Transactions</h3>
      @if (!payments.length) {
        <p class="muted">No payments yet — take one through the checkout.</p>
      } @else {
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>PNR</th>
              <th>Card</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Provider reference</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (payment of payments; track payment.id) {
              <tr>
                <td>{{ payment.id }}</td>
                <td><code>{{ payment.pnr }}</code></td>
                <td>{{ payment.card_brand }} •••• {{ payment.card_last4 }}</td>
                <td>€{{ payment.amount_eur.toFixed(2) }}</td>
                <td><span [class]="statusBadge(payment.status)">{{ payment.status }}</span></td>
                <td><code>{{ payment.provider_reference }}</code></td>
                <td>
                  <button class="btn ghost" type="button" (click)="select(payment)">Refund</button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>

    @if (selected; as payment) {
      <div class="grid cols-2">
        <div class="card">
          <h3>Refund payment #{{ payment.id }}</h3>
          <p class="muted">
            {{ payment.pnr }} · {{ payment.card_brand }} •••• {{ payment.card_last4 }} · €{{
              payment.amount_eur.toFixed(2)
            }}
          </p>
          <form (ngSubmit)="refund()">
            <div class="field">
              <label for="refund-amount">Amount (EUR)</label>
              <input
                id="refund-amount"
                name="refund-amount"
                inputmode="decimal"
                [(ngModel)]="amount"
                required
              />
            </div>
            <div class="field">
              <label for="refund-reason">Reason</label>
              <input
                id="refund-reason"
                name="refund-reason"
                placeholder="Flight cancelled"
                [(ngModel)]="reason"
              />
            </div>
            <button class="btn" type="submit" [disabled]="busy">
              {{ busy ? 'Refunding…' : 'Issue refund' }}
            </button>
          </form>
        </div>
        <div class="card">
          <h3>Refund history</h3>
          @if (!refunds.length) {
            <p class="muted">No refunds on this payment.</p>
          } @else {
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                @for (item of refunds; track item.id) {
                  <tr>
                    <td>{{ item.id }}</td>
                    <td>€{{ item.amount_eur.toFixed(2) }}</td>
                    <td><span class="badge">{{ item.status }}</span></td>
                    <td>{{ item.reason || '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      </div>
    }
  `,
})
export class PaymentsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  payments: Payment[] = [];
  selected: Payment | null = null;
  refunds: Refund[] = [];
  amount = '';
  reason = '';
  pnr = '';
  error: string | null = null;
  busy = false;

  get total(): number {
    return this.payments.reduce((sum, payment) => sum + payment.amount_eur, 0);
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    try {
      this.payments = await this.api.get<Payment[]>('/api/payments');
    } catch (err) {
      this.error = errorMessage(err);
    }
  }

  statusBadge(status: string): string {
    return STATUS_BADGE[status] ?? 'badge';
  }

  goToCheckout(): void {
    if (this.pnr.trim()) void this.router.navigate(['/checkout', this.pnr.trim().toUpperCase()]);
  }

  async select(payment: Payment): Promise<void> {
    this.selected = payment;
    this.amount = payment.amount_eur.toFixed(2);
    this.reason = '';
    try {
      this.refunds = await this.api.get<Refund[]>(`/api/payments/${payment.id}/refunds`);
    } catch (err) {
      this.error = errorMessage(err);
    }
  }

  async refund(): Promise<void> {
    if (!this.selected) return;
    this.busy = true;
    this.error = null;
    try {
      const created = await this.api.post<Refund>(`/api/payments/${this.selected.id}/refund`, {
        amount_eur: Number(this.amount),
        reason: this.reason,
      });
      this.refunds = [...this.refunds, created];
      await this.load();
    } catch (err) {
      this.error = errorMessage(err);
    } finally {
      this.busy = false;
    }
  }
}
