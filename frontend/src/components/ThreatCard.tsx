import { ArrowUpRight, CircleDot, MapPin, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { Threat } from '../lib/api'
import { dateTime, featureLabel } from '../lib/format'
import { Pill, StatusPill } from './ui'

export function ThreatCard({ threat, onOpen }: { threat: Threat; onOpen?: (id: string) => void }) {
  const tone = threat.visual.tone || 'sage'
  return (
    <article className={`threat tone-${tone}`}>
      <div className="threat-bar" aria-hidden="true" />
      <div className="threat-body">
        <div className="threat-head">
          <div>
            <div className="row tight" style={{ marginBottom: 5 }}>
              {threat.visual.level === 'critical' ? (
                <>
                  <span className="pulse-dot" />
                  <span className="tiny" style={{ letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--red)' }}>
                    Critical · confirmed
                  </span>
                </>
              ) : (
                <span className="tiny" style={{ letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
                  {threat.visual.level} concern
                </span>
              )}
              {threat.isDemo ? <Pill tone="neutral" className="small">Demo record</Pill> : null}
            </div>
            <div className="threat-title">{threat.title}</div>
          </div>
          <StatusPill status={threat.status} />
        </div>

        <div className="threat-meta">
          <span>
            <MapPin size={13} /> {threat.fieldName || 'Unassigned'}
          </span>
          <span>
            <TriangleAlert size={13} /> {featureLabel(threat.feature)}
          </span>
          <span>
            <CircleDot size={13} /> {threat.visual.statusLabel}
          </span>
          <span>{dateTime(threat.createdAt)}</span>
        </div>

        <div className="row between" style={{ marginTop: 12, gap: 14, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div className="row between tiny muted">
              <span>Evidence quality</span>
              <span>{Math.round(threat.visual.evidenceQuality * 100)}% of automated checks</span>
            </div>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${Math.round(threat.visual.evidenceQuality * 100)}%`,
                  background: threat.visual.evidenceQuality > 0.8 ? 'var(--sage-deep)' : undefined,
                }}
              />
            </div>
            <div className="tiny muted" style={{ marginTop: 8 }}>
              <ShieldCheck size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              {threat.evidenceGaps.length} open evidence gap{threat.evidenceGaps.length === 1 ? '' : 's'} ·{' '}
              {threat.visual.isConfirmed ? 'confirmed by review' : 'not confirmed'}
            </div>
          </div>
          {onOpen ? (
            <button className="btn tiny ghost" onClick={() => onOpen(threat.id)}>
              Review <ArrowUpRight size={13} />
            </button>
          ) : null}
        </div>

        {threat.nextAction ? (
          <div className="note" style={{ marginTop: 10 }}>
            {threat.nextAction}
          </div>
        ) : null}
      </div>
    </article>
  )
}

export function ThreatLegend() {
  return (
    <div className="legend">
      <span><i style={{ background: 'var(--slate-green)' }} />Slate green · low</span>
      <span><i style={{ background: 'var(--amber)' }} />Amber · caution</span>
      <span><i style={{ background: 'var(--orange)' }} />Orange · elevated</span>
      <span><i style={{ background: 'var(--red)' }} />Red · urgent</span>
    </div>
  )
}
