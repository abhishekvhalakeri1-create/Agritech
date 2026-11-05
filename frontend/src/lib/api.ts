/* FIELDZY API client + offline-aware helpers. */

export type Tone = 'sage' | 'amber' | 'orange' | 'red' | 'neutral' | 'forest' | 'outline'

export interface EvidenceGap {
  id: string
  code: string
  description: string
  detail?: string
  severity: 'high' | 'medium' | 'low'
  resolved: boolean
  resolvedAt?: string | null
  resolvedBy?: string | null
  resolutionNote?: string
  createdAt?: string
}

export interface EvidenceCheck {
  key: string
  label: string
  passed: boolean
  detail: string
}

export interface Validation {
  engineVersion: string
  feature: string
  featureLabel: string
  status: string
  confidence: number | null
  confidenceThreshold: number
  checks: EvidenceCheck[]
  checksPassed: number
  checksTotal: number
  evidenceGaps: EvidenceGap[]
  unresolvedGapCount: number
  requiresHumanReview: boolean
  summary: string
  nextAction: string
  debtContribution: { gapWeight: number; observationWeight: number }
  validatedAt: string
  reviewedAt?: string
  reviewedBy?: string
}

export interface ReviewEntry {
  id: string
  decision: string
  status: string
  note: string
  reviewer: string
  at: string
}

export interface Observation {
  id: string
  fieldId: string | null
  fieldName: string
  title: string
  description: string
  category: string
  feature: string
  status: string
  syncStatus: string
  severity: string | null
  confidence: number | null
  modelResult: Record<string, any> | null
  validation: Validation | null
  evidence: Record<string, any> | null
  evidenceGaps: EvidenceGap[]
  reviewStage: string
  qualityChecks: EvidenceCheck[]
  reviewHistory: ReviewEntry[]
  nextAction: string
  isDemo: boolean
  createdAt: string
  updatedAt: string
  transmissions?: Transmission[]
}

export interface Field {
  id: string
  name: string
  crop: string
  areaHa: number
  status: string
  location: string
  latitude: number | null
  longitude: number | null
  soilThresholdLow: number
  soilThresholdCritical: number
  notes: string
  createdAt: string
  updatedAt: string
  observationCount: number
  unresolvedCount: number
  openGaps: number
  latestObservation: Observation | null
  openWarnings: Observation[]
  openWarningCount: number
}

export interface DebtGap {
  gapId: string
  code: string
  description: string
  detail?: string
  severity: 'high' | 'medium' | 'low'
  resolved: boolean
  resolvedAt?: string | null
  resolvedBy?: string | null
  resolutionNote?: string
  createdAt: string
  ageHours: number | null
  ageBucket: string
  ageDays: number | null
  stale: boolean
  resolutionHours: number | null
  observationId: string
  observationTitle: string
  observationStatus?: string | null
  observationFeature?: string
  feature: string
  fieldId: string | null
  fieldName: string
}

export interface DebtAgeing {
  oldestGapHours: number
  oldestGapDays: number
  staleThresholdHours: number
  buckets: Record<string, number>
  averageResolutionHours: number | null
  resolvedSampleSize: number
}

export interface DebtFieldBucket {
  fieldId: string | null
  fieldName: string
  observations: number
  unresolvedObservations: number
  unresolvedGaps: number
  debt: number
}

export interface DebtTerm {
  id: string
  observationId: string
  title: string
  fieldName: string
  feature: string
  status: string
  unresolvedGaps: number
  contribution: number
}

export interface Debt {
  score: number
  band: { key: string; label: string; tone: Tone }
  formula: string
  components: {
    unresolvedGaps: number
    gapWeight: number
    gapTerm: number
    unresolvedObservations: number
    observationWeight: number
    observationTerm: number
    rawScore: number
    capped: boolean
  }
  counts: Record<string, number>
  unresolvedGapList: DebtGap[]
  recentlyResolved: DebtGap[]
  ageing: DebtAgeing
  byField: DebtFieldBucket[]
  forecast: Array<{ resolved: number; score: number }>
  byFeature: Array<{ feature: string; label: string; observations: number; unresolvedGaps: number; debt: number }>
  byGapCode: Array<{ code: string; description: string; count: number; stale?: number }>
  observations: DebtTerm[]
  explanation: string
  recommendedActions: Array<{
    label: string
    detail: string
    observationId: string
    gapId: string
    impact?: number
    severity?: string
  }>
  computedAt: string
  engineVersion: string
}

export interface DebtHistoryPoint {
  at: string
  score: number
  unresolvedGaps: number
  unresolvedObservations: number
  source: 'recorded' | 'reconstructed' | 'live'
}

export interface DebtHistory {
  current: number
  series: DebtHistoryPoint[]
  recorded: DebtHistoryPoint[]
  reconstructed: DebtHistoryPoint[]
  delta24h: number
  min: number
  max: number
  points: number
  explanation: string
  computedAt: string
}

export interface DebtLedger {
  gaps: DebtGap[]
  count: number
  filters: { status: string; severity: string | null; fieldId: string | null; feature: string | null }
  debt: number
  staleCount: number
}

export interface DebtProjection {
  current: number
  projected: number
  delta: number
  requestedGapIds: string[]
  selectedGaps: string[]
  alreadyResolvedOrUnknown: string[]
  components: Debt['components']
  note: string
}

export interface Threat {
  id: string
  title: string
  fieldId: string | null
  fieldName: string
  feature: string
  category: string
  status: string
  severity: string | null
  confidence: number | null
  createdAt: string
  evidenceGaps: EvidenceGap[]
  nextAction: string
  isDemo: boolean
  visual: {
    level: string
    tone: Tone
    statusLabel: string
    evidenceQuality: number
    isConfirmed: boolean
  }
}

export interface Transmission {
  id: string
  observationId: string | null
  observationTitle: string | null
  event: string
  state: string
  detail: string
  createdAt: string
}

export interface AudioAnalysis {
  id: string
  fieldId: string | null
  fieldName: string
  source: string
  fileName: string
  durationSec: number
  predictedClass: string
  label: string
  confidence: number | null
  engine: string
  isTrainedModel: boolean
  clarityScore: number | null
  features: Record<string, any>
  topK: Array<{ label: string; confidence: number }>
  observationId: string | null
  observationStatus?: string | null
  observationTitle?: string | null
  createdAt: string
  envelope?: number[]
}

export interface AudioResult {
  engine: string
  isTrainedModel: boolean
  predictedClass: string
  label: string
  description: string
  confidence: number | null
  topK: Array<{ label: string; confidence: number }>
  threatRelevance: string
  threatCategory: string
  recommendedAction: string
  features: Record<string, any>
  clarityScore: number
  claritySummary: string
  durationSec: number
  source: string
  note: string
}

export interface PlantAnalysis {
  id: string
  fieldId: string | null
  fieldName: string
  fileName: string
  imagePath: string
  imageUrl?: string
  predictedClass: string
  label: string
  confidence: number | null
  engine: string
  isTrainedModel: boolean
  quality: { score: number; summary: string; issues: string[] }
  topK: Array<{ label: string; confidence: number }>
  observationId: string | null
  createdAt: string
  note?: string
}

export interface ModelStatus {
  plant: {
    trainedModelInstalled: boolean
    activeEngine: string
    isTrainedModel: boolean
    detail: string
    expectedModelPath: string
    expectedClassNamesPath: string
    labels?: string[]
  }
  audio: {
    trainedModelInstalled: boolean
    activeEngine: string
    detail: string
    labels: string[]
    labelSource: string
    classifierPath: string
  }
  summary: { provider: string; model: string; keyConfigured: boolean; activeSource: string }
  engineVersion: string
}

export interface Weather {
  available: boolean
  source: string
  attribution?: string
  cached?: boolean
  error?: string
  detail?: string
  fetchedAt: string
  fieldName?: string
  current?: {
    temperature: number | null
    apparentTemperature: number | null
    humidity: number | null
    windSpeed: number | null
    windDirection: number | null
    precipitation: number | null
    condition: string
    observedAt: string
  }
  rainProbabilityNext6h?: number | null
}

export interface SummaryResponse {
  available: boolean
  source: 'gemini' | 'local_rules'
  status: string
  model: string
  provider: string
  summary: string
  highlights: string[]
  notice: string
  error?: string
  generatedAt: string
  evidenceDebt?: { score: number; band: { label: string; tone: Tone } }
}

export interface Overview {
  stats: {
    totalFields: number
    activeSensors: number
    simulatedProbes: number
    threatsDetected: number
    threatsVerified: number
    unverifiedObservations: number
    observationsTotal: number
    verifiedObservations: number
    evidenceDebt: number
    evidenceDebtBand: { key: string; label: string; tone: Tone }
    audioAnalyses: number
    plantAnalyses: number
  }
  fields: Field[]
  debt: Debt
  priorityQueue: Array<{
    observationId: string
    title: string
    fieldName: string
    feature: string
    status: string
    severity: string | null
    reason: string
    action: string
    openGaps: number
    isDemo: boolean
    createdAt: string
  }>
  recentActivity: Array<{
    id: string
    kind: string
    title: string
    detail: string
    at: string
    state?: string
    observationId?: string
    tone: string
  }>
  threats: Threat[]
}

export interface SoilReading {
  id: string
  fieldId: string
  fieldName: string
  moisture: number
  thresholdLow: number
  thresholdCritical: number
  condition: string
  simulated: boolean
  observationId: string | null
  createdAt: string
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    try {
      const body = await response.json()
      message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body)
    } catch {
      /* keep default */
    }
    throw new ApiError(response.status, message)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string) => fetch(`/api${path}`, { headers: { Accept: 'application/json' } }).then((r) => parse<T>(r)),
  post: <T>(path: string, body?: unknown) =>
    fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then((r) => parse<T>(r)),
  patch: <T>(path: string, body: unknown) =>
    fetch(`/api${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => parse<T>(r)),
  del: <T>(path: string) => fetch(`/api${path}`, { method: 'DELETE' }).then((r) => parse<T>(r)),
  form: <T>(path: string, form: FormData) =>
    fetch(`/api${path}`, { method: 'POST', body: form }).then((r) => parse<T>(r)),
}

/* ------------------------------------------------------------------ offline */

const QUEUE_KEY = 'fieldzy.offline.queue.v1'
const CACHE_KEY = 'fieldzy.cache.v1'

export interface QueuedObservation {
  id: string
  createdAt: string
  payload: Record<string, unknown>
  attempts: number
  lastError?: string
}

export function readQueue(): QueuedObservation[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
  } catch {
    return []
  }
}

function writeQueue(queue: QueuedObservation[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  window.dispatchEvent(new Event('fieldzy:queue'))
}

export function enqueueObservation(payload: Record<string, unknown>): QueuedObservation {
  const item: QueuedObservation = {
    id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
    payload: { ...payload, syncStatus: 'pending_sync' },
    attempts: 0,
  }
  writeQueue([item, ...readQueue()])
  return item
}

export function removeQueued(id: string) {
  writeQueue(readQueue().filter((q) => q.id !== id))
}

/** Try to deliver everything stored locally while offline. */
export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  const queue = readQueue()
  if (!queue.length) return { sent: 0, failed: 0 }
  let sent = 0
  let failed = 0
  for (const item of queue) {
    try {
      const created = await api.post<Observation>('/observations', { ...item.payload, syncStatus: 'synced' })
      await api.post('/transmissions', {
        observationId: created.id,
        observationTitle: created.title,
        event: 'Queued observation delivered after reconnection',
        state: 'synced',
        detail: 'Server acknowledgement received; the local queue entry was cleared.',
      })
      removeQueued(item.id)
      sent += 1
    } catch (error) {
      failed += 1
      writeQueue(
        readQueue().map((q) =>
          q.id === item.id
            ? { ...q, attempts: q.attempts + 1, lastError: error instanceof Error ? error.message : 'unknown error' }
            : q,
        ),
      )
    }
  }
  return { sent, failed }
}

export function cacheSet(key: string, value: unknown) {
  try {
    localStorage.setItem(`${CACHE_KEY}.${key}`, JSON.stringify({ at: Date.now(), value }))
  } catch {
    /* storage full — caching is best effort */
  }
}

export function cacheGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY}.${key}`)
    if (!raw) return null
    return (JSON.parse(raw) as { value: T }).value
  } catch {
    return null
  }
}
