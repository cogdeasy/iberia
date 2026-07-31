import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

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
  cabin: string;
  fare_eur: number;
  status: string;
}

interface Passenger {
  id: number;
  first_name: string;
  last_name: string;
  seat: string | null;
  checked_in: boolean;
  document_number: string | null;
}

interface Booking {
  pnr: string;
  status: string;
  flight: FlightOffer;
  passengers: Passenger[];
  total_eur: number;
  payment_status: string;
  created_at: string;
  contact_email: string;
}

interface Seat {
  seat: string;
  cabin: string;
  available: boolean;
  price_eur: number;
}

interface SeatMap {
  rows: { row: number; seats: Seat[] }[];
}

@Component({
  selector: 'app-bookings-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="hero">
      <h1>My bookings</h1>
      <p>Record locators, seats and payment status for {{ user?.full_name ?? 'your account' }}.</p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }
    @if (notice) {
      <div class="notice">{{ notice }}</div>
    }
    @if (!user) {
      <div class="notice">Sign in to see your PNRs.</div>
    }

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>PNR</th>
            <th>Flight</th>
            <th>Departure</th>
            <th>Cabin</th>
            <th>Passengers</th>
            <th>Total</th>
            <th>Status</th>
            <th>Payment</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (booking of bookings; track booking.pnr) {
            <tr>
              <td><code>{{ booking.pnr }}</code></td>
              <td>
                {{ booking.flight.flight_number }} · {{ booking.flight.origin }} →
                {{ booking.flight.destination }}
              </td>
              <td>{{ departureLabel(booking) }}</td>
              <td>{{ booking.flight.cabin.replace('_', ' ') }}</td>
              <td>{{ passengerLabel(booking) }}</td>
              <td>€{{ booking.total_eur.toFixed(2) }}</td>
              <td><span [class]="statusClass(booking.status)">{{ booking.status }}</span></td>
              <td>
                <span [class]="booking.payment_status === 'paid' ? 'badge ok' : 'badge warn'">
                  {{ booking.payment_status }}
                </span>
              </td>
              <td>
                <button class="btn ghost" type="button" (click)="openSeatmap(booking)">
                  Seats
                </button>
                @if (booking.status !== 'cancelled') {
                  <button class="btn ghost" type="button" (click)="cancel(booking.pnr)">
                    Cancel
                  </button>
                }
              </td>
            </tr>
          }
          @if (!bookings.length && !loading) {
            <tr>
              <td colspan="9" class="muted">No bookings yet — search a flight to get started.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    @if (seatmapFor && seatmap) {
      <div class="card">
        <h3>Seat map · {{ seatmapFor }}</h3>
        <div class="field">
          <label for="passenger">Assign to passenger</label>
          <select id="passenger" name="passenger" [(ngModel)]="selectedPassenger">
            @for (passenger of seatmapPassengers; track passenger.id) {
              <option [ngValue]="passenger.id">
                {{ passenger.first_name }} {{ passenger.last_name }}
              </option>
            }
          </select>
        </div>
        <div style="display: grid; gap: 6px">
          @for (row of seatmap.rows; track row.row) {
            <div style="display: flex; gap: 6px; align-items: center">
              <span class="muted" style="width: 28px; font-size: 12px">{{ row.row }}</span>
              @for (seat of row.seats; track seat.seat) {
                <button
                  class="btn ghost"
                  type="button"
                  [disabled]="!seat.available"
                  (click)="assignSeat(seatmapFor, seat.seat)"
                  style="padding: 4px 8px; font-size: 12px"
                >
                  {{ seat.seat }}
                </button>
              }
              <span class="badge">{{ row.seats[0]?.cabin }}</span>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class BookingsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);

  user: SessionUser | null = this.session.getUser();
  bookings: Booking[] = [];
  error: string | null = null;
  notice: string | null = null;
  loading = true;
  seatmapFor: string | null = null;
  seatmap: SeatMap | null = null;
  selectedPassenger: number | null = null;

  get seatmapPassengers(): Passenger[] {
    return this.bookings.find((booking) => booking.pnr === this.seatmapFor)?.passengers ?? [];
  }

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      this.bookings = await this.api.get<Booking[]>('/api/bookings');
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load bookings';
    } finally {
      this.loading = false;
    }
  }

  departureLabel(booking: Booking): string {
    return new Date(booking.flight.scheduled_departure).toLocaleString();
  }

  passengerLabel(booking: Booking): string {
    return booking.passengers
      .map((p) => `${p.first_name} ${p.last_name}${p.seat ? ` (${p.seat})` : ''}`)
      .join(', ');
  }

  statusClass(status: string): string {
    return status === 'cancelled' ? 'badge crit' : status === 'confirmed' ? 'badge ok' : 'badge';
  }

  async openSeatmap(booking: Booking): Promise<void> {
    this.notice = null;
    if (this.seatmapFor === booking.pnr) {
      this.seatmapFor = null;
      this.seatmap = null;
      return;
    }
    try {
      this.seatmap = await this.api.get<SeatMap>(`/api/bookings/${booking.pnr}/seatmap`);
      this.seatmapFor = booking.pnr;
      this.selectedPassenger = booking.passengers[0]?.id ?? null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load seat map';
    }
  }

  async assignSeat(pnr: string, seat: string): Promise<void> {
    if (this.selectedPassenger === null) return;
    try {
      await this.api.post<Booking>(`/api/bookings/${pnr}/seats`, {
        assignments: [{ passenger_id: this.selectedPassenger, seat }],
      });
      this.notice = `Seat ${seat} assigned on ${pnr}.`;
      this.seatmapFor = null;
      this.seatmap = null;
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Seat assignment failed';
    }
  }

  async cancel(pnr: string): Promise<void> {
    try {
      await this.api.post<Booking>(`/api/bookings/${pnr}/cancel`);
      this.notice = `PNR ${pnr} cancelled.`;
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Cancellation failed';
    }
  }
}
