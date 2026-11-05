import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Download,
  ExternalLink,
  Filter,
  Gauge,
  Layers,
  RefreshCw,
  Search,
  ShieldQuestion,
  Sparkles,
  Timer,
  TrendingDown,
} from 'lucide-react'
import {
  api,
  type Debt,
  type DebtHistory,
  type DebtLedger,
  type Field,
  type Observation,
} from '../lib/api'
import { useApi } from '../lib/hooks'
import { dateTime, featureLabel, relativeTime, statusMeta } from '../lib/format'
import { DebtTrend } from '../components/DebtTrend'
import { EvidenceDebtMeter } from '../components/EvidenceDebtMeter'
import { ObservationDrawer } from '../components/ObservationDrawer'
import { Banner, Card, Empty, LoadingBlock, Modal, Pill, SectionHead, Spinner, useApp } from '../components/ui'

const BUCKETS = [
  { key: 'under_12h', label: '< 12 h', tone: 'var(--sage)' },
  { key: '12h_to_48h', label: '12–48 h', tone: 'var(--amber)' },
  { key: '2_to_7_days', label: '2–7 days', tone: 'var(--orange)' },
  { key: 'over_7_days', label: '> 7 days', tone: 'var(--red)' },
]

export default function Evidence() {
  const { refreshKey, bump, push } = useApp()
  const debt = useApi<Debt>(`/evidence-debt?v=${refreshKey}`, { cacheKey: 'debt' })
  const history = useApi<DebtHistory>(`/evidence-debt/history?limit=80&v=${refreshKey}`)
  const fields = useApi<{ fields: Field[] }>(`/fields?v=${refreshKey}`, { cacheKey: 'fields' })

  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open')
  const [severity, setSeverity] = useState('')
  const [fieldId, setFieldId] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [resolving, setResolving] = useState<{ gapId: string; observationId: string; label: string } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [openObservation, setOpenObservation] = useState<string | null>(null)

  const ledger = useApi<DebtLedger>(
    `/evidence-debt/ledger?status=${status}${severity ? `&severity=${severity}` : ''}${
      fieldId ? `&fieldId=${fieldId}` : ''
    }&v=${refreshKey}`,
  )

  useEffect(() => {
    setSelected([])
  }, [status])

  const gaps = ledger.data?.gaps ?? []
  const filtered = useMemo(
    () =>
      gaps.filter((gap) =>
        query
          ? `${gap.description} ${gap.observationTitle} ${gap.fieldName} ${gap.code}`
              .toLowerCase()
              .includes(query.toLowerCase())
          : true,
      ),
    [gaps, query],
  )

  const components = debt.data?.components
  const projected = useMemo(() => {
    if (!components) return null
    const remaining = Math.max(0, components.unresolvedGaps - selected.length)
    return Math.min(100, remaining * components.gapWeight + components.unresolvedObservations * components.observationWeight)
  }, [components, selected])

  const refreshAll = () => {
    debt.refresh()
    history.refresh()
    ledger.refresh()
    bump()
  }

  const resolveGap = async () => {
    if (!resolving) return
    setBusy(true)
    try {
      const result = await api.post<{ observation: Observation; debt: Debt }>(
        `/observations/${resolving.observationId}/evidence-gaps/${resolving.gapId}/resolve`,
        { resolved: true, note: note || 'Evidence attached and checked by the reviewer.', resolvedBy: 'Hemish (field review)' },
      )
      push(
        `Gap closed. Evidence debt is now ${result.debt.score} — the observation still awaits review.`,
        'forest',
      )
      setResolving(null)
      setNote('')
      refreshAll()
    } catch (error) {
      push(error instanceof Error ? error.message : 'Could not resolve the gap.', 'red')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (gapId: string) => {
    setSelected((current) =>
      current.includes(gapId) ? current.filter((id) => id !== gapId) : [...current, gapId],
    )
  }

  const ageing = debt.data?.ageing
  const maxBucket = Math.max(1, ...BUCKETS.map((bucket) => ageing?.buckets[bucket.key] ?? 0))

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">FIELDZY · Evidence ledger</div>
          <h1>Evidence debt</h1>
          <p className="page-sub">
            The full record behind the meter: every gap, how long it has been open, which field it belongs to, and
            what closing it would change. FIELDZY only communicates a warning with its evidence status attached.
          </p>
        </div>
        <div className="btn-row">
          <a className="btn ghost" href="/api/evidence-debt/ledger.csv?status=all" download>
            <Download size={15} /> Export CSV
          </a>
          <button className="btn ghost" onClick={refreshAll}>
            <RefreshCw size={15} /> Refresh
          </button>
          <Link to="/observations?filter=debt" className="btn primary">
            <Layers size={15} /> Debt observations
          </Link>
        </div>
      </header>

      {debt.data ? (
        <EvidenceDebtMeter debt={debt.data} trend defaultExpanded={false} showLedgerLink={false} onOpenObservation={setOpenObservation} />
      ) : (
        <Card>
          <LoadingBlock lines={5} />
        </Card>
      )}

      <div className="grid grid-3 section">
        <Card>
          <div className="card-head">
            <div>
              <h3>Ageing</h3>
              <p className="card-sub">How long the outstanding evidence has waited.</p>
            </div>
            <span className={`card-icon ${(ageing?.buckets.over_7_days ?? 0) > 0 ? 'red' : 'amber'}`}>
              <CalendarClock size={16} />
            </span>
          </div>
          {ageing ? (
            <>
              <div className="stack tight">
                {BUCKETS.map((bucket) => {
                  const value = ageing.buckets[bucket.key] ?? 0
                  return (
                    <div className="breakdown-row" key={bucket.key}>
                      <div>
                        <div className="row between">
                          <span>{bucket.label}</span>
                          <span className="tiny muted">{value} gap{value === 1 ? '' : 's'}</span>
                        </div>
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{ width: `${(value / maxBucket) * 100}%`, background: bucket.tone }}
                          />
                        </div>
                      </div>
                      <span className="mono small" style={{ textAlign: 'right' }}>
                        {value}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="divider" />
              <dl className="kv">
                <dt>Oldest open gap</dt>
                <dd>{ageing.oldestGapDays} days ({ageing.oldestGapHours} h)</dd>
                <dt>Stale threshold</dt>
                <dd>{ageing.staleThresholdHours} h</dd>
                <dt>Average resolution</dt>
                <dd>
                  {ageing.averageResolutionHours === null ? 'no closures yet' : `${ageing.averageResolutionHours} h`}
                </dd>
              </dl>
            </>
          ) : (
            <LoadingBlock lines={4} />
          )}
        </Card>

        <Card>
          <div className="card-head">
            <div>
              <h3>What closing gaps would do</h3>
              <p className="card-sub">Straight from the live formula, not an estimate.</p>
            </div>
            <span className="card-icon">
              <TrendingDown size={16} />
            </span>
          </div>
          {debt.data ? (
            <>
              <div className="stack tight">
                {debt.data.forecast.slice(0, 5).map((step) => (
                  <div className="row between small" key={step.resolved}>
                    <span>
                      {step.resolved === 0 ? 'Current score' : `Close ${step.resolved} gap${step.resolved === 1 ? '' : 's'}`}
                    </span>
                    <span className="row tight">
                      <span className="tiny muted">
                        {step.resolved === 0 ? '' : `−${debt.data!.forecast[step.resolved - 1].score - step.score}`}
                      </span>
                      <strong className="mono">{step.score}</strong>
                    </span>
                  </div>
                ))}
              </div>
              <div className="note">
                Closing gaps only reduces the first term. The {debt.data.components.unresolvedObservations}{' '}
                unresolved observations (worth {debt.data.components.observationTerm}) clear when a review decision
                moves them to verified or resolved.
              </div>
            </>
          ) : (
            <LoadingBlock lines={4} />
          )}
        </Card>

        <Card>
          <div className="card-head">
            <div>
              <h3>Debt by field</h3>
              <p className="card-sub">Where the uncertainty actually sits.</p>
            </div>
            <span className="card-icon amber">
              <Gauge size={16} />
            </span>
          </div>
          {debt.data?.byField?.length ? (
            <div className="stack tight">
              {debt.data.byField.map((field) => (
                <div key={field.fieldId ?? 'unassigned'}>
                  <div className="row between small">
                    <span>{field.fieldName}</span>
                    <span className="mono">{field.debt}</span>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${Math.min(100, field.debt)}%` }}
                    />
                  </div>
                  <div className="tiny muted" style={{ marginTop: 3 }}>
                    {field.unresolvedGaps} open gap{field.unresolvedGaps === 1 ? '' : 's'} ·{' '}
                    {field.unresolvedObservations} unresolved observation
                    {field.unresolvedObservations === 1 ? '' : 's'}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <LoadingBlock lines={3} />
          )}
        </Card>
      </div>

      <section className="section">
        <SectionHead
          title="Plan a reduction"
          hint="Projection only — nothing is written until you resolve a gap"
        />
        <Card>
          <div className="row between" style={{ alignItems: 'flex-start', gap: 18, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <p className="small" style={{ marginBottom: 10 }}>
                Tick gaps to preview the resulting score. Each gap is worth {components?.gapWeight ?? 15} points; the
                unresolved observations contribute {components?.observationTerm ?? 0} until they are reviewed.
              </p>
              <div className="row tight">
                <Pill tone="neutral">{selected.length} selected</Pill>
                <Pill tone={projected !== null && projected < (debt.data?.score ?? 0) ? 'sage' : 'neutral'}>
                  current {debt.data?.score ?? '—'} → projected {projected ?? '—'}
                </Pill>
                {selected.length ? (
                  <button className="btn tiny ghost" onClick={() => setSelected([])}>
                    Clear selection
                  </button>
                ) : null}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="stat-label">Projected score</div>
              <div style={{ fontSize: '2.4rem', fontWeight: 600, color: 'var(--forest)', lineHeight: 1.05 }}>
                {projected ?? '—'}
              </div>
              {debt.data && projected !== null ? (
                <div className="tiny muted">
                  {projected === debt.data.score
                    ? 'select gaps to see the effect'
                    : `${debt.data.score - projected} points lower`}
                </div>
              ) : null}
            </div>
          </div>

          <div className="divider" />
          {ledger.data?.gaps.length ? (
            <div className="stack tight">
              {ledger.data.gaps
                .filter((gap) => !gap.resolved)
                .slice(0, 6)
                .map((gap) => (
                  <label
                    key={gap.gapId}
                    className="row between"
                    style={{ gap: 12, padding: '8px 10px', border: '1px solid var(--hairline)', borderRadius: 10 }}
                  >
                    <span className="row tight" style={{ minWidth: 0 }}>
                      <input
                        type="checkbox"
                        checked={selected.includes(gap.gapId)}
                        onChange={() => toggle(gap.gapId)}
                        style={{ width: 16, height: 16 }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span className="feed-title" style={{ display: 'block' }}>
                          {gap.description}
                        </span>
                        <span className="feed-detail">
                          {gap.observationTitle} · {gap.fieldName} · open {gap.ageDays}d
                          {gap.stale ? ' · stale' : ''}
                        </span>
                      </span>
                    </span>
                    <span className="row tight">
                      <Pill tone={gap.severity === 'high' ? 'red' : gap.severity === 'medium' ? 'amber' : 'sage'} className="small">
                        {gap.severity}
                      </Pill>
                      <button
                        className="btn tiny ghost"
                        onClick={(event) => {
                          event.preventDefault()
                          setResolving({
                            gapId: gap.gapId,
                            observationId: gap.observationId,
                            label: `${gap.description} — ${gap.observationTitle}`,
                          })
                        }}
                      >
                        Resolve
                      </button>
                    </span>
                  </label>
                ))}
            </div>
          ) : (
            <p className="small muted">No open gaps to plan against.</p>
          )}
        </Card>
      </section>

      <section className="section">
        <SectionHead
          title="Gap ledger"
          hint={ledger.data ? `${ledger.data.count} gap(s) · ${ledger.data.staleCount} stale` : undefined}
          action={
            <div className="row tight">
              <div className="tab-row">
                {(['open', 'resolved', 'all'] as const).map((value) => (
                  <button
                    key={value}
                    className={`tab ${status === value ? 'active' : ''}`}
                    onClick={() => setStatus(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          }
        />

        <Card className="flush">
          <div className="row" style={{ padding: '14px 16px', gap: 10, borderBottom: '1px solid var(--hairline)' }}>
            <label className="field" style={{ flex: 1, minWidth: 200 }}>
              <span className="sr-only">Search gaps</span>
              <span className="row tight" style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: 12, color: 'var(--ink-muted)' }} />
                <input
                  type="search"
                  placeholder="Search gap, observation or field…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  style={{ paddingLeft: 32, fontSize: '.9rem' }}
                />
              </span>
            </label>
            <select value={severity} onChange={(event) => setSeverity(event.target.value)} style={{ maxWidth: 150 }} aria-label="Severity">
              <option value="">All severities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select value={fieldId} onChange={(event) => setFieldId(event.target.value)} style={{ maxWidth: 220 }} aria-label="Field">
              <option value="">All fields</option>
              {(fields.data?.fields ?? []).map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
            <Filter size={15} className="muted" />
          </div>

          {ledger.loading && !ledger.data ? (
            <div style={{ padding: 20 }}>
              <LoadingBlock lines={6} />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: 20 }}>
              <Empty title="No gaps match these filters">
                Try “all”, or clear the severity and field filters.
              </Empty>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Evidence gap</th>
                    <th>Observation</th>
                    <th>Field</th>
                    <th>Severity</th>
                    <th>Age</th>
                    <th>{status === 'resolved' ? 'Closed' : 'Status'}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((gap) => (
                    <tr key={gap.gapId}>
                      <td style={{ maxWidth: 300 }}>
                        <strong>{gap.description}</strong>
                        <div className="tiny muted">{gap.code}</div>
                      </td>
                      <td style={{ maxWidth: 260 }}>
                        <button
                          className="feed-title"
                          style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }}
                          onClick={() => setOpenObservation(gap.observationId)}
                        >
                          {gap.observationTitle}
                        </button>
                        <div className="tiny muted">
                          {featureLabel(gap.feature)} · {statusMeta(gap.observationStatus).label}
                        </div>
                      </td>
                      <td>{gap.fieldName}</td>
                      <td>
                        <Pill
                          tone={gap.severity === 'high' ? 'red' : gap.severity === 'medium' ? 'amber' : 'sage'}
                          className="small"
                        >
                          {gap.severity}
                        </Pill>
                      </td>
                      <td className="nowrap">
                        <span className={`tiny ${gap.stale ? '' : 'muted'}`} style={gap.stale ? { color: 'var(--orange)' } : undefined}>
                          {gap.stale ? <Timer size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} /> : null}
                          {gap.ageDays}d ({Math.round(gap.ageHours ?? 0)}h)
                        </span>
                      </td>
                      <td>
                        {gap.resolved ? (
                          <span className="tiny">
                            <BadgeCheck size={12} style={{ verticalAlign: '-2px', color: 'var(--sage-deep)' }} />{' '}
                            {relativeTime(gap.resolvedAt)}
                            <div className="tiny muted">{gap.resolvedBy}</div>
                          </span>
                        ) : gap.stale ? (
                          <Pill tone="orange" className="small">
                            stale
                          </Pill>
                        ) : (
                          <Pill tone="amber" className="small">
                            open
                          </Pill>
                        )}
                      </td>
                      <td>
                        <div className="row tight">
                          {!gap.resolved ? (
                            <button
                              className="btn tiny ghost"
                              onClick={() =>
                                setResolving({
                                  gapId: gap.gapId,
                                  observationId: gap.observationId,
                                  label: `${gap.description} — ${gap.observationTitle}`,
                                })
                              }
                            >
                              Resolve
                            </button>
                          ) : null}
                          <button className="btn tiny ghost" onClick={() => setOpenObservation(gap.observationId)}>
                            Open <ArrowRight size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <section className="section">
        <SectionHead title="How the score is built" hint="One formula, three consumers" />
        <div className="split-even">
          <Card>
            <div className="card-head">
              <div>
                <h3>The formula</h3>
                <p className="card-sub">Implemented once in `evidence_engine.score_from_counts`.</p>
              </div>
              <span className="card-icon">
                <Sparkles size={16} />
              </span>
            </div>
            <div className="debt-formula" style={{ fontSize: '.9rem', padding: '10px 14px', display: 'block' }}>
              min(100, unresolved evidence gaps × 15 + unverified observations × 10)
            </div>
            <ul className="small" style={{ paddingLeft: 16, marginTop: 12, color: 'var(--ink-soft)' }}>
              <li>One gap row = 15 points, counted exactly once, however many observations reference it.</li>
              <li>One unverified, needs-review, conflicting or inconclusive observation = 10 points.</li>
              <li>Verified and resolved observations contribute nothing at all.</li>
              <li>The same function powers the live meter, the recorded snapshots and the historical replay.</li>
            </ul>
            <div className="note">
              There is no hidden multiplier and no randomness: the same database always produces the same score.
            </div>
          </Card>

          <Card>
            <div className="card-head">
              <div>
                <h3>The review gate</h3>
                <p className="card-sub">Why the second term does not fall on its own.</p>
              </div>
              <span className="card-icon amber">
                <ShieldQuestion size={16} />
              </span>
            </div>
            <div className="timeline">
              {[
                'Observation recorded with its evidence',
                'Automated checks run — gaps raised, verdict capped at “needs review”',
                'Each gap resolved individually by a person with a note',
                'Human review recorded: verify, resolve, reject or flag conflict',
                'Only then does the observation leave the unresolved bucket',
              ].map((step, index) => (
                <div className="timeline-item" key={step}>
                  <div className="row tight">
                    <Pill tone="neutral" className="small">
                      {index + 1}
                    </Pill>
                    <span className="small">{step}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="row tight" style={{ marginTop: 10 }}>
              <Link to="/observations?filter=debt" className="btn tiny ghost">
                <ExternalLink size={12} /> Open the observations
              </Link>
              {history.data ? (
                <span className="tiny muted">history recomputed {relativeTime(history.data.computedAt)}</span>
              ) : null}
            </div>
          </Card>
        </div>

        {history.data ? (
          <Card style={{ marginTop: 18 }}>
            <div className="card-head">
              <div>
                <h3>Recorded and reconstructed history</h3>
                <p className="card-sub">{history.data.explanation}</p>
              </div>
              <span className="card-icon">
                <TrendingDown size={16} />
              </span>
            </div>
            <DebtTrend history={history.data} height={190} />
            <div className="row between" style={{ marginTop: 10 }}>
              <span className="tiny muted">
                {history.data.recorded.length} recorded snapshot(s) · {history.data.reconstructed.length} replayed
                point(s)
              </span>
              <span className="tiny muted">last computed {dateTime(history.data.computedAt)}</span>
            </div>
          </Card>
        ) : null}

        <div style={{ marginTop: 18 }}>
          <Banner tone="forest">
            <strong>What this meter is not.</strong> It does not measure crop risk or disease severity — it measures how
            much of FIELDZY's own evidence is still unverified. A high score is not a bad field; it is a queue of
            unfinished checking.
          </Banner>
        </div>
      </section>

      <Modal
        open={Boolean(resolving)}
        title="Resolve this evidence gap"
        onClose={() => {
          setResolving(null)
          setNote('')
        }}
        footer={
          <div className="btn-row">
            <button className="btn primary" onClick={resolveGap} disabled={busy}>
              {busy ? <Spinner light /> : null} Close gap
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setResolving(null)
                setNote('')
              }}
            >
              Cancel
            </button>
          </div>
        }
      >
        <p className="small">{resolving?.label}</p>
        <label className="field">
          <span>What did you check or attach?</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Hand probe reading taken at three points; photographs filed with the observation."
          />
        </label>
        <div className="note">
          Closing this gap removes 15 points from the meter. The observation itself stays “needs review” until a
          review decision is recorded — the two steps are deliberately separate.
        </div>
      </Modal>

      <ObservationDrawer observationId={openObservation} onClose={() => setOpenObservation(null)} onChanged={refreshAll} />
    </div>
  )
}
