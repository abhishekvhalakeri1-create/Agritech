import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  CircleAlert,
  Compass,
  Droplets,
  Leaf,
  MapPin,
  PencilLine,
  Plus,
  Ruler,
  Sprout,
} from 'lucide-react'
import { api, type Field, type Observation } from '../lib/api'
import { useApi } from '../lib/hooks'
import { relativeTime, statusMeta } from '../lib/format'
import { ObservationDrawer } from '../components/ObservationDrawer'
import {
  Banner,
  Card,
  Empty,
  LoadingBlock,
  Modal,
  Pill,
  SectionHead,
  Spinner,
  StatusPill,
  useApp,
} from '../components/ui'

const EMPTY_FORM = {
  name: '',
  crop: '',
  areaHa: '',
  location: '',
  soilThresholdLow: '35',
  soilThresholdCritical: '20',
  notes: '',
}

type FieldForm = typeof EMPTY_FORM

export default function Fields() {
  const { refreshKey, push, bump } = useApp()
  const { data, loading, error, refresh } = useApi<{ fields: Field[] }>(`/fields?v=${refreshKey}`, {
    cacheKey: 'fields',
  })
  const [params] = useSearchParams()
  const focusId = params.get('focus')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Field | null>(null)
  const [form, setForm] = useState<FieldForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [openObservation, setOpenObservation] = useState<string | null>(null)

  useEffect(() => {
    if (!focusId) return
    const element = document.getElementById(`field-${focusId}`)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
      element.style.boxShadow = '0 0 0 2px var(--sunrise)'
      window.setTimeout(() => {
        element.style.boxShadow = ''
      }, 2400)
    }
  }, [focusId, data])

  const fields = useMemo(() => data?.fields ?? [], [data])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  const openEdit = (field: Field) => {
    setEditing(field)
    setForm({
      name: field.name,
      crop: field.crop,
      areaHa: String(field.areaHa ?? ''),
      location: field.location,
      soilThresholdLow: String(field.soilThresholdLow),
      soilThresholdCritical: String(field.soilThresholdCritical),
      notes: field.notes,
    })
    setFormOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) {
      push('A field needs a name.', 'amber')
      return
    }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      crop: form.crop.trim(),
      areaHa: Number(form.areaHa) || 0,
      location: form.location.trim(),
      soilThresholdLow: Number(form.soilThresholdLow) || 35,
      soilThresholdCritical: Number(form.soilThresholdCritical) || 20,
      notes: form.notes.trim(),
    }
    try {
      if (editing) {
        await api.patch(`/fields/${editing.id}`, payload)
        push(`${payload.name} updated.`)
      } else {
        await api.post('/fields', payload)
        push(`${payload.name} added to FIELDZY.`)
      }
      setFormOpen(false)
      bump()
      await refresh()
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not save the field.', 'red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">FIELDZY · Field management</div>
          <h1>My fields</h1>
          <p className="page-sub">
            Every field is a real record in FIELDZY's store. Observations, evidence gaps and warnings are attached to
            the field they came from.
          </p>
        </div>
        <div className="btn-row">
          <button className="btn ghost" onClick={() => refresh()}>
            Refresh
          </button>
          <button className="btn primary" onClick={openCreate}>
            <Plus size={16} /> Add field
          </button>
        </div>
      </header>

      {loading && !data ? (
        <Card>
          <LoadingBlock lines={5} />
        </Card>
      ) : error && !data ? (
        <Banner tone="red">
          <strong>Could not load fields.</strong> {error}
        </Banner>
      ) : fields.length === 0 ? (
        <Empty title="No fields yet">Add your first field to start collecting observations.</Empty>
      ) : (
        <>
          <div className="grid grid-3">
            {fields.map((field) => {
              const attention = field.status === 'attention'
              return (
                <Card className="hoverable" key={field.id} id={`field-${field.id}`}>
                  <div className="card-head">
                    <div>
                      <div className="row tight">
                        <h3 style={{ fontSize: '1.1rem' }}>{field.name}</h3>
                        <Pill tone="neutral" className="small mono">
                          {field.id}
                        </Pill>
                      </div>
                      <p className="card-sub">
                        {field.crop || 'Crop not set'} · {field.areaHa} ha
                      </p>
                    </div>
                    <span className={`card-icon ${attention ? 'orange' : 'sage'}`}>
                      <Leaf size={16} />
                    </span>
                  </div>

                  <div className="row tight" style={{ marginBottom: 12 }}>
                    <Pill tone={attention ? 'orange' : field.status === 'monitor' ? 'amber' : 'sage'}>
                      {attention ? 'Needs attention' : field.status}
                    </Pill>
                    <Pill tone="outline" className="small">
                      {field.observationCount} observation{field.observationCount === 1 ? '' : 's'}
                    </Pill>
                    {field.openGaps ? (
                      <Pill tone="amber" className="small">
                        {field.openGaps} open gap{field.openGaps === 1 ? '' : 's'}
                      </Pill>
                    ) : null}
                  </div>

                  <div className="stack tight small muted">
                    {field.location ? (
                      <span>
                        <MapPin size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                        {field.location}
                      </span>
                    ) : null}
                    <span>
                      <Ruler size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                      Moisture thresholds: low {field.soilThresholdLow}% · critical {field.soilThresholdCritical}%
                    </span>
                    {field.latitude && field.longitude ? (
                      <span>
                        <Compass size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                        {field.latitude.toFixed(4)}, {field.longitude.toFixed(4)}
                      </span>
                    ) : null}
                  </div>

                  <div className="divider" />

                  <div className="small">
                    <div className="row between" style={{ alignItems: 'baseline' }}>
                      <strong>Latest observation</strong>
                      <span className="tiny muted">{field.observationCount} total</span>
                    </div>
                    {field.latestObservation ? (
                      <button
                        className="action-item"
                        style={{ marginTop: 9, padding: '10px 11px' }}
                        onClick={() => setOpenObservation(field.latestObservation!.id)}
                      >
                        <span className="action-icon sage" style={{ width: 28, height: 28 }}>
                          <Sprout size={13} />
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span className="feed-title" style={{ display: 'block' }}>
                            {field.latestObservation.title}
                          </span>
                          <span className="feed-detail">
                            {relativeTime(field.latestObservation.createdAt)} ·{' '}
                            {statusMeta(field.latestObservation.status).label}
                          </span>
                        </span>
                      </button>
                    ) : (
                      <p className="small muted" style={{ marginTop: 8 }}>
                        No observations recorded for this field yet.
                      </p>
                    )}
                  </div>

                  {field.openWarnings.length ? (
                    <div style={{ marginTop: 12 }}>
                      {field.openWarnings.slice(0, 2).map((warning: Observation) => (
                        <div className="row tight small" key={warning.id} style={{ marginBottom: 6 }}>
                          <CircleAlert size={13} style={{ color: 'var(--orange)', flexShrink: 0 }} />
                          <button
                            className="muted"
                            style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }}
                            onClick={() => setOpenObservation(warning.id)}
                          >
                            {warning.title}
                          </button>
                          <StatusPill status={warning.status} />
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="btn-row" style={{ marginTop: 14 }}>
                    <button className="btn tiny ghost" onClick={() => openEdit(field)}>
                      <PencilLine size={12} /> Edit
                    </button>
                    <Link to={`/observations?new=1&field=${field.id}`} className="btn tiny ghost">
                      <Plus size={12} /> Observation
                    </Link>
                    <Link to={`/soil?field=${field.id}`} className="btn tiny ghost">
                      <Droplets size={12} /> Moisture
                    </Link>
                    <Link to={`/observations?field=${field.id}`} className="btn tiny ghost right">
                      All <ArrowRight size={12} />
                    </Link>
                  </div>
                </Card>
              )
            })}
          </div>

          <SectionHead title="How field status is decided" hint="Computed, never typed in" />
          <Card>
            <p className="small">
              A field moves to <strong>needs attention</strong> when any of its observations is conflicting, awaiting
              review or carrying an elevated severity. Otherwise it sits at <strong>monitor</strong> or{' '}
              <strong>stable</strong>. The status is recalculated from observation records every time the field list is
              loaded, so it cannot drift out of date.
            </p>
          </Card>
        </>
      )}

      <Modal
        open={formOpen}
        title={editing ? `Edit ${editing.name}` : 'Add a field'}
        onClose={() => setFormOpen(false)}
        footer={
          <div className="btn-row">
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? <Spinner light /> : null}
              {editing ? 'Save changes' : 'Add field'}
            </button>
            <button className="btn ghost" onClick={() => setFormOpen(false)}>
              Cancel
            </button>
          </div>
        }
      >
        <div className="stack">
          <label className="field">
            <span>Field name</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="North Block — Tomato"
            />
          </label>
          <div className="form-row">
            <label className="field">
              <span>Crop</span>
              <input
                type="text"
                value={form.crop}
                onChange={(event) => setForm({ ...form, crop: event.target.value })}
                placeholder="Tomato"
              />
            </label>
            <label className="field">
              <span>Area (hectares)</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={form.areaHa}
                onChange={(event) => setForm({ ...form, areaHa: event.target.value })}
                placeholder="2.4"
              />
            </label>
          </div>
          <label className="field">
            <span>Location description</span>
            <input
              type="text"
              value={form.location}
              onChange={(event) => setForm({ ...form, location: event.target.value })}
              placeholder="North block, 400 m from pump house"
            />
          </label>
          <div className="form-row">
            <label className="field">
              <span>Low moisture threshold (%)</span>
              <input
                type="number"
                min="0"
                max="100"
                value={form.soilThresholdLow}
                onChange={(event) => setForm({ ...form, soilThresholdLow: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Critical moisture threshold (%)</span>
              <input
                type="number"
                min="0"
                max="100"
                value={form.soilThresholdCritical}
                onChange={(event) => setForm({ ...form, soilThresholdCritical: event.target.value })}
              />
            </label>
          </div>
          <label className="field">
            <span>Notes</span>
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              placeholder="Irrigation, history, scouting routine…"
            />
          </label>
          {!editing ? (
            <div className="note">
              Coordinates are optional; weather uses the first field with coordinates. Without them FIELDZY falls back
              to the farm's default location.
            </div>
          ) : null}
        </div>
      </Modal>

      <ObservationDrawer
        observationId={openObservation}
        onClose={() => setOpenObservation(null)}
        onChanged={() => refresh()}
      />
    </div>
  )
}
