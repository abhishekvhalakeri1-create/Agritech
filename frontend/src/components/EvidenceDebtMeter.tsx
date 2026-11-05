import { useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronUp, Info, Minus, Scale, ShieldQuestion } from 'lucide-react'
import type { Debt } from '../lib/api'
import { featureLabel, relativeTime } from '../lib/format'
import { Pill } from './ui'

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
          const x1 = size / 2 + Math.cos(angle) * inner
          const y1 = size / 2 + Math.sin(angle) * inner
          const x2 = size / 2 + Math.cos(angle) * outer
          const y2 = size / 2 + Math.sin(angle) * outer
          return <line key={tick} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(31,61,43,.22)" strokeWidth="1.5" />
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

export function EvidenceDebtMeter({
  debt,
  compact = false,
  onOpenObservation,
}: {
  debt: Debt
  compact?: boolean
  onOpenObservation?: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const tone = debt.band.tone as string
  const maxFeatureDebt = useMemo(() => Math.max(1, ...debt.byFeature.map((f) => f.debt)), [debt])

  const open = (id: string) => {
    if (!id) return
    if (onOpenObservation) onOpenObservation(id)
    else window.location.assign(`/observations?open=${encodeURIComponent(id)}`)
  }

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

          <div className="row between" style={{ marginTop: 12 }}>
            <span className="debt-formula">{debt.formula}</span>
            <button className="btn tiny ghost" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {expanded ? 'Hide breakdown' : 'Open breakdown'}
            </button>
          </div>
        </div>
      </div>

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
                  <div className={`gap-chip ${gap.severity}`} key={gap.gapId}>
                    <div>
                      <div className="gap-title">{gap.description}</div>
                      <div className="gap-detail">
                        {gap.observationTitle} · {gap.fieldName} · {relativeTime(gap.createdAt)}
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
                  +{debt.unresolvedGapList.length - 8} more gaps across the observation list.
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
            <Pill tone="neutral">Verified {debt.counts.verified}</Pill>
            <Pill tone="amber">Needs review {debt.counts.needsReview}</Pill>
            <Pill tone="orange">Unverified {debt.counts.unverified}</Pill>
            <Pill tone="red">Conflicting {debt.counts.conflicting}</Pill>
            <Pill tone="amber">Inconclusive {debt.counts.inconclusive}</Pill>
            <Pill tone="sage">Engine v{debt.engineVersion}</Pill>
          </div>
        </div>
      ) : null}
    </section>
  )
}

export function DebtChip({ debt }: { debt: Debt }) {
  return (
    <Pill tone={debt.band.tone}>
      {featureLabel('') === '' ? '' : ''}
      Evidence debt {debt.score}
    </Pill>
  )
}
