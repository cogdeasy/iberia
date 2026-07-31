import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiService } from '../core/api.service';
import { ApiError } from '../core/session.model';

export interface Payment {
  id: number;
  pnr: string;
  status: string;
  amount_eur: number;
  card_last4: string;
  card_brand: string;
  provider_reference: string;
  created_at: string;
}

const TEST_CARDS = [
  { label: 'Visa', number: '4111 1111 1111 1111' },
  { label: 'Mastercard', number: '5555 5555 5555 4444' },
  { label: 'Amex', number: '3782 822463 10005' },
];

@Component({
  selector: 'app-checkout-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    @if (payment) {
      <section class="hero">
        <h1>Payment confirmed</h1>
        <p>
          Booking <strong>{{ payment.pnr }}</strong> is paid. Keep the provider reference for your
          records.
        </p>
      </section>
      <div class="grid cols-3">
        <div class="card">
          <div class="kpi-label">Amount charged</div>
          <div class="kpi">€{{ payment.amount_eur.toFixed(2) }}</div>
          <span class="badge ok">{{ payment.status }}</span>
        </div>
        <div class="card">
          <div class="kpi-label">Card</div>
          <div class="kpi">•••• {{ payment.card_last4 }}</div>
          <p class="muted">{{ payment.card_brand }}</p>
        </div>
        <div class="card">
          <div class="kpi-label">Provider reference</div>
          <div class="kpi" style="font-size: 20px">
            <code>{{ payment.provider_reference }}</code>
          </div>
          <p class="muted">payment #{{ payment.id }}</p>
        </div>
      </div>
      <div class="card">
        <a class="btn" routerLink="/payments">View payments &amp; refunds</a>
      </div>
    } @else {
      <section class="hero">
        <h1>Checkout</h1>
        <p>
          Pay for booking <strong>{{ pnr || '—' }}</strong>. Demo environment: use one of the fake
          test cards below, never a real card.
        </p>
      </section>

      <div class="grid cols-2">
        <div class="card">
          <h3>Card details</h3>
          @if (error) {
            <div class="error">{{ error }}</div>
          }
          <form (ngSubmit)="submit()">
            <div class="field">
              <label for="card-number">Card number</label>
              <input
                id="card-number"
                name="card-number"
                inputmode="numeric"
                autocomplete="off"
                placeholder="4111 1111 1111 1111"
                [(ngModel)]="cardNumber"
                required
              />
            </div>
            <div class="field">
              <label for="card-holder">Cardholder name</label>
              <input
                id="card-holder"
                name="card-holder"
                placeholder="LUCIA FERNANDEZ"
                [(ngModel)]="cardHolder"
                required
              />
            </div>
            <div class="grid cols-2">
              <div class="field">
                <label for="expiry">Expiry</label>
                <input id="expiry" name="expiry" placeholder="12/29" [(ngModel)]="expiry" required />
              </div>
              <div class="field">
                <label for="cvv">CVV</label>
                <input
                  id="cvv"
                  name="cvv"
                  inputmode="numeric"
                  placeholder="123"
                  [(ngModel)]="cvv"
                  required
                />
              </div>
            </div>
            <button class="btn" type="submit" [disabled]="busy || !pnr">
              {{ busy ? 'Authorising…' : 'Pay now' }}
            </button>
          </form>
        </div>

        <div class="card">
          <h3>Test cards</h3>
          <p class="muted">Fake numbers accepted by the simulated acquirer.</p>
          <table>
            <thead>
              <tr>
                <th>Brand</th>
                <th>Number</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (card of testCards; track card.label) {
                <tr>
                  <td>{{ card.label }}</td>
                  <td><code>{{ card.number }}</code></td>
                  <td>
                    <button class="btn ghost" type="button" (click)="useCard(card)">Use</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class CheckoutPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);

  readonly testCards = TEST_CARDS;

  pnr = '';
  cardNumber = '';
  cardHolder = '';
  expiry = '';
  cvv = '';
  payment: Payment | null = null;
  error: string | null = null;
  busy = false;

  ngOnInit(): void {
    this.pnr = this.route.snapshot.paramMap.get('pnr') ?? '';
  }

  useCard(card: { label: string; number: string }): void {
    this.cardNumber = card.number;
    this.expiry = '12/29';
    this.cvv = card.label === 'Amex' ? '1234' : '123';
  }

  async submit(): Promise<void> {
    this.busy = true;
    this.error = null;
    try {
      this.payment = await this.api.post<Payment>('/api/payments/authorise', {
        pnr: this.pnr,
        card_number: this.cardNumber.replace(/\s+/g, ''),
        card_holder: this.cardHolder,
        expiry: this.expiry,
        cvv: this.cvv,
      });
    } catch (err) {
      this.error =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Payment failed';
    } finally {
      this.busy = false;
    }
  }
}
