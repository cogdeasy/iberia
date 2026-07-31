import { Injectable, inject } from '@angular/core';

import { ApiService } from './api.service';

export interface SreService {
  name: string;
  tier: number;
  owner: string;
  endpoints: string[];
  health: 'healthy' | 'degraded' | 'down';
  version: string;
}

export interface SignalPoint {
  ts: string;
  rpm: number;
  error_rate: number;
  p95_ms: number;
}

export interface Signals {
  service: string;
  window_minutes: number;
  traffic_rpm: number;
  error_rate: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  saturation_pct: number;
  synthetic: boolean;
  series: SignalPoint[];
}

export type SloStatus = 'ok' | 'at_risk' | 'breached';

export interface Slo {
  id: string;
  service: string;
  name: string;
  kind: 'availability' | 'latency';
  objective_pct: number;
  window_days: number;
  current_pct: number;
  status: SloStatus;
  threshold_ms: number | null;
}

export interface ErrorBudget {
  slo_id: string;
  objective: number;
  achieved: number;
  budget_remaining_pct: number;
  burn_rate_1h: number;
  burn_rate_6h: number;
  status: SloStatus;
}

export type ChaosMode = 'latency' | 'error' | 'timeout' | 'slow_query' | 'saturation';

export interface ChaosToggle {
  target: string;
  mode: ChaosMode;
  magnitude: number;
  active: boolean;
  expires_at: string | null;
}

export type LoadScenario = 'steady' | 'checkout_rush' | 'search_storm';

export interface LoadResponse {
  status: string;
  scenario: LoadScenario;
  duration_seconds: number;
  rps: number;
  requests_planned: number;
}

export const CHAOS_MODES: ChaosMode[] = ['latency', 'error', 'timeout', 'slow_query', 'saturation'];
export const CHAOS_TARGETS = [
  'booking',
  'payments',
  'checkin',
  'flights',
  'notifications',
  'loyalty',
  'irrops',
];
export const LOAD_SCENARIOS: LoadScenario[] = ['steady', 'checkout_rush', 'search_storm'];

export const MODE_UNITS: Record<ChaosMode, string> = {
  latency: 'ms delay',
  error: '% of requests failed',
  timeout: 'ms before timeout',
  slow_query: 'ms added to queries',
  saturation: '% worker capacity',
};

export function healthBadge(health: SreService['health']): string {
  return health === 'healthy' ? 'ok' : health === 'degraded' ? 'warn' : 'crit';
}

export function statusBadge(status: SloStatus): string {
  return status === 'ok' ? 'ok' : status === 'at_risk' ? 'warn' : 'crit';
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function secondsUntil(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
}

@Injectable({ providedIn: 'root' })
export class SreApiService {
  private readonly api = inject(ApiService);

  listServices(): Promise<SreService[]> {
    return this.api.get<SreService[]>('/api/sre/services');
  }

  getSignals(service: string, windowMinutes: number): Promise<Signals> {
    return this.api.get<Signals>(
      `/api/sre/services/${encodeURIComponent(service)}/signals?window_minutes=${windowMinutes}`,
    );
  }

  listSlos(): Promise<Slo[]> {
    return this.api.get<Slo[]>('/api/sre/slos');
  }

  getErrorBudget(sloId: string): Promise<ErrorBudget> {
    return this.api.get<ErrorBudget>(`/api/sre/slos/${encodeURIComponent(sloId)}/error-budget`);
  }

  listChaos(): Promise<ChaosToggle[]> {
    return this.api.get<ChaosToggle[]>('/api/sre/chaos');
  }

  armChaos(body: {
    target: string;
    mode: ChaosMode;
    magnitude: number;
    ttl_seconds: number;
  }): Promise<ChaosToggle> {
    return this.api.post<ChaosToggle>('/api/sre/chaos', body);
  }

  stopChaos(target: string): Promise<{ status: string }> {
    return this.api.delete<{ status: string }>(`/api/sre/chaos/${encodeURIComponent(target)}`);
  }

  startLoad(body: {
    scenario: LoadScenario;
    duration_seconds: number;
    rps: number;
  }): Promise<LoadResponse> {
    return this.api.post<LoadResponse>('/api/sre/load', body);
  }
}
