import { useEffect, useState } from 'react'
import {
  BadgeCheck,
  Ban,
  CircleAlert,
  FileWarning,
  Gavel,
  History,
  Image as ImageIcon,
  Landmark,
  Radio,
  RotateCcw,
  Send,
  ShieldCheck,
  Waves,
} from 'lucide-react'
import { api, type Observation } from '../lib/api'
import { dateTime, featureLabel, percent, relativeTime, statusMeta, syncMeta } from '../lib/format'
import { Banner, CheckList, Drawer, Pill, Spinner, StatusPill, useApp } from './ui'

export function ObservationDrawer({
  observationId,
  onClose,
  onChanged,
}: {
  observationId: string | null
  onClose: () => void
  onChanged?: () => void
}) {
  const { push, bump } = useApp()
  const [observation, setObservation] = useState<Observation | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [reviewNote, setReviewNote] = useState('')

  const load = async (id: string) => {
    setLoading(true)
    try {
      const result = await api.get<Observation>(`/observations/${id}`)
      setObservation(result)
    } catch (error) {
      push(error instanceof Error ? error.message : 'Could not load the observation.', 'red')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (observationId) {
      void load(observationId)
      setNote('')
      setReviewNote('')
    } else {
      setObservation(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observationId])

  const resolveGap = async (gapId: string, resolved: boolean) => {
    if (!observation) return
    setBusy(gapId)
    try {
      const result = await api.post<{ observation: Observation }>(
        `/observations/${observation.id}/evidence-gaps/${gapId}/resolve`,
        { resolved, note: note || (resolved ? 'Evidence attached by the reviewer.' : 'Re-opened for review.'), resolvedBy: 'Hemish (field review)' },
      )
      setObservation((current) => (current ? { ...current, ...result.observation } : current))
      push(resolved ? 'Evidence gap resolved. The observation is still awaiting review.' : 'Gap re-opened.')
      setNote('')
      onChanged?.()
      bump()
    } catch (error) {
      push(error instanceof Error ? error.message : 'Could not update the gap.', 'red')
    } finally {
      setBusy(null)
    }
  }

  const review = async (decision: string) => {
    if (!observation) return
    setBusy(decision)
    try {
      const result = await api.post<{ observation: Observation }>(`/observations/${observation.id}/review`, {
        decision,
        note: reviewNote || 'Recorded from the FIELDZY observation review panel.',
        reviewer: 'Hemish (field review)',
      })
      setObservation((current) => (current ? { ...current, ...result.observation } : current))
      push(
        decision === 'verify'
          ? 'Review recorded — observation verified.'
          : decision === 'resolve'
            ? 'Observation closed out as resolved.'
            : decision === 'flag_conflict'
            ? 'Observation flagged as conflicting.'
            : decision === 'reject'
              ? 'Observation closed as inconclusive.'
              : 'Evidence requested; observation stays open.',
        decision === 'verify' ? 'forest' : 'amber',
      )
      setReviewNote('')
      onChanged?.()
      bump()
    } catch (error) {
      push(error instanceof Error ? error.message : 'Could not record the review.', 'red')
    } finally {
      setBusy(null)
    }
  }

  const openGaps = observation?.evidenceGaps?.filter((gap) => !gap.resolved) ?? []
  const resolvedGaps = observation?.evidenceGaps?.filter((gap) => gap.resolved) ?? []
  const sync = syncMeta(observation?.syncStatus)

  return (
    <Drawer
      open={Boolean(observationId)}
      onClose={onClose}
      title={observation?.title ?? 'Observation'}
      subtitle={
        observation ? (
          <span className="row tight" style={{ marginTop: 2 }}>
            <span>{observation.id}</span>
            <span>·</span>
            <span>{observation.fieldName || 'Unassigned'}</span>
            <span>·</span>
            <span>{featureLabel(observation.feature)}</span>
          </span>
        ) : null
      }
    >
      {loading && !observation ? (
        <div className="row">
          <Spinner /> Loading observation…
        </div>
      ) : observation ? (
        <>
          <div className="row tight" style={{ marginBottom: 14 }}>
            <StatusPill status={observation.status} />
            <Pill tone={sync.tone}>{sync.label}</Pill>
            {observation.confidence !== null ? <Pill tone="outline">Confidence {percent(observation.confidence)}</Pill> : null}
            {observation.isDemo ? <Pill tone="neutral">Demo record</Pill> : null}
          </div>

          <p style={{ fontSize: '.95rem' }}>{observation.description}</p>

          {observation.validation ? (
            <Banner tone={observation.status === 'conflicting' ? 'red' : observation.status === 'verified' ? 'forest' : 'amber'} icon={<CircleAlert size={17} />}>
              <strong>Evidence engine verdict:</strong> {observation.validation.summary}
              <div style={{ marginTop: 6 }}>
                {observation.validation.checksPassed}/{observation.validation.checksTotal} automated checks passed · {observation.evidenceGaps.filter((g) => !g.resolved).length} open gap(s) · engine v
                {observation.validation.engineVersion}
              </div>
            </Banner>
          ) : null}

          <div style={{ marginTop: 12 }}>
            <div className="note">
              <strong>Next action:</strong> {observation.nextAction}
            </div>
          </div>

          <div className="section" style={{ marginTop: 22 }}>
            <h4 style={{ marginBottom: 10 }}>
              <FileWarning size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Evidence gaps ({openGaps.length} open)
            </h4>
            {observation.evidenceGaps.length === 0 ? (
              <p className="small muted">No gaps were raised for this report.</p>
            ) : (
              <>
                {openGaps.map((gap) => (
                  <div className={`gap-chip ${gap.severity}`} key={gap.id}>
                    <div style={{ minWidth: 0 }}>
                      <div className="gap-title">{gap.description}</div>
                      <div className="gap-detail">{gap.detail}</div>
                      <div className="row tight" style={{ marginTop: 8 }}>
                        <input
                          type="text"
                          placeholder="What did you check or attach?"
                          value={note}
                          onChange={(event) => setNote(event.target.value)}
                          style={{ fontSize: '.85rem', padding: '6px 9px' }}
                          aria-label={`Resolution note for ${gap.description}`}
                        />
                        <button className="btn tiny" onClick={() => resolveGap(gap.id, true)} disabled={busy === gap.id}>
                          {busy === gap.id ? <Spinner /> : <BadgeCheck size={13} />} Resolve
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {resolvedGaps.map((gap) => (
                  <div className="gap-chip resolved" key={gap.id}>
                    <div style={{ minWidth: 0 }}>
                      <div className="gap-title">{gap.description}</div>
                      <div className="gap-detail">
                        {gap.resolutionNote} · {gap.resolvedBy} · {relativeTime(gap.resolvedAt)}
                      </div>
                    </div>
                    <div className="gap-actions">
                      <button className="btn tiny ghost" onClick={() => resolveGap(gap.id, false)} disabled={busy === gap.id}>
                        <RotateCcw size={12} /> Re-open
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
            <div className="note">
              Resolving every gap still does not verify the observation — the status only moves to “needs review”
              until a person records a decision below.
            </div>
          </div>

          <div className="section" style={{ marginTop: 22 }}>
            <h4 style={{ marginBottom: 10 }}>
              <Gavel size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Human review
            </h4>
            <textarea
              placeholder="Reviewer note — what did you confirm in the field?"
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
            />
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn small primary" onClick={() => review('verify')} disabled={busy !== null || openGaps.length > 0}>
                <BadgeCheck size={14} /> Verify
              </button>
              <button className="btn small ghost" onClick={() => review('resolve')} disabled={busy !== null || openGaps.length > 0}>
                <ShieldCheck size={14} /> Mark resolved
              </button>
              <button className="btn small ghost" onClick={() => review('request_evidence')} disabled={busy !== null}>
                <Send size={14} /> Request evidence
              </button>
              <button className="btn small ghost" onClick={() => review('flag_conflict')} disabled={busy !== null}>
                <CircleAlert size={14} /> Flag conflict
              </button>
              <button className="btn small danger" onClick={() => review('reject')} disabled={busy !== null}>
                <Ban size={14} /> Mark inconclusive
              </button>
            </div>
            {openGaps.length > 0 ? (
              <div className="tiny muted" style={{ marginTop: 8 }}>
                Verification is blocked while {openGaps.length} evidence gap(s) remain open.
              </div>
            ) : null}
          </div>

          <div className="section" style={{ marginTop: 22 }}>
            <h4 style={{ marginBottom: 10 }}>Automated evidence checks</h4>
            <CheckList checks={observation.qualityChecks ?? observation.validation?.checks ?? []} />
          </div>

          {observation.evidence && Object.keys(observation.evidence).length ? (
            <div className="section" style={{ marginTop: 22 }}>
              <h4 style={{ marginBottom: 10 }}>Evidence attached</h4>
              <div className="stack tight">
                {(observation.evidence.images ?? []).map((image: any, index: number) => (
                  <div className="row tight small" key={`${image.fileName}-${index}`}>
                    <ImageIcon size={14} />
                    <span>{image.fileName ?? 'image'}</span>
                    {image.quality?.summary ? <span className="muted">· {image.quality.summary}</span> : null}
                  </div>
                ))}
                {(observation.evidence.readings ?? []).map((reading: any, index: number) => (
                  <div className="row tight small" key={`${reading.label}-${index}`}>
                    <Landmark size={14} />
                    <span>
                      {reading.label}: {reading.value} {reading.unit}
                      {reading.simulated ? ' (simulated)' : ''}
                    </span>
                  </div>
                ))}
                {observation.evidence.audio ? (
                  <div className="row tight small">
                    <Waves size={14} />
                    <span>
                      Audio {observation.evidence.audio.durationSec}s · clarity{' '}
                      {Math.round((observation.evidence.audio.clarityScore ?? 0) * 100)}% · not retained
                    </span>
                  </div>
                ) : null}
                {(observation.evidence.independentSources ?? []).length ? (
                  <div className="small">
                    <strong>Corroboration:</strong>{' '}
                    {(observation.evidence.independentSources ?? []).join('; ')}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {observation.modelResult && Object.keys(observation.modelResult).length ? (
            <div className="section" style={{ marginTop: 22 }}>
              <h4 style={{ marginBottom: 10 }}>
                <Radio size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                Model output
              </h4>
              <dl className="kv">
                <dt>Engine</dt>
                <dd>{observation.modelResult.engine ?? '—'}</dd>
                <dt>Trained model</dt>
                <dd>{observation.modelResult.isTrainedModel ? 'Yes' : 'No — screening rules'}</dd>
                <dt>Prediction</dt>
                <dd>{observation.modelResult.label ?? observation.modelResult.predictedClass ?? '—'}</dd>
                <dt>Confidence</dt>
                <dd>{observation.confidence !== null ? percent(observation.confidence) : 'not reported'}</dd>
              </dl>
            </div>
          ) : null}

          <div className="section" style={{ marginTop: 22 }}>
            <h4 style={{ marginBottom: 10 }}>
              <History size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Review history
            </h4>
            <div className="timeline">
              {(observation.reviewHistory ?? []).map((entry) => (
                <div
                  className={`timeline-item ${entry.status === 'verified' ? 'verified' : entry.status === 'conflicting' ? 'conflict' : ''}`}
                  key={entry.id}
                >
                  <div className="row between" style={{ alignItems: 'baseline' }}>
                    <strong style={{ fontSize: '.92rem' }}>{entry.decision.replace(/_/g, ' ')}</strong>
                    <span className="tiny muted">{dateTime(entry.at)}</span>
                  </div>
                  <div className="small muted">{entry.note}</div>
                  <div className="tiny muted">{entry.reviewer}</div>
                </div>
              ))}
            </div>
          </div>

          {observation.transmissions?.length ? (
            <div className="section" style={{ marginTop: 22 }}>
              <h4 style={{ marginBottom: 10 }}>Transmission trail</h4>
              {observation.transmissions.map((transmission) => {
                const meta = syncMeta(transmission.state)
                return (
                  <div className="feed-item" key={transmission.id}>
                    <span className={`feed-icon ${meta.tone === 'red' ? 'red' : meta.tone === 'amber' ? 'amber' : ''}`}>
                      <Send size={13} />
                    </span>
                    <span>
                      <span className="feed-title">{transmission.event}</span>
                      <span className="feed-detail">{transmission.detail}</span>
                    </span>
                    <span className="feed-time">{relativeTime(transmission.createdAt)}</span>
                  </div>
                )
              })}
            </div>
          ) : null}

          <div className="tiny muted" style={{ marginTop: 22 }}>
            Status: {statusMeta(observation.status).label} · Created {dateTime(observation.createdAt)} · Updated{' '}
            {dateTime(observation.updatedAt)}
          </div>
        </>
      ) : (
        <p className="muted">Observation unavailable.</p>
      )}
    </Drawer>
  )
}
