import { api } from './api'

export type IncidentStatus = 'open' | 'mitigated' | 'resolved'
export type TimelineKind = 'detect' | 'note' | 'mitigation' | 'escalation' | 'resolve'

export interface TimelineEntry {
  id: number
  ts: string
  kind: TimelineKind | string
  message: string
  author: string
}

export interface Incident {
  id: number
  reference: string
  title: string
  severity: number
  status: IncidentStatus | string
  service: string
  summary: string
  commander: string | null
  started_at: string
  resolved_at: string | null
  timeline: TimelineEntry[]
  slo_impact: string | null
  runbook: string | null
  resolution: string | null
  alert_name: string | null
  duration_minutes: number | null
  response_expectation: string | null
}

export interface Alert {
  name: string
  severity: number
  service: string
  state: 'firing' | 'pending' | 'resolved'
  since: string
  summary: string
  runbook: string | null
}

export const STATUSES: IncidentStatus[] = ['open', 'mitigated', 'resolved']

export const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  mitigated: 'Mitigated',
  resolved: 'Resolved',
}

export const TIMELINE_KINDS: TimelineKind[] = [
  'note',
  'mitigation',
  'escalation',
  'detect',
  'resolve',
]

export function severityClass(severity: number): string {
  if (severity <= 1) return 'badge crit'
  if (severity === 2) return 'badge warn'
  return 'badge'
}

export function statusClass(status: string): string {
  if (status === 'resolved') return 'badge ok'
  if (status === 'mitigated') return 'badge warn'
  return 'badge crit'
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null || minutes === undefined) return '—'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 24) return `${hours}h ${rest}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function formatTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

export function sinceLabel(iso: string): string {
  const started = new Date(iso).getTime()
  if (Number.isNaN(started)) return iso
  return formatDuration(Math.max(0, Math.round((Date.now() - started) / 60000)))
}

export function listIncidents(query = ''): Promise<Incident[]> {
  return api<Incident[]>(`/api/incidents${query}`)
}

export function getIncident(id: string | number): Promise<Incident> {
  return api<Incident>(`/api/incidents/${id}`)
}

export function listAlerts(): Promise<Alert[]> {
  return api<Alert[]>('/api/incidents/alerts')
}

export function runbookUrl(runbook: string | null): string | null {
  if (!runbook) return null
  return `https://github.com/cogdeasy/iberia/blob/main/${runbook}`
}
