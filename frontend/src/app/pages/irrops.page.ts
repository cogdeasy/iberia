import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ApiService } from '../core/api.service';

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

type DisruptionKind = 'delay' | 'cancellation' | 'diversion';

interface Disruption {
  id: number;
  flight: FlightOffer;
  kind: DisruptionKind;
  minutes: number;
  reason: string;
  affected_passengers: number;
  status: string;
  created_at: string;
}

interface RebookResult {
  pnr: string;
  rebooked_to: FlightOffer;
  compensation_eur: number;
}

interface Compensation {
  pnr: string;
  eligible: boolean;
  regulation: string;
  amount_eur: number;
  rationale: string;
}

const SEVERITY: Record<DisruptionKind, { label: string; badge: string }> = {
  delay: { label: 'Delay', badge: 'warn' },
  cancellation: { label: 'Cancellation', badge: 'crit' },
  diversion: { label: 'Diversion', badge: 'warn' },
};

function clock(value: string): string {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

@Component({
  selector: 'app-irrops-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="hero">
      <h1>Irregular operations</h1>
      <p>
        Disruption board, passenger rebooking and EU 261/2004 compensation for the day of
        operations.
      </p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }
    @if (notice) {
      <div class="notice">{{ notice }}</div>
    }

    <div class="grid cols-4">
      <div class="card">
        <div class="kpi-label">Open disruptions</div>
        <div class="kpi">{{ disruptions.length }}</div>
        <p class="muted">across the live schedule</p>
      </div>
      <div class="card">
        <div class="kpi-label">Cancellations</div>
        <div class="kpi">{{ cancellations }}</div>
        <p class="muted">full re-accommodation required</p>
      </div>
      <div class="card">
        <div class="kpi-label">Passengers affected</div>
        <div class="kpi">{{ affected }}</div>
        <p class="muted">sum of disrupted itineraries</p>
      </div>
      <div class="card">
        <div class="kpi-label">Worst delay</div>
        <div class="kpi">{{ worstDelay }} min</div>
        <p class="muted">EU261 threshold is 180 min</p>
      </div>
    </div>

    <div class="card">
      <h2>Disruption board</h2>
      <table class="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Flight</th>
            <th>Route</th>
            <th>Departure</th>
            <th>Severity</th>
            <th>Minutes</th>
            <th>Affected</th>
            <th>Reason</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (d of disruptions; track d.id) {
            <tr>
              <td>{{ d.id }}</td>
              <td>{{ d.flight.flight_number }}</td>
              <td>{{ d.flight.origin }} → {{ d.flight.destination }}</td>
              <td>{{ clock(d.flight.scheduled_departure) }}</td>
              <td>
                <span class="badge {{ severityBadge(d) }}">{{ severity[d.kind].label }}</span>
              </td>
              <td>{{ d.kind === 'cancellation' ? '—' : d.minutes }}</td>
              <td>{{ d.affected_passengers }}</td>
              <td class="muted">{{ d.reason }}</td>
              <td><span class="badge">{{ d.status }}</span></td>
              <td>
                <button class="btn ghost" type="button" (click)="selectForRebook(d)">Rebook</button>
              </td>
            </tr>
          }
          @if (!disruptions.length) {
            <tr>
              <td colspan="10" class="muted">No disruptions on the board.</td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    <div class="grid cols-3">
      <div class="card">
        <h3>Declare disruption</h3>
        <form (ngSubmit)="declare()">
          <div class="field">
            <label for="irrops-flight">Flight id</label>
            <input
              id="irrops-flight"
              name="irrops-flight"
              [(ngModel)]="flightId"
              placeholder="e.g. 1"
              required
            />
          </div>
          <div class="field">
            <label for="irrops-kind">Kind</label>
            <select id="irrops-kind" name="irrops-kind" [(ngModel)]="kind">
              <option value="delay">Delay</option>
              <option value="cancellation">Cancellation</option>
              <option value="diversion">Diversion</option>
            </select>
          </div>
          @if (kind !== 'cancellation') {
            <div class="field">
              <label for="irrops-minutes">Minutes</label>
              <input
                id="irrops-minutes"
                name="irrops-minutes"
                type="number"
                min="1"
                [(ngModel)]="minutes"
              />
            </div>
          }
          <div class="field">
            <label for="irrops-reason">Reason</label>
            <input
              id="irrops-reason"
              name="irrops-reason"
              [(ngModel)]="reason"
              placeholder="Inbound rotation late"
            />
          </div>
          <button class="btn" type="submit" [disabled]="busy">Declare</button>
        </form>
      </div>

      <div class="card">
        <h3>Rebook a PNR</h3>
        <form (ngSubmit)="rebook()">
          <div class="field">
            <label for="irrops-disruption">Disruption id</label>
            <input
              id="irrops-disruption"
              name="irrops-disruption"
              [(ngModel)]="rebookTarget"
              placeholder="select from the board"
              required
            />
          </div>
          <div class="field">
            <label for="irrops-pnr">PNR</label>
            <input
              id="irrops-pnr"
              name="irrops-pnr"
              [(ngModel)]="rebookPnr"
              placeholder="IB7QK2"
              required
            />
          </div>
          <button class="btn" type="submit" [disabled]="busy">
            Find next flight &amp; rebook
          </button>
        </form>
        @if (rebookResult; as result) {
          <div class="notice" style="margin-top: 12px">
            <strong>{{ result.pnr }}</strong> moved to {{ result.rebooked_to.flight_number }} ({{
              result.rebooked_to.origin
            }}
            → {{ result.rebooked_to.destination }}) departing
            {{ clock(result.rebooked_to.scheduled_departure) }}. Compensation exposure €{{
              result.compensation_eur.toFixed(0)
            }}.
          </div>
        }
      </div>

      <div class="card">
        <h3>EU261 compensation calculator</h3>
        <form (ngSubmit)="assess()">
          <div class="field">
            <label for="irrops-claim">PNR</label>
            <input
              id="irrops-claim"
              name="irrops-claim"
              [(ngModel)]="claimPnr"
              placeholder="IB3ZT9"
              required
            />
          </div>
          <button class="btn gold" type="submit" [disabled]="busy">Assess claim</button>
        </form>
        @if (claim; as assessment) {
          <div style="margin-top: 12px">
            <div class="kpi-label">{{ assessment.regulation }}</div>
            <div class="kpi">€{{ assessment.amount_eur.toFixed(0) }}</div>
            <span class="badge" [class.crit]="assessment.eligible" [class.ok]="!assessment.eligible">
              {{ assessment.eligible ? 'payable' : 'not eligible' }}
            </span>
            <p class="muted">{{ assessment.rationale }}</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class IrropsPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly severity = SEVERITY;
  readonly clock = clock;

  disruptions: Disruption[] = [];
  error: string | null = null;
  notice: string | null = null;
  busy = false;

  flightId = '';
  kind: DisruptionKind = 'delay';
  minutes = '180';
  reason = '';

  rebookPnr = '';
  rebookTarget = '';
  rebookResult: RebookResult | null = null;

  claimPnr = '';
  claim: Compensation | null = null;

  get affected(): number {
    return this.disruptions.reduce((sum, d) => sum + d.affected_passengers, 0);
  }

  get cancellations(): number {
    return this.disruptions.filter((d) => d.kind === 'cancellation').length;
  }

  get worstDelay(): number {
    return this.disruptions.reduce((max, d) => Math.max(max, d.minutes), 0);
  }

  ngOnInit(): void {
    void this.load();
  }

  severityBadge(disruption: Disruption): string {
    if (disruption.kind === 'cancellation') return 'crit';
    if (disruption.kind === 'delay' && disruption.minutes >= 180) return 'crit';
    return SEVERITY[disruption.kind].badge;
  }

  selectForRebook(disruption: Disruption): void {
    this.rebookTarget = String(disruption.id);
    this.notice = `Disruption ${disruption.id} selected for rebooking.`;
  }

  async load(): Promise<void> {
    try {
      this.disruptions = await this.api.get<Disruption[]>('/api/irrops/disruptions');
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    }
  }

  async declare(): Promise<void> {
    this.busy = true;
    this.error = null;
    this.notice = null;
    try {
      const created = await this.api.post<Disruption>('/api/irrops/disruptions', {
        flight_id: Number(this.flightId),
        kind: this.kind,
        minutes: this.kind === 'cancellation' ? 0 : Number(this.minutes),
        reason: this.reason,
      });
      this.notice = `Declared ${created.kind} on ${created.flight.flight_number} — ${created.affected_passengers} passengers affected.`;
      this.reason = '';
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  async rebook(): Promise<void> {
    this.busy = true;
    this.error = null;
    this.rebookResult = null;
    try {
      this.rebookResult = await this.api.post<RebookResult>(
        `/api/irrops/disruptions/${this.rebookTarget}/rebook`,
        { pnr: this.rebookPnr.trim().toUpperCase() },
      );
      await this.load();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  async assess(): Promise<void> {
    this.busy = true;
    this.error = null;
    this.claim = null;
    try {
      this.claim = await this.api.get<Compensation>(
        `/api/irrops/compensation/${this.claimPnr.trim().toUpperCase()}`,
      );
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }
}
