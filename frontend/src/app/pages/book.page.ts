import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ApiService } from '../core/api.service';
import { SessionUser } from '../core/session.model';
import { SessionService } from '../core/session.service';

interface FlightOffer {
  flight_id: number;
  flight_number: string;
  origin: string;
  destination: string;
  scheduled_departure: string;
  scheduled_arrival: string;
  duration_minutes: number;
  cabin: string;
  fare_eur: number;
  seats_available: number;
  status: string;
}

interface Booking {
  pnr: string;
  status: string;
  total_eur: number;
  payment_status: string;
  flight: FlightOffer;
}

interface PassengerForm {
  first_name: string;
  last_name: string;
  date_of_birth: string;
  document_number: string;
}

const CABINS = ['economy', 'premium_economy', 'business', 'first'];
const CABIN_MULTIPLIER: Record<string, number> = {
  economy: 1,
  premium_economy: 1.6,
  business: 2.75,
  first: 4,
};

const emptyPassenger = (): PassengerForm => ({
  first_name: '',
  last_name: '',
  date_of_birth: '',
  document_number: '',
});

@Component({
  selector: 'app-book-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    @if (booking) {
      <div class="card">
        <h2>Booking confirmed</h2>
        <div class="grid cols-3">
          <div>
            <div class="kpi-label">Record locator</div>
            <div class="kpi">{{ booking.pnr }}</div>
          </div>
          <div>
            <div class="kpi-label">Total</div>
            <div class="kpi">€{{ booking.total_eur.toFixed(2) }}</div>
          </div>
          <div>
            <div class="kpi-label">Payment</div>
            <div class="kpi"><span class="badge warn">{{ booking.payment_status }}</span></div>
          </div>
        </div>
        <p class="muted">
          Your seats are not held until payment completes. Continue to payment to secure the fare.
        </p>
        <a class="btn" [routerLink]="['/checkout', booking.pnr]">Continue to payment</a>
        <button class="btn ghost" type="button" (click)="goToBookings()">View my bookings</button>
      </div>
    } @else {
      <section class="hero">
        <h1>Passenger details</h1>
        <p>{{ flightSummary }}</p>
      </section>

      @if (error) {
        <div class="error">{{ error }}</div>
      }
      @if (!user) {
        <div class="notice">Sign in first — booking requires an authenticated user.</div>
      }

      <form class="card" (ngSubmit)="submit()">
        <div class="grid cols-2">
          <div class="field">
            <label for="cabin">Cabin</label>
            <select id="cabin" name="cabin" [(ngModel)]="cabin">
              @for (option of cabins; track option) {
                <option [value]="option">{{ option.replace('_', ' ') }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="contact">Contact email</label>
            <input id="contact" name="contact" type="email" required [(ngModel)]="contactEmail" />
          </div>
        </div>

        @for (passenger of passengers; track $index) {
          <div class="card">
            <h3>Passenger {{ $index + 1 }}</h3>
            <div class="grid cols-4">
              <div class="field">
                <label [attr.for]="'first-' + $index">First name</label>
                <input
                  [id]="'first-' + $index"
                  [name]="'first-' + $index"
                  required
                  [(ngModel)]="passenger.first_name"
                />
              </div>
              <div class="field">
                <label [attr.for]="'last-' + $index">Last name</label>
                <input
                  [id]="'last-' + $index"
                  [name]="'last-' + $index"
                  required
                  [(ngModel)]="passenger.last_name"
                />
              </div>
              <div class="field">
                <label [attr.for]="'dob-' + $index">Date of birth</label>
                <input
                  [id]="'dob-' + $index"
                  [name]="'dob-' + $index"
                  type="date"
                  [(ngModel)]="passenger.date_of_birth"
                />
              </div>
              <div class="field">
                <label [attr.for]="'doc-' + $index">Passport number</label>
                <input
                  [id]="'doc-' + $index"
                  [name]="'doc-' + $index"
                  [(ngModel)]="passenger.document_number"
                />
              </div>
            </div>
            @if (passengers.length > 1) {
              <button type="button" class="btn ghost" (click)="removePassenger($index)">
                Remove passenger
              </button>
            }
          </div>
        }

        <div class="grid cols-3">
          <button type="button" class="btn ghost" (click)="addPassenger()">Add passenger</button>
          <div>
            <div class="kpi-label">Estimated total</div>
            <div class="kpi">{{ estimate === null ? '—' : '€' + estimate.toFixed(2) }}</div>
          </div>
          <button class="btn" type="submit" [disabled]="saving || !user">
            {{ saving ? 'Creating PNR…' : 'Create booking' }}
          </button>
        </div>
      </form>
    }
  `,
})
export class BookPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);

  readonly cabins = CABINS;

  flightId: string | null = null;
  user: SessionUser | null = this.session.getUser();
  flight: FlightOffer | null = null;
  cabin = 'economy';
  passengers: PassengerForm[] = [emptyPassenger()];
  contactEmail = this.session.getUser()?.email ?? '';
  booking: Booking | null = null;
  error: string | null = null;
  saving = false;

  get flightSummary(): string {
    if (!this.flight) return `Flight #${this.flightId}`;
    const departure = new Date(this.flight.scheduled_departure).toLocaleString();
    return `${this.flight.flight_number} · ${this.flight.origin} → ${this.flight.destination} · ${departure}`;
  }

  get estimate(): number | null {
    if (!this.flight) return null;
    const baseFare = this.flight.fare_eur / CABIN_MULTIPLIER[this.flight.cabin ?? 'economy'];
    return Math.round(baseFare * CABIN_MULTIPLIER[this.cabin] * this.passengers.length * 100) / 100;
  }

  async ngOnInit(): Promise<void> {
    this.flightId = this.route.snapshot.paramMap.get('flightId');
    if (!this.flightId) return;
    try {
      this.flight = await this.api.get<FlightOffer>(`/api/flights/${this.flightId}`);
    } catch {
      this.flight = null;
    }
  }

  addPassenger(): void {
    this.passengers = [...this.passengers, emptyPassenger()];
  }

  removePassenger(index: number): void {
    this.passengers = this.passengers.filter((_, i) => i !== index);
  }

  goToBookings(): void {
    void this.router.navigate(['/bookings']);
  }

  async submit(): Promise<void> {
    if (!this.flightId) return;
    this.saving = true;
    this.error = null;
    try {
      this.booking = await this.api.post<Booking>('/api/bookings', {
        flight_id: Number(this.flightId),
        cabin: this.cabin,
        contact_email: this.contactEmail,
        passengers: this.passengers.map((passenger) => ({
          first_name: passenger.first_name,
          last_name: passenger.last_name,
          date_of_birth: passenger.date_of_birth || null,
          document_number: passenger.document_number || null,
        })),
      });
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Booking failed';
    } finally {
      this.saving = false;
    }
  }
}
