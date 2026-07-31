import { Component, Input, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService } from '../core/api.service';
import { ApiError } from '../core/session.model';
import { SessionService } from '../core/session.service';

interface Passenger {
  id: number;
  first_name: string;
  last_name: string;
  seat: string | null;
  checked_in: boolean;
  document_number: string;
}

interface Reservation {
  pnr: string;
  flight_number: string;
  origin: string;
  destination: string;
  scheduled_departure: string;
  cabin: string;
  gate: string;
  contact_email: string;
  passengers: Passenger[];
}

interface BoardingPass {
  pnr: string;
  passenger_id: number;
  passenger_name: string;
  flight_number: string;
  origin: string;
  destination: string;
  boarding_time: string;
  gate: string;
  seat: string;
  sequence: number;
  barcode: string;
  qr_payload: string;
  document_number: string;
  document_filename: string;
}

interface BagReceipt {
  bag_tag: string;
  fee_eur: number;
  weight_kg: number;
  passenger_id: number;
  pnr: string;
}

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Renders the BCBP string as a deterministic set of stripes — enough for the demo. */
@Component({
  selector: 'app-barcode',
  standalone: true,
  template: `
    <div [attr.aria-label]="'barcode ' + value">
      <div style="display: flex; align-items: stretch; gap: 1px; height: 56px">
        @for (bar of bars; track $index) {
          <span
            [style.width.px]="bar"
            [style.background]="$index % 2 === 0 ? '#1b1b1f' : 'transparent'"
            style="display: block"
          ></span>
        }
      </div>
      <code class="muted" style="font-size: 10px; word-break: break-all">{{ value }}</code>
    </div>
  `,
})
export class BarcodeComponent {
  @Input({ required: true }) set value(next: string) {
    this.barcode = next;
    this.bars = Array.from(next, (char) => (char.charCodeAt(0) % 3) + 1);
  }

  get value(): string {
    return this.barcode;
  }

  private barcode = '';
  bars: number[] = [];
}

@Component({
  selector: 'app-checkin-page',
  standalone: true,
  imports: [FormsModule, BarcodeComponent],
  template: `
    <section class="hero">
      <h1>Online check-in</h1>
      <p>Confirm your travellers, pick up your boarding pass and add hold bags.</p>
    </section>

    @if (needsLogin) {
      <div class="notice">
        Sign in as <code>customer&#64;iberia.demo</code> (password <code>Iberia2026!</code>) to check
        in.
      </div>
    }
    @if (error) {
      <div class="error">{{ error }}</div>
    }

    <div class="card">
      <h3>Find your booking</h3>
      <div class="grid cols-3">
        <div class="field">
          <label for="pnr">Record locator (PNR)</label>
          <input
            id="pnr"
            name="pnr"
            [ngModel]="pnr"
            (ngModelChange)="pnr = $event.toUpperCase()"
            placeholder="XK7T2P"
          />
        </div>
        <div class="field">
          <label for="known">Open for check-in</label>
          <select id="known" name="known" [ngModel]="pnr" (ngModelChange)="onKnownSelected($event)">
            <option value="">Select a booking…</option>
            @for (row of reservations; track row.pnr) {
              <option [value]="row.pnr">
                {{ row.pnr }} · {{ row.flight_number }} {{ row.origin }}→{{ row.destination }}
              </option>
            }
          </select>
        </div>
        <div class="field" style="align-self: end">
          <button class="btn" type="button" [disabled]="busy || !pnr" (click)="loadReservation(pnr)">
            Retrieve booking
          </button>
        </div>
      </div>
    </div>

    @if (reservation; as booking) {
      <div class="card">
        <div style="display: flex; justify-content: space-between; gap: 12px">
          <h3 style="margin: 0">
            {{ booking.flight_number }} · {{ booking.origin }} → {{ booking.destination }}
          </h3>
          <span class="badge">{{ booking.cabin }}</span>
        </div>
        <p class="muted">
          Departs {{ formatTime(booking.scheduled_departure) }} · gate {{ booking.gate }} ·
          {{ booking.contact_email }}
        </p>

        <table>
          <thead>
            <tr>
              <th>Check in</th>
              <th>Passenger</th>
              <th>Seat</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            @for (passenger of booking.passengers; track passenger.id) {
              <tr>
                <td>
                  <input
                    type="checkbox"
                    style="width: 16px"
                    [checked]="selected.includes(passenger.id)"
                    (change)="toggle(passenger.id)"
                    [attr.aria-label]="
                      'select ' + passenger.first_name + ' ' + passenger.last_name
                    "
                  />
                </td>
                <td>{{ passenger.first_name }} {{ passenger.last_name }}</td>
                <td>{{ passenger.seat ?? '—' }}</td>
                <td>
                  @if (passenger.checked_in) {
                    <span class="badge ok">checked in</span>
                  } @else {
                    <span class="badge warn">not checked in</span>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>

        <button
          class="btn"
          type="button"
          style="margin-top: 16px"
          [disabled]="busy || !selected.length"
          (click)="checkIn()"
        >
          Check in {{ selected.length }} passenger{{ selected.length === 1 ? '' : 's' }}
        </button>
      </div>
    }

    @if (boardingPasses.length) {
      <h2>Boarding passes</h2>
      <div class="grid cols-2">
        @for (boarding of boardingPasses; track boarding.passenger_id) {
          <div class="card" style="border-top: 4px solid var(--ib-red)">
            <div style="display: flex; justify-content: space-between; gap: 12px">
              <div>
                <div class="kpi-label">Passenger</div>
                <strong>{{ boarding.passenger_name }}</strong>
              </div>
              <span class="badge ok">checked in</span>
            </div>

            <div class="grid cols-4" style="margin: 16px 0">
              <div>
                <div class="kpi-label">Flight</div>
                <div class="kpi" style="font-size: 20px">{{ boarding.flight_number }}</div>
              </div>
              <div>
                <div class="kpi-label">Route</div>
                <div class="kpi" style="font-size: 20px">
                  {{ boarding.origin }} → {{ boarding.destination }}
                </div>
              </div>
              <div>
                <div class="kpi-label">Seat</div>
                <div class="kpi" style="font-size: 20px">{{ boarding.seat }}</div>
              </div>
              <div>
                <div class="kpi-label">Gate</div>
                <div class="kpi" style="font-size: 20px">{{ boarding.gate }}</div>
              </div>
            </div>

            <div class="grid cols-3" style="margin-bottom: 16px">
              <div>
                <div class="kpi-label">Boarding</div>
                <div>{{ formatTime(boarding.boarding_time) }}</div>
              </div>
              <div>
                <div class="kpi-label">Sequence</div>
                <div>{{ sequenceLabel(boarding.sequence) }}</div>
              </div>
              <div>
                <div class="kpi-label">Document</div>
                <div><code>{{ boarding.document_number }}</code></div>
              </div>
            </div>

            <app-barcode [value]="boarding.barcode" />

            <p class="muted" style="font-size: 12px; margin-bottom: 0">
              QR payload <code>{{ boarding.qr_payload }}</code>
              @if (boarding.document_filename) {
                ·
                <button
                  class="btn ghost"
                  type="button"
                  style="padding: 2px 8px; font-size: 12px"
                  (click)="openDocument(boarding.document_filename)"
                >
                  Download {{ boarding.document_filename }}
                </button>
              }
            </p>
          </div>
        }
      </div>
    }

    @if (reservation; as booking) {
      <div class="card">
        <h3>Hold baggage</h3>
        <div class="grid cols-3">
          <div class="field">
            <label for="bag-passenger">Passenger</label>
            <select id="bag-passenger" name="bag-passenger" [(ngModel)]="bagPassenger">
              @for (passenger of booking.passengers; track passenger.id) {
                <option [ngValue]="passenger.id">
                  {{ passenger.first_name }} {{ passenger.last_name }}
                </option>
              }
            </select>
          </div>
          <div class="field">
            <label for="bag-weight">Weight (kg)</label>
            <input
              id="bag-weight"
              name="bag-weight"
              type="number"
              min="1"
              max="60"
              [(ngModel)]="bagWeight"
            />
          </div>
          <div class="field" style="align-self: end">
            <button class="btn gold" type="button" [disabled]="busy" (click)="addBag()">
              Add bag
            </button>
          </div>
        </div>
        <p class="muted" style="font-size: 12px">
          €25 per hold bag, plus €15 per kg above the 23 kg allowance.
        </p>

        @if (bags.length) {
          <table>
            <thead>
              <tr>
                <th>Bag tag</th>
                <th>Weight</th>
                <th>Fee</th>
              </tr>
            </thead>
            <tbody>
              @for (bag of bags; track bag.bag_tag) {
                <tr>
                  <td><code>{{ bag.bag_tag }}</code></td>
                  <td>{{ bag.weight_kg }} kg</td>
                  <td>€{{ bag.fee_eur.toFixed(2) }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    }
  `,
})
export class CheckinPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);

  readonly formatTime = formatTime;

  reservations: Reservation[] = [];
  pnr = '';
  reservation: Reservation | null = null;
  selected: number[] = [];
  boardingPasses: BoardingPass[] = [];
  bags: BagReceipt[] = [];
  bagPassenger: number | null = null;
  bagWeight = '20';
  busy = false;
  error: string | null = null;
  needsLogin = false;

  async ngOnInit(): Promise<void> {
    try {
      this.reservations = await this.api.get<Reservation[]>('/api/checkin/reservations');
      this.pnr = this.pnr || this.reservations[0]?.pnr || '';
    } catch (err) {
      this.report(err);
    }
  }

  sequenceLabel(sequence: number): string {
    return String(sequence).padStart(4, '0');
  }

  onKnownSelected(code: string): void {
    this.pnr = code;
    void this.loadReservation(code);
  }

  async loadReservation(code: string): Promise<void> {
    if (!code) return;
    this.busy = true;
    this.error = null;
    try {
      const found = await this.api.get<Reservation>(
        `/api/checkin/${code.toUpperCase()}/passengers`,
      );
      this.reservation = found;
      this.selected = found.passengers.map((p) => p.id);
      this.bagPassenger = found.passengers[0]?.id ?? null;
      this.boardingPasses = [];
      this.bags = [];
    } catch (err) {
      this.reservation = null;
      this.report(err);
    } finally {
      this.busy = false;
    }
  }

  toggle(id: number): void {
    this.selected = this.selected.includes(id)
      ? this.selected.filter((value) => value !== id)
      : [...this.selected, id];
  }

  async checkIn(): Promise<void> {
    if (!this.reservation) return;
    this.busy = true;
    this.error = null;
    try {
      const result = await this.api.post<{ pnr: string; boarding_passes: BoardingPass[] }>(
        `/api/checkin/${this.reservation.pnr}`,
        { passenger_ids: this.selected },
      );
      this.reservation = await this.api.get<Reservation>(
        `/api/checkin/${this.reservation.pnr}/passengers`,
      );
      this.boardingPasses = result.boarding_passes;
    } catch (err) {
      this.report(err);
    } finally {
      this.busy = false;
    }
  }

  async addBag(): Promise<void> {
    if (!this.reservation || this.bagPassenger === null) return;
    this.busy = true;
    this.error = null;
    try {
      const receipt = await this.api.post<BagReceipt>(`/api/checkin/${this.reservation.pnr}/bags`, {
        passenger_id: this.bagPassenger,
        weight_kg: Number(this.bagWeight),
      });
      this.bags = [...this.bags, receipt];
    } catch (err) {
      this.report(err);
    } finally {
      this.busy = false;
    }
  }

  /** The document endpoint needs the bearer token, so fetch it and hand back a blob URL. */
  async openDocument(filename: string): Promise<void> {
    try {
      const token = this.session.getToken();
      const response = await fetch(`/api/checkin/documents/${filename}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) {
        throw new ApiError(`Document unavailable (${response.status})`, response.status, null);
      }
      const url = URL.createObjectURL(await response.blob());
      window.open(url, '_blank', 'noopener');
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      this.report(err);
    }
  }

  private report(err: unknown): void {
    if (err instanceof ApiError && err.status === 401) {
      this.needsLogin = true;
      this.error = null;
      return;
    }
    this.error = err instanceof Error ? err.message : String(err);
  }
}
