import type { Tone } from './api'

export const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  verified: { label: 'Verified', tone: 'sage' },
  needs_review: { label: 'Needs review', tone: 'amber' },
  unverified: { label: 'Unverified', tone: 'orange' },
  conflicting: { label: 'Conflicting', tone: 'red' },
  inconclusive: { label: 'Inconclusive', tone: 'amber' },
  resolved: { label: 'Resolved', tone: 'neutral' },
}

export function statusMeta(status?: string | null) {
  if (!status) return { label: 'Unknown', tone: 'neutral' as Tone }
  return STATUS_META[status] ?? { label: status.replace(/_/g, ' '), tone: 'neutral' as Tone }
}

export const FEATURE_LABEL: Record<string, string> = {
  plant_disease: 'Plant Disease Detection',
  soil_moisture: 'Soil Moisture',
  acoustic_intelligence: 'Acoustic Intelligence',
  threat_monitoring: 'Threat Monitoring',
  manual_observation: 'Manual Observation',
  sensor: 'Sensor',
  weather: 'Weather',
}

export function featureLabel(feature?: string | null) {
  if (!feature) return 'Observation'
  return FEATURE_LABEL[feature] ?? feature.replace(/_/g, ' ')
}

export function relativeTime(iso?: string | null) {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  const minutes = Math.round(diff / 60000)
  if (Math.abs(minutes) < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export function dateTime(iso?: string | null) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function percent(value?: number | null, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

export function toneForScore(score: number): Tone {
  if (score <= 25) return 'sage'
  if (score <= 50) return 'amber'
  if (score <= 75) return 'orange'
  return 'red'
}

export function syncMeta(state?: string) {
  switch (state) {
    case 'synced':
      return { label: 'Delivered', tone: 'sage' as Tone }
    case 'queued':
      return { label: 'Queued', tone: 'amber' as Tone }
    case 'retrying':
      return { label: 'Retrying', tone: 'amber' as Tone }
    case 'failed':
      return { label: 'Failed', tone: 'red' as Tone }
    default:
      return { label: 'Local only', tone: 'neutral' as Tone }
  }
}

export function observationSummary(observation: { modelResult?: Record<string, any> | null } | null | undefined) {
  const result = observation?.modelResult
  if (!result) return null
  const label = result.label || result.predictedClass
  if (!label) return null
  return typeof result.confidence === 'number' ? `${label} · ${percent(result.confidence)}` : label
}
