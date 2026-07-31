import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiService } from '../core/api.service';

interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
}

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

interface SearchResults {
  results: FlightOffer[];
  count: number;
  query_ms: number;
}

const CABINS = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium economy' },
  { value: 'business', label: 'Business' },
];

const SORTS = [
  { value: 'departure', label: 'Departure time' },
  { value: 'fare', label: 'Lowest fare' },
  { value: 'fare_desc', label: 'Highest fare' },
  { value: 'number', label: 'Flight number' },
];

@Component({
  selector: 'app-flights-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="hero">
      <h1>Find a flight</h1>
      <p>Live schedule, availability and cabin-adjusted fares across the Iberia network.</p>
    </section>

    @if (error) {
      <div class="error">{{ error }}</div>
    }

    <form class="card" (ngSubmit)="search()">
      <div class="grid cols-3">
        <div class="field">
          <label for="origin">From</label>
          <select id="origin" name="origin" [(ngModel)]="origin">
            <option value="">Any origin</option>
            @for (airport of airports; track airport.iata) {
              <option [value]="airport.iata">{{ airport.city }} ({{ airport.iata }})</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="destination">To</label>
          <select id="destination" name="destination" [(ngModel)]="destination">
            <option value="">Any destination</option>
            @for (airport of airports; track airport.iata) {
              <option [value]="airport.iata">{{ airport.city }} ({{ airport.iata }})</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="date">Departure date</label>
          <input id="date" name="date" type="date" [min]="today" [(ngModel)]="date" />
        </div>
        <div class="field">
          <label for="passengers">Passengers</label>
          <select id="passengers" name="passengers" [(ngModel)]="passengers">
            @for (n of passengerOptions; track n) {
              <option [ngValue]="n">{{ n }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="cabin">Cabin</label>
          <select id="cabin" name="cabin" [(ngModel)]="cabin">
            @for (option of cabins; track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label for="sort">Sort by</label>
          <select id="sort" name="sort" [(ngModel)]="sort">
            @for (option of sorts; track option.value) {
              <option [value]="option.value">{{ option.label }}</option>
            }
          </select>
        </div>
      </div>
      <button class="btn" type="submit" [disabled]="loading">
        {{ loading ? 'Searching…' : 'Search flights' }}
      </button>
    </form>

    <div class="grid cols-3">
      <div class="card">
        <div class="kpi-label">Offers found</div>
        <div class="kpi">{{ data?.count ?? '—' }}</div>
        <p class="muted">for {{ passengers }} passenger(s)</p>
      </div>
      <div class="card">
        <div class="kpi-label">Search latency</div>
        <div class="kpi">{{ data ? data.query_ms + ' ms' : '—' }}</div>
        <p class="muted">backend query time</p>
      </div>
      <div class="card">
        <div class="kpi-label">Cabin</div>
        <div class="kpi">{{ cabinLabel }}</div>
        <p class="muted">business ≈ 2.5× base fare</p>
      </div>
    </div>

    <div class="card">
      <h2>Results</h2>
      @if (!data?.results?.length) {
        <p class="muted">
          {{ loading ? 'Searching the schedule…' : 'No flights match this search.' }}
        </p>
      } @else {
        <table class="table">
          <thead>
            <tr>
              <th>Flight</th>
              <th>Route</th>
              <th>Departs</th>
              <th>Arrives</th>
              <th>Duration</th>
              <th>Seats</th>
              <th>Status</th>
              <th>Fare</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            @for (offer of data?.results ?? []; track offer.flight_id) {
              <tr>
                <td><strong>{{ offer.flight_number }}</strong></td>
                <td>{{ offer.origin }} → {{ offer.destination }}</td>
                <td>
                  {{ formatDate(offer.scheduled_departure) }}
                  {{ formatTime(offer.scheduled_departure) }}
                </td>
                <td>
                  {{ formatDate(offer.scheduled_arrival) }}
                  {{ formatTime(offer.scheduled_arrival) }}
                </td>
                <td>{{ formatDuration(offer.duration_minutes) }}</td>
                <td>{{ offer.seats_available }}</td>
                <td><span [class]="statusClass(offer.status)">{{ offer.status }}</span></td>
                <td><strong>€{{ offer.fare_eur.toFixed(2) }}</strong></td>
                <td>
                  <a class="btn" [routerLink]="['/book', offer.flight_id]">Select</a>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
})
export class FlightsPageComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly cabins = CABINS;
  readonly sorts = SORTS;
  readonly passengerOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  readonly today = new Date().toISOString().slice(0, 10);

  airports: Airport[] = [];
  origin = 'MAD';
  destination = 'BCN';
  date = '';
  passengers = 1;
  cabin = 'economy';
  sort = 'departure';
  data: SearchResults | null = null;
  loading = false;
  error: string | null = null;

  get cabinLabel(): string {
    return CABINS.find((option) => option.value === this.cabin)?.label ?? '';
  }

  async ngOnInit(): Promise<void> {
    this.api
      .get<Airport[]>('/api/flights/airports')
      .then((airports) => (this.airports = airports))
      .catch((err: Error) => (this.error = err.message));
    await this.search();
  }

  async search(): Promise<void> {
    this.loading = true;
    this.error = null;
    const params = new URLSearchParams({
      passengers: String(this.passengers),
      cabin: this.cabin,
      sort: this.sort,
    });
    if (this.origin) params.set('origin', this.origin);
    if (this.destination) params.set('destination', this.destination);
    if (this.date) params.set('date', this.date);

    try {
      this.data = await this.api.get<SearchResults>(`/api/flights/search?${params.toString()}`);
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Search failed';
      this.data = null;
    } finally {
      this.loading = false;
    }
  }

  formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short' });
  }

  formatDuration(minutes: number): string {
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  }

  statusClass(status: string): string {
    if (status === 'cancelled') return 'badge crit';
    if (status === 'delayed') return 'badge warn';
    return 'badge ok';
  }
}
