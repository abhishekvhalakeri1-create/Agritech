import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Info,
  Layers,
  Minus,
  Scale,
  ShieldQuestion,
  TrendingDown,
} from 'lucide-react'
import type { Debt, DebtHistory } from '../lib/api'
import { useApi } from '../lib/hooks'
import { relativeTime } from '../lib/format'
import { Pill } from './ui'
import { DebtTrend } from './DebtTrend'

const TONE_HEX: Record<string, string> = {
  sage: '#5c7a5d',
  amber: '#c58f2c',
  orange: '#c9642a',
  red: '#ab3a2c',
}

function Gauge({ score, tone, size = 168 }: { score: number; tone: string; size?: number }) {
  const radius = size / 2 - 13
  const circumference = 2 * Math.PI * radius
  const arc = circumference * 0.75
  const progress = Math.max(0, Math.min(100, score)) / 100
  const colour = TONE_HEX[tone] ?? TONE_HEX.sage
  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(31,61,43,.1)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
          transform={`rotate(135 ${size / 2} ${size / 2})`}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colour}
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${arc * progress} ${circumference}`}
          transform={`rotate(135 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 700ms cubic-bezier(.22,.61,.36,1)' }}
        />
        {[0, 25, 50, 75, 100].map((tick) => {
          const angle = (135 + (tick / 100) * 270) * (Math.PI / 180)
          const inner = radius - 14
          const outer = radius - 19
          return (
            <line
              key={tick}
              x1={size / 2 + Math.cos(angle) * inner}
              y1={size / 2 + Math.sin(angle) * inner}
              x2={size / 2 + Math.cos(angle) * outer}
              y2={size / 2 + Math.sin(angle) * outer}
              stroke="rgba(31,61,43,.22)"
              strokeWidth="1.5"
            />
          )
        })}
      </svg>
      <div className="gauge-centre">
        <span className="gauge-score" style={{ color: colour }}>
          {score}
        </span>
        <span className="gauge-of">out of 100</span>
      </div>
    </div>
  )
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="debt-term">
      <div className="cap">{label}</div>
      <div className="num" style={{ fontSize: '1.15rem' }}>
        {value}
      </div>
      {hint ? <div className="math">{hint}</div> : null}
    </div>
  )
}

export function EvidenceDebtMeter({
  debt,
  compact = false,
  trend = false,
  defaultExpanded = false,
  showLedgerLink = true,
  onOpenObservation,
}: {
  debt: Debt
  compact?: boolean
  trend?: boolean
  defaultExpanded?: boolean
  showLedgerLink?: boolean
  onOpenObservation?: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const history = useApi<DebtHistory>(trend ? '/evidence-debt/history?limit=60' : null)
  const tone = debt.band.tone as string
  const maxFeatureDebt = useMemo(() => Math.max(1, ...debt.byFeature.map((f) => f.debt)), [debt])
  const maxFieldDebt = useMemo(() => Math.max(1, ...(debt.byField ?? []).map((f) => f.debt)), [debt])

  const open = (id: string) => {
    if (!id) return
    if (onOpenObservation) onOpenObservation(id)
    else window.location.assign(`/observations?open=${encodeURIComponent(id)}`)
  }

  const ageing = debt.ageing
  const stale = debt.counts?.gapsStale ?? 0

  return (
    <section className={`card debt-card ${compact ? 'tight' : ''}`} aria-label="Evidence Debt Meter">
      <div className="debt-top">
        <Gauge score={debt.score} tone={tone} size={compact ? 132 : 168} />
        <div className="debt-copy">
          <div className="row tight" style={{ marginBottom: 6 }}>
            <Pill tone={debt.band.tone}>{debt.band.label}</Pill>
            <span className="tiny muted" style={{ letterSpacing: '.08em', textTransform: 'uppercase' }}>
              Evidence Debt Meter
            </span>
            {stale > 0 ? (
              <Pill tone="amber" className="small">
                <Clock3 size={11} /> {stale} stale
              </Pill>
            ) : null}
          </div>
          <h3 style={{ marginBottom: 8 }}>
            <Scale size={20} style={{ color: 'var(--sage-deep)' }} />
            {debt.score === 0 ? 'Evidence complete' : 'Unresolved evidence is holding warnings back'}
          </h3>
          <p style={{ fontSize: '.95rem' }}>{debt.explanation}</p>

          <div className="debt-terms">
            <div className="debt-term">
              <div className="cap">Unresolved evidence gaps</div>
              <div className="num">{debt.components.unresolvedGaps}</div>
              <div className="math">
                × {debt.components.gapWeight} = <strong>{debt.components.gapTerm}</strong>
              </div>
            </div>
            <div className="debt-term">
              <div className="cap">Unverified / conflicting</div>
              <div className="num">{debt.components.unresolvedObservations}</div>
              <div className="math">
                × {debt.components.observationWeight} = <strong>{debt.components.observationTerm}</strong>
              </div>
            </div>
          </div>

          <div className="row between" style={{ marginTop: 12, gap: 10, flexWrap: 'wrap' }}>
            <span className="debt-formula">{debt.formula}</span>
            <div className="row tight">
              {showLedgerLink ? (
                <Link to="/evidence" className="btn tiny ghost">
                  <Layers size={13} /> Full ledger
                </Link>
              ) : null}
              <button className="btn tiny ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {expanded ? 'Hide breakdown' : 'Open breakdown'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="debt-terms" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <MiniStat
          label="Oldest open gap"
          value={`${ageing.oldestGapDays}d`}
          hint={`stale after ${ageing.staleThresholdHours}h`}
        />
        <MiniStat
          label="Gaps closed to date"
          value={String(debt.counts?.gapsResolved ?? 0)}
          hint={`${debt.counts?.gapsTotal ?? 0} raised in total`}
        />
        <MiniStat
          label="Average resolution"
          value={ageing.averageResolutionHours === null ? '—' : `${ageing.averageResolutionHours}h`}
          hint={`${ageing.resolvedSampleSize} resolved sample${ageing.resolvedSampleSize === 1 ? '' : 's'}`}
        />
      </div>

      {trend && history.data ? (
        <div style={{ marginTop: 16, borderTop: '1px dashed var(--hairline-strong)', paddingTop: 14 }}>
          <div className="row between" style={{ marginBottom: 4 }}>
            <h4 style={{ fontSize: '.98rem' }}>
              <TrendingDown size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Debt over the past week
            </h4>
            <Link to="/evidence" className="tiny">
              inspect <ArrowRight size={11} style={{ verticalAlign: '-1px' }} />
            </Link>
          </div>
          <DebtTrend history={history.data} height={128} />
        </div>
      ) : null}

      {expanded ? (
        <div className="debt-detail">
          <div className="split-even" style={{ gap: 22 }}>
            <div>
              <h4 style={{ marginBottom: 10 }}>
                <ShieldQuestion size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                Outstanding evidence
              </h4>
              {debt.unresolvedGapList.length === 0 ? (
                <p className="small muted">No open evidence gaps on any observation.</p>
              ) : (
                debt.unresolvedGapList.slice(0, 8).map((gap) => (
                  <div className={`gap-chip ${gap.severity} ${gap.stale ? 'stale' : ''}`} key={gap.gapId}>
                    <div style={{ minWidth: 0 }}>
                      <div className="gap-title">{gap.description}</div>
                      <div className="gap-detail">
                        {gap.observationTitle} · {gap.fieldName} · open {gap.ageDays}d
                        {gap.stale ? ' · stale' : ''}
                      </div>
                    </div>
                    <div className="gap-actions">
                      <button className="btn tiny ghost" onClick={() => open(gap.observationId)}>
                        Open <ArrowRight size={12} />
                      </button>
                    </div>
                  </div>
                ))
              )}
              {debt.unresolvedGapList.length > 8 ? (
                <p className="tiny muted" style={{ marginTop: 8 }}>
                  +{debt.unresolvedGapList.length - 8} more gaps in the{' '}
                  <Link to="/evidence">evidence ledger</Link>.
                </p>
              ) : null}

              <h4 style={{ margin: '20px 0 8px' }}>Debt by feature</h4>
              {debt.byFeature.map((feature) => (
                <div className="breakdown-row" key={feature.feature}>
                  <div>
                    <div className="row between">
                      <span>{feature.label}</span>
                      <span className="tiny muted">
                        {feature.unresolvedGaps} gap{feature.unresolvedGaps === 1 ? '' : 's'}
                      </span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(feature.debt / maxFeatureDebt) * 100}%` }} />
                    </div>
                  </div>
                  <span className="mono small" style={{ textAlign: 'right' }}>
                    {feature.debt}
                  </span>
                </div>
              ))}

              <h4 style={{ margin: '18px 0 8px' }}>Debt by field</h4>
              {(debt.byField ?? []).map((field) => (
                <div className="breakdown-row" key={field.fieldId ?? 'unassigned'}>
                  <div>
                    <div className="row between">
                      <span>{field.fieldName}</span>
                      <span className="tiny muted">
                        {field.unresolvedGaps} gap · {field.unresolvedObservations} open
                      </span>
                    </div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{
                          width: `${(field.debt / maxFieldDebt) * 100}%`,
                          background: 'linear-gradient(90deg, var(--sage) 0%, var(--amber) 100%)',
                        }}
                      />
                    </div>
                  </div>
                  <span className="mono small" style={{ textAlign: 'right' }}>
                    {field.debt}
                  </span>
                </div>
              ))}
            </div>

            <div>
              <h4 style={{ marginBottom: 10 }}>
                <Info size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                Why these observations count
              </h4>
              <div style={{ maxHeight: 240, overflowY: 'auto', paddingRight: 4 }}>
                {debt.observations
                  .filter((observation) => observation.contribution > 0)
                  .map((observation) => (
                    <button
                      key={observation.id}
                      className="action-item"
                      onClick={() => open(observation.id)}
                      style={{ padding: '10px 12px' }}
                    >
                      <span className="action-icon sage" style={{ width: 28, height: 28 }}>
                        +{observation.contribution}
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="feed-title" style={{ display: 'block' }}>
                          {observation.title}
                        </span>
                        <span className="feed-detail">
                          {observation.fieldName} · {observation.unresolvedGaps} gap
                          {observation.unresolvedGaps === 1 ? '' : 's'} · {observation.status.replace(/_/g, ' ')}
                        </span>
                      </span>
                    </button>
                  ))}
                {debt.observations.every((observation) => observation.contribution === 0) ? (
                  <p className="small muted">
                    Nothing contributes to the score — every observation is either verified or resolved.
                  </p>
                ) : null}
              </div>

              <h4 style={{ margin: '18px 0 8px' }}>If the next gaps were closed</h4>
              <div className="chip-row">
                {(debt.forecast ?? []).slice(0, 4).map((step) => (
                  <Pill key={step.resolved} tone={step.resolved === 0 ? 'neutral' : 'sage'} className="small">
                    {step.resolved === 0 ? 'now' : `−${step.resolved} gap${step.resolved === 1 ? '' : 's'}`}: {step.score}
                  </Pill>
                ))}
              </div>
              {debt.forecast?.length ? (
                <p className="tiny muted" style={{ marginTop: 6 }}>
                  The observation term only clears when a review decision moves a record out of the unresolved
                  bucket.
                </p>
              ) : null}

              <h4 style={{ margin: '18px 0 8px' }}>Recommended next actions</h4>
              {debt.recommendedActions.length === 0 ? (
                <p className="small muted">No action required. Keep logging observations.</p>
              ) : (
                debt.recommendedActions.map((action) => (
                  <button key={action.label} className="action-item" onClick={() => open(action.observationId)}>
                    <span className="action-icon">
                      <Minus size={15} />
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="feed-title" style={{ display: 'block' }}>
                        {action.label}
                      </span>
                      <span className="feed-detail">{action.detail}</span>
                    </span>
                  </button>
                ))
              )}

              <div className="note">
                Resolving a single evidence gap does not verify the observation. Verification requires a recorded
                human review after every gap is closed.
              </div>
            </div>
          </div>

          <div className="chip-row" style={{ marginTop: 16 }}>
            <Pill tone="sage">Verified {debt.counts.verified}</Pill>
            <Pill tone="amber">Needs review {debt.counts.needsReview}</Pill>
            <Pill tone="orange">Unverified {debt.counts.unverified}</Pill>
            <Pill tone="red">Conflicting {debt.counts.conflicting}</Pill>
            <Pill tone="amber">Inconclusive {debt.counts.inconclusive}</Pill>
            <Pill tone="neutral">Resolved {debt.counts.resolved}</Pill>
            <Pill tone="sage">Engine v{debt.engineVersion}</Pill>
          </div>

          {debt.recentlyResolved?.length ? (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 8 }}>Recently closed</h4>
              {debt.recentlyResolved.slice(0, 3).map((gap) => (
                <div className="row between small" key={gap.gapId} style={{ padding: '5px 0' }}>
                  <span className="row tight" style={{ minWidth: 0 }}>
                    <span className="pill sage small">closed</span>
                    <span>{gap.description}</span>
                  </span>
                  <span className="tiny muted nowrap">{relativeTime(gap.resolvedAt)}</span>
                </div>
              ))}
            </div>
          ) : null}

          <p className="tiny muted" style={{ marginTop: 14 }}>
            Computed {relativeTime(debt.computedAt)} from {debt.counts.totalObservations} observations.
          </p>
        </div>
      ) : null}
    </section>
  )
}
