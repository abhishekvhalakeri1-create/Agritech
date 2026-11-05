import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Droplets, FlaskConical, Gauge, Info, Send, TriangleAlert, Waves } from 'lucide-react'
import { api, type Field, type Observation, type SoilReading } from '../lib/api'
import { useApi } from '../lib/hooks'
import { dateTime, relativeTime, statusMeta } from '../lib/format'
import { Banner, Card, Empty, Pill, SectionHead, Spinner, StatusPill, useApp } from '../components/ui'

export default function Soil() {
  const { refreshKey, bump, push } = useApp()
  const fields = useApi<{ fields: Field[] }>(`/fields?v=${refreshKey}`, { cacheKey: 'fields' })
  const [params] = useSearchParams()
  const [fieldId, setFieldId] = useState(params.get('field') ?? '')
  const [moisture, setMoisture] = useState(32)
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<Observation | null>(null)

  const allFields = fields.data?.fields ?? []
  const field = allFields.find((item) => item.id === fieldId) ?? allFields[0]

  useEffect(() => {
    if (!fieldId && allFields.length) setFieldId(allFields[0].id)
  }, [allFields, fieldId])

  const readings = useApi<{ readings: SoilReading[] }>(
    field ? `/soil/readings?fieldId=${field.id}` : null,
  )

  const history = useMemo(
    () => (readings.data?.readings ?? []).slice(-14),
    [readings.data],
  )

  const low = field?.soilThresholdLow ?? 35
  const critical = field?.soilThresholdCritical ?? 20
  const condition = moisture <= critical ? 'critical' : moisture <= low ? 'low' : 'adequate'

  const chart = useMemo(() => {
    if (!history.length) return null
    const width = 560
    const height = 150
    const pad = 8
    const points = history.map((reading, index) => {
      const x = pad + (index / Math.max(1, history.length - 1)) * (width - pad * 2)
      const y = height - pad - (reading.moisture / 100) * (height - pad * 2)
      return { x, y, reading }
    })
    return { width, height, points, path: points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ') }
  }, [history])

  const record = async () => {
    if (!field) return
    setSaving(true)
    try {
      const response = await api.post<{ reading: SoilReading; observation: Observation | null; condition: string }>(
        '/soil/readings',
        { fieldId: field.id, moisture, createObservation: true },
      )
      readings.refresh()
      bump()
      if (response.observation) {
        setCreated(response.observation)
        push(`Reading saved. Observation raised with ${response.observation.evidenceGaps.length} evidence gap(s).`, 'amber')
      } else {
        setCreated(null)
        push('Reading saved — moisture is above the low threshold, so no observation was raised.')
      }
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not save the reading.', 'red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">FIELDZY · Soil moisture</div>
          <h1>Soil moisture</h1>
          <p className="page-sub">
            Threshold-based moisture monitoring per field. This deployment has no physical probe attached — readings are
            simulated and labelled as such everywhere they appear.
          </p>
        </div>
        <Pill tone="amber">
          <FlaskConical size={12} /> Simulated probe
        </Pill>
      </header>

      <div style={{ marginBottom: 18 }}>
        <Banner tone="amber" icon={<TriangleAlert size={17} />}>
          <strong>Not a physical sensor measurement.</strong> The slider below writes a simulated probe value so the
          threshold logic, evidence workflow and debt meter can be exercised. Real sensor integration — ESP32 or
          compatible, with calibration and stable timestamps — is planned and not yet implemented.
        </Banner>
      </div>

      <div className="split">
        <Card>
          <div className="card-head">
            <div>
              <h3>Take a probe reading</h3>
              <p className="card-sub">Below the low threshold, FIELDZY raises an observation automatically.</p>
            </div>
            <span className="card-icon">
              <Droplets size={16} />
            </span>
          </div>

          <label className="field">
            <span>Field</span>
            <select value={field?.id ?? ''} onChange={(event) => setFieldId(event.target.value)}>
              {allFields.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · low {item.soilThresholdLow}% / critical {item.soilThresholdCritical}%
                </option>
              ))}
            </select>
          </label>

          <div style={{ marginTop: 18 }}>
            <div className="row between">
              <span className="small muted">Volumetric moisture at 20 cm</span>
              <span style={{ fontSize: '1.9rem', fontWeight: 600, color: 'var(--forest)' }}>{moisture}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={moisture}
              onChange={(event) => setMoisture(Number(event.target.value))}
              aria-label="Simulated moisture percentage"
            />
            <div className="threshold-meter">
              <div className="marker" style={{ left: `${low}%` }} data-label={`low ${low}%`} />
              <div className="marker" style={{ left: `${critical}%`, background: 'var(--red)' }} data-label={`critical ${critical}%`} />
            </div>
            <div className="threshold-scale">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          <div className="row between" style={{ marginTop: 30 }}>
            <Pill tone={condition === 'critical' ? 'red' : condition === 'low' ? 'orange' : 'sage'}>
              {condition === 'critical' ? 'Critical — irrigation needed' : condition === 'low' ? 'Low moisture' : 'Adequate moisture'}
            </Pill>
            <button className="btn primary small" onClick={record} disabled={saving || !field}>
              {saving ? <Spinner light /> : <Send size={14} />} Save reading
            </button>
          </div>

          <div style={{ marginTop: 26 }}>
            <Banner tone={condition === 'critical' ? 'red' : condition === 'low' ? 'amber' : 'forest'} icon={<Info size={16} />}>
              <strong>Recommendation:</strong>{' '}
              {condition === 'critical'
                ? 'Irrigate this block today and check the emitter line; re-probe afterwards before treating the warning as settled.'
                : condition === 'low'
                  ? 'Plan irrigation within the next 24 hours and take a second reading from another spot in the plot.'
                  : 'Moisture is above the low threshold — no action needed, keep the normal scouting round.'}
            </Banner>
          </div>
          <div className="note">
            Saving a reading below the threshold creates a soil-moisture observation with a “physical sensor
            confirmation pending” evidence gap — so it cannot be presented as confirmed field information.
          </div>

          {created ? (
            <div style={{ marginTop: 14 }}>
              <Banner tone="amber" icon={<Info size={16} />}>
                <strong>Observation created:</strong> {created.title}
                <div className="row tight" style={{ marginTop: 6 }}>
                  <StatusPill status={created.status} />
                  <Pill tone="amber" className="small">
                    {created.evidenceGaps.length} evidence gap(s)
                  </Pill>
                  <Link to={`/observations?open=${created.id}`} className="btn tiny ghost">
                    Open observation
                  </Link>
                </div>
                <div className="small" style={{ marginTop: 6 }}>
                  {statusMeta(created.status).label} · {created.nextAction}
                </div>
              </Banner>
            </div>
          ) : null}
        </Card>

        <div className="stack">
          <Card>
            <div className="card-head">
              <div>
                <h3>{field?.name ?? 'Select a field'}</h3>
                <p className="card-sub">Reading history for this field (simulated probe).</p>
              </div>
              <span className="card-icon amber">
                <Waves size={16} />
              </span>
            </div>

            {chart ? (
              <>
                <svg viewBox={`0 0 ${chart.width} ${chart.height}`} style={{ width: '100%', height: 150 }}>
                  <defs>
                    <linearGradient id="soilLine" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="rgba(127,156,125,.34)" />
                      <stop offset="100%" stopColor="rgba(127,156,125,0)" />
                    </linearGradient>
                  </defs>
                  {[low, critical].map((value, index) => {
                    const y = chart.height - 8 - (value / 100) * (chart.height - 16)
                    return (
                      <line
                        key={value}
                        x1={8}
                        x2={chart.width - 8}
                        y1={y}
                        y2={y}
                        stroke={index === 0 ? 'rgba(197,143,44,.55)' : 'rgba(171,58,44,.45)'}
                        strokeDasharray="4 4"
                        strokeWidth="1"
                      />
                    )
                  })}
                  <path
                    d={`${chart.path} L${chart.points[chart.points.length - 1].x},${chart.height - 8} L${chart.points[0].x},${chart.height - 8} Z`}
                    fill="url(#soilLine)"
                  />
                  <path d={chart.path} fill="none" stroke="var(--forest-soft)" strokeWidth="2" strokeLinecap="round" />
                  {chart.points.map((point) => (
                    <circle
                      key={point.reading.id}
                      cx={point.x}
                      cy={point.y}
                      r={3}
                      fill={point.reading.condition === 'adequate' ? 'var(--sage-deep)' : point.reading.condition === 'low' ? 'var(--orange)' : 'var(--red)'}
                    />
                  ))}
                </svg>
                <div className="row between tiny muted">
                  <span>{relativeTime(history[0]?.createdAt)}</span>
                  <span>{relativeTime(history[history.length - 1]?.createdAt)}</span>
                </div>
                <div className="row tight" style={{ marginTop: 10 }}>
                  <Pill tone="amber" className="small">low {low}%</Pill>
                  <Pill tone="red" className="small">critical {critical}%</Pill>
                  <Pill tone="neutral" className="small">simulated probe</Pill>
                </div>
              </>
            ) : readings.loading ? (
              <p className="small muted">Loading readings…</p>
            ) : (
              <Empty title="No readings for this field yet">Save a probe reading to start the history.</Empty>
            )}
          </Card>

          <Card>
            <div className="card-head">
              <div>
                <h3>Readings</h3>
                <p className="card-sub">Newest first · simulated values</p>
              </div>
              <span className="card-icon">
                <Gauge size={16} />
              </span>
            </div>
            {history.length ? (
              <div className="stack tight">
                {[...history].reverse().slice(0, 8).map((reading) => (
                  <div className="row between small" key={reading.id}>
                    <span>
                      {dateTime(reading.createdAt)}
                      {reading.observationId ? <span className="tiny muted"> · observation raised</span> : null}
                    </span>
                    <span className="row tight">
                      <strong className="mono">{reading.moisture}%</strong>
                      <Pill
                        tone={reading.condition === 'critical' ? 'red' : reading.condition === 'low' ? 'orange' : 'sage'}
                        className="small"
                      >
                        {reading.condition}
                      </Pill>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">No readings recorded.</p>
            )}
          </Card>
        </div>
      </div>

      <SectionHead title="Planned soil work" hint="Not implemented yet" />
      <Card>
        <ul className="small" style={{ paddingLeft: 16, margin: 0, color: 'var(--ink-soft)' }}>
          <li>Physical soil-moisture sensor integration (ESP32 or compatible) with real calibration.</li>
          <li>Reliable, device-generated timestamps rather than host time.</li>
          <li>Field-specific thresholds and per-crop profiles.</li>
          <li>Anomaly detection and sensor-health monitoring, including missing or stuck readings.</li>
          <li>Historical monitoring with evidence attached to each reading.</li>
        </ul>
        <div className="note">
          Until those exist, FIELDZY says “simulated” on every moisture value. A slider is never a sensor.
        </div>
      </Card>
    </div>
  )
}
