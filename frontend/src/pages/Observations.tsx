import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  CircleAlert,
  Filter,
  ImagePlus,
  Plus,
  Scale,
  Search,
  ShieldQuestion,
  WifiOff,
} from 'lucide-react'
import {
  api,
  enqueueObservation,
  type Debt,
  type Field,
  type Observation,
} from '../lib/api'
import { useApi } from '../lib/hooks'
import { dateTime, featureLabel, percent, relativeTime, statusMeta, syncMeta } from '../lib/format'
import { ObservationDrawer } from '../components/ObservationDrawer'
import {
  Banner,
  Card,
  Empty,
  LoadingBlock,
  Modal,
  Pill,
  Spinner,
  StatusPill,
  useApp,
} from '../components/ui'

const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'debt', label: 'Contributing to debt' },
  { key: 'unverified', label: 'Unverified' },
  { key: 'needs_review', label: 'Needs review' },
  { key: 'conflicting', label: 'Conflicting' },
  { key: 'inconclusive', label: 'Inconclusive' },
  { key: 'verified', label: 'Verified' },
  { key: 'resolved', label: 'Resolved' },
]

export default function Observations() {
  const { refreshKey, bump, push, online } = useApp()
  const { data, loading, error, refresh } = useApi<{ observations: Observation[] }>(
    `/observations?v=${refreshKey}`,
    { cacheKey: 'observations' },
  )
  const debt = useApi<Debt>(`/evidence-debt?v=${refreshKey}`, { cacheKey: 'debt' })
  const fields = useApi<{ fields: Field[] }>(`/fields?v=${refreshKey}`, { cacheKey: 'fields' })
  const [params, setParams] = useSearchParams()

  const [tab, setTab] = useState('all')
  const [query, setQuery] = useState('')
  const [feature, setFeature] = useState('all')
  const [openId, setOpenId] = useState<string | null>(params.get('open'))
  const [formOpen, setFormOpen] = useState(params.get('new') === '1')
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    fieldId: params.get('field') ?? '',
    feature: 'manual_observation',
    title: '',
    description: '',
    severity: 'moderate',
    photo: true,
    independent: false,
    conflict: false,
    reading: '',
  })

  useEffect(() => {
    if (params.get('open')) setOpenId(params.get('open'))
    if (params.get('new') === '1') setFormOpen(true)
    if (params.get('filter')) setTab('debt')
  }, [params])

  useEffect(() => {
    if (params.get('field')) setForm((current) => ({ ...current, fieldId: params.get('field') ?? '' }))
  }, [params])

  const observations = data?.observations ?? []
  const contributing = useMemo(
    () => new Set((debt.data?.observations ?? []).filter((o) => o.contribution > 0).map((o) => o.id)),
    [debt.data],
  )

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: observations.length, debt: 0 }
    for (const observation of observations) {
      result[observation.status] = (result[observation.status] ?? 0) + 1
      if (contributing.has(observation.id)) result.debt += 1
    }
    return result
  }, [observations, contributing])

  const features = useMemo(() => {
    const set = new Set(observations.map((observation) => observation.feature))
    return ['all', ...Array.from(set)]
  }, [observations])

  const filtered = useMemo(() => {
    return observations.filter((observation) => {
      if (tab === 'debt' && !contributing.has(observation.id)) return false
      if (tab !== 'all' && tab !== 'debt' && observation.status !== tab) return false
      if (feature !== 'all' && observation.feature !== feature) return false
      if (query) {
        const haystack = `${observation.title} ${observation.fieldName} ${observation.id} ${observation.description}`.toLowerCase()
        if (!haystack.includes(query.toLowerCase())) return false
      }
      return true
    })
  }, [observations, tab, feature, query, contributing])

  const closeDrawer = () => {
    setOpenId(null)
    params.delete('open')
    setParams(params, { replace: true })
  }

  const submit = async () => {
    if (!form.title.trim()) {
      push('Give the observation a short title.', 'amber')
      return
    }
    setSaving(true)
    const payload = {
      fieldId: form.fieldId || null,
      feature: form.feature,
      category:
        form.feature === 'threat_monitoring'
          ? 'threat'
          : form.feature === 'soil_moisture'
            ? 'soil'
            : 'manual',
      title: form.title.trim(),
      description: form.description.trim(),
      severity: form.severity,
      evidence: {
        images: form.photo
          ? [
              {
                fileName: 'field-form-capture.jpg',
                quality: { score: 0.72, summary: 'Photograph attached from the field form' },
              },
            ]
          : [],
        readings: form.reading ? [{ label: 'Field reading', value: Number(form.reading), unit: 'unit' }] : [],
        independentConfirmations: form.independent ? 1 : 0,
        independentSources: form.independent ? ['Second observer / neighbour report'] : [],
        conflictingSignals: form.conflict ? ['A second report attributes this to a different cause'] : [],
      },
      modelResult: {},
      context: { capturedAt: new Date().toISOString() },
      syncStatus: online ? 'synced' : 'pending_sync',
    }

    try {
      if (!online) {
        enqueueObservation(payload)
        push('Saved on this device. It will be delivered when the server is reachable.', 'amber')
      } else {
        const created = await api.post<Observation>('/observations', payload)
        await api.post('/transmissions', {
          observationId: created.id,
          observationTitle: created.title,
          event: 'Observation created and validated',
          state: 'synced',
          detail: `${created.evidenceGaps.length} evidence gap(s) raised by the validation engine.`,
        })
        push(
          created.evidenceGaps.length
            ? `Observation saved with ${created.evidenceGaps.length} evidence gap(s) for review.`
            : 'Observation saved with complete evidence — awaiting human review.',
          created.evidenceGaps.length ? 'amber' : 'forest',
        )
      }
      setFormOpen(false)
      setForm({ ...form, title: '', description: '', reading: '' })
      bump()
      await Promise.all([refresh(), debt.refresh()])
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not save the observation.', 'red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">FIELDZY · Observation management</div>
          <h1>Observations</h1>
          <p className="page-sub">
            The shared information layer. Each record keeps its evidence, its gaps, its validation checks and the
            history of every review decision.
          </p>
        </div>
        <div className="btn-row">
          <button className="btn ghost" onClick={() => refresh()}>
            Refresh
          </button>
          <button className="btn primary" onClick={() => setFormOpen(true)}>
            <Plus size={16} /> New observation
          </button>
        </div>
      </header>

      {!online ? (
        <Banner tone="amber" icon={<WifiOff size={17} />}>
          You are offline. New observations are saved in this browser and queued; FIELDZY will only mark them delivered
          once the server confirms receipt.
        </Banner>
      ) : null}

      <div className="grid grid-3" style={{ marginTop: 18 }}>
        <Card className="tight">
          <div className="row between">
            <span className="stat-label">Observations on record</span>
            <Scale size={14} className="muted" />
          </div>
          <div className="stat-value">{observations.length}</div>
          <div className="stat-foot">{counts.verified ?? 0} verified by review</div>
        </Card>
        <Card className="tight">
          <div className="row between">
            <span className="stat-label">Contributing to debt</span>
            <ShieldQuestion size={14} className="muted" />
          </div>
          <div className="stat-value">{counts.debt ?? 0}</div>
          <div className="stat-foot">
            {debt.data ? `${debt.data.components.unresolvedGaps} open evidence gaps` : 'Loading debt breakdown'}
          </div>
        </Card>
        <Card className="tight">
          <div className="row between">
            <span className="stat-label">Evidence debt</span>
            <CircleAlert size={14} className="muted" />
          </div>
          <div className="stat-value" style={{ color: debt.data?.score === 0 ? 'var(--sage-deep)' : undefined }}>
            {debt.data?.score ?? '—'}
          </div>
          <div className="stat-foot">{debt.data?.band.label ?? 'Calculated from observation records'}</div>
        </Card>
      </div>

      {tab === 'debt' && debt.data ? (
        <div style={{ marginTop: 16 }}>
          <Banner tone="amber">
            <strong>Showing the {counts.debt} observations that keep the meter at {debt.data.score}.</strong>{' '}
            {debt.data.formula}. Resolving evidence gaps lowers the first term; only a recorded review can move an
            observation out of the second.
          </Banner>
        </div>
      ) : null}

      <div className="row between" style={{ marginTop: 22, gap: 12 }}>
        <div className="tab-row" role="tablist" aria-label="Filter by status">
          {STATUS_TABS.map((item) => (
            <button
              key={item.key}
              role="tab"
              aria-selected={tab === item.key}
              className={`tab ${tab === item.key ? 'active' : ''}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
              {counts[item.key] !== undefined ? <span className="tiny muted"> {counts[item.key]}</span> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="row" style={{ marginTop: 14, gap: 10 }}>
        <label className="field" style={{ flex: 1, minWidth: 220 }}>
          <span className="sr-only">Search observations</span>
          <span className="row tight" style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 11, top: 12, color: 'var(--ink-muted)' }} />
            <input
              type="search"
              placeholder="Search title, field or identifier…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={{ paddingLeft: 34 }}
            />
          </span>
        </label>
        <label className="field" style={{ minWidth: 210 }}>
          <span className="sr-only">Filter by feature</span>
          <span className="row tight">
            <Filter size={15} style={{ color: 'var(--ink-muted)' }} />
            <select value={feature} onChange={(event) => setFeature(event.target.value)}>
              {features.map((item) => (
                <option key={item} value={item}>
                  {item === 'all' ? 'All features' : featureLabel(item)}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>

      <Card className="flush" style={{ marginTop: 16 }}>
        {loading && !data ? (
          <div style={{ padding: 22 }}>
            <LoadingBlock lines={6} />
          </div>
        ) : error && !data ? (
          <div style={{ padding: 22 }}>
            <Banner tone="red">{error}</Banner>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 22 }}>
            <Empty title="No observations match this filter">
              Try another status, or log a new observation from the field.
            </Empty>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Observation</th>
                  <th>Field</th>
                  <th>Feature</th>
                  <th>Status</th>
                  <th>Gaps</th>
                  <th>Confidence</th>
                  <th>Delivery</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((observation) => {
                  const sync = syncMeta(observation.syncStatus)
                  const openGaps = observation.evidenceGaps.filter((gap) => !gap.resolved).length
                  return (
                    <tr key={observation.id} onClick={() => setOpenId(observation.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ maxWidth: 320 }}>
                        <strong>{observation.title}</strong>
                        <div className="tiny muted mono">
                          {observation.id}
                          {observation.isDemo ? ' · demo record' : ''}
                        </div>
                      </td>
                      <td>{observation.fieldName || 'Unassigned'}</td>
                      <td>{featureLabel(observation.feature)}</td>
                      <td>
                        <StatusPill status={observation.status} />
                      </td>
                      <td>
                        {openGaps ? (
                          <Pill tone="amber" className="small">
                            {openGaps} open
                          </Pill>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                      <td className="mono">{observation.confidence !== null ? percent(observation.confidence) : '—'}</td>
                      <td>
                        <Pill tone={sync.tone} className="small">
                          {sync.label}
                        </Pill>
                      </td>
                      <td className="small muted nowrap">{relativeTime(observation.updatedAt)}</td>
                      <td>
                        <button
                          className="btn tiny ghost"
                          onClick={(event) => {
                            event.stopPropagation()
                            setOpenId(observation.id)
                          }}
                        >
                          Open <ArrowRight size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="tiny muted" style={{ marginTop: 12 }}>
        {filtered.length} of {observations.length} observations shown · statuses are assigned by the evidence engine,
        never typed in.
      </p>

      <Modal
        open={formOpen}
        title="Log an observation"
        onClose={() => setFormOpen(false)}
        footer={
          <div className="btn-row">
            <button className="btn primary" onClick={submit} disabled={saving}>
              {saving ? <Spinner light /> : null} Save observation
            </button>
            <button className="btn ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
            <span className="tiny muted">Evidence debt updates as soon as this is saved.</span>
          </div>
        }
      >
        <div className="stack">
          <div className="form-row">
            <label className="field">
              <span>Field</span>
              <select value={form.fieldId} onChange={(event) => setForm({ ...form, fieldId: event.target.value })}>
                <option value="">Unassigned</option>
                {(fields.data?.fields ?? []).map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Feature / source</span>
              <select value={form.feature} onChange={(event) => setForm({ ...form, feature: event.target.value })}>
                <option value="manual_observation">Manual observation</option>
                <option value="threat_monitoring">Threat monitoring</option>
                <option value="soil_moisture">Soil moisture note</option>
              </select>
            </label>
          </div>

          <label className="field">
            <span>Title</span>
            <input
              type="text"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Chewing damage on ridge 4"
            />
          </label>

          <label className="field">
            <span>What did you see?</span>
            <textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Damage pattern, how much of the field, anything that could explain it…"
            />
          </label>

          <div className="form-row">
            <label className="field">
              <span>Concern level</span>
              <select value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })}>
                <option value="low">Low</option>
                <option value="moderate">Moderate</option>
                <option value="elevated">Elevated</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <label className="field">
              <span>Measured value (optional)</span>
              <input
                type="number"
                value={form.reading}
                onChange={(event) => setForm({ ...form, reading: event.target.value })}
                placeholder="e.g. depth in cm"
              />
            </label>
          </div>

          <div className="stack tight">
            <span className="tiny muted" style={{ letterSpacing: '.08em', textTransform: 'uppercase' }}>
              Evidence you can attach now
            </span>
            <label className="row tight small">
              <input
                type="checkbox"
                checked={form.photo}
                onChange={(event) => setForm({ ...form, photo: event.target.checked })}
                style={{ width: 16, height: 16 }}
              />
              <ImagePlus size={14} /> Photograph captured with this record
            </label>
            <label className="row tight small">
              <input
                type="checkbox"
                checked={form.independent}
                onChange={(event) => setForm({ ...form, independent: event.target.checked })}
                style={{ width: 16, height: 16 }}
              />
              <ShieldQuestion size={14} /> An independent observer corroborates this
            </label>
            <label className="row tight small">
              <input
                type="checkbox"
                checked={form.conflict}
                onChange={(event) => setForm({ ...form, conflict: event.target.checked })}
                style={{ width: 16, height: 16 }}
              />
              <CircleAlert size={14} /> Another report conflicts with this one
            </label>
          </div>

          <div className="note">
            The evidence engine decides the status. A record with a photo and full context still lands in{' '}
            <strong>needs review</strong> — a person confirms it, not the form. Timestamp: {dateTime(new Date().toISOString())}.
          </div>
        </div>
      </Modal>

      <ObservationDrawer observationId={openId} onClose={closeDrawer} onChanged={() => { refresh(); debt.refresh() }} />
    </div>
  )
}
