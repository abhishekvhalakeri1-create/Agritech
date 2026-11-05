import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BellRing,
  CircleAlert,
  CloudSun,
  Droplets,
  Leaf,
  Microscope,
  PlusCircle,
  Radio,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sprout,
  Wind,
} from 'lucide-react'
import { type Debt, type ModelStatus, type Overview as OverviewData, type Weather } from '../lib/api'
import { useApi, useGreeting } from '../lib/hooks'
import { percent, relativeTime, statusMeta, toneForScore } from '../lib/format'
import { EvidenceDebtMeter } from '../components/EvidenceDebtMeter'
import { WeatherCard } from '../components/WeatherCard'
import { HealthSummary } from '../components/HealthSummary'
import { ThreatCard, ThreatLegend } from '../components/ThreatCard'
import { ObservationDrawer } from '../components/ObservationDrawer'
import { Banner, Card, Empty, LoadingBlock, Pill, SectionHead, Spinner, StatusPill, useApp } from '../components/ui'

function StatCard({
  label,
  value,
  unit,
  foot,
  icon,
  tone = 'sage',
  to,
}: {
  label: string
  value: string | number
  unit?: string
  foot?: string
  icon: React.ReactNode
  tone?: 'sage' | 'amber' | 'orange' | 'red' | 'sunrise'
  to?: string
}) {
  const body = (
    <div className="card stat hoverable" style={{ height: '100%' }}>
      <div className="row between">
        <span className="stat-label">{label}</span>
        <span className={`card-icon ${tone === 'sage' ? '' : tone}`} style={{ width: 28, height: 28, borderRadius: 8 }}>
          {icon}
        </span>
      </div>
      <div className="stat-value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {foot ? <div className="stat-foot">{foot}</div> : null}
    </div>
  )
  return to ? (
    <Link to={to} style={{ display: 'block', height: '100%' }}>
      {body}
    </Link>
  ) : (
    body
  )
}

export default function Overview() {
  const { refreshKey, bump, push } = useApp()
  const greeting = useGreeting()
  const { data, loading, error, stale, refresh } = useApi<OverviewData>(`/overview?v=${refreshKey}`, {
    cacheKey: 'overview',
  })
  const weather = useApi<Weather>('/weather', { cacheKey: 'weather' })
  const modelStatus = useApi<ModelStatus>('/model-status', { cacheKey: 'model-status' })
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const debt = data?.debt as Debt | undefined
  const stats = data?.stats

  const refreshAll = async () => {
    setBusy(true)
    await Promise.all([refresh(), weather.refresh()])
    bump()
    push('Dashboard refreshed from the FIELDZY server.')
    setBusy(false)
  }

  const temperature = weather.data?.available ? weather.data.current?.temperature : null

  return (
    <div className="page">
      <header className="hero-greeting">
        <div>
          <div className="eyebrow">FIELDZY · Farm overview</div>
          <h1>{greeting}</h1>
          <p className="greet-sub">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} ·{' '}
            {stats ? `${stats.totalFields} fields under watch · ${stats.unverifiedObservations} reports awaiting evidence or review` : 'Loading your fields…'}
          </p>
        </div>
        <div className="btn-row">
          <button className="btn ghost" onClick={refreshAll} disabled={busy}>
            {busy ? <Spinner /> : <RefreshCw size={15} />} Refresh
          </button>
          <Link to="/observations?new=1" className="btn primary">
            <PlusCircle size={16} /> Log observation
          </Link>
        </div>
      </header>

      {stale ? (
        <div style={{ marginTop: 18 }}>
          <Banner tone="amber" icon={<CircleAlert size={17} />}>
            <strong>Showing the last data saved on this device.</strong> The server could not be reached
            {error ? ` (${error})` : ''}. New records will queue locally until delivery is confirmed.
          </Banner>
        </div>
      ) : null}

      <div className="grid grid-5 section" style={{ marginTop: 24 }}>
        <StatCard
          label="Total fields"
          value={stats?.totalFields ?? '—'}
          foot={data ? `${data.fields.filter((f) => f.status === 'attention').length} need attention` : ' '}
          icon={<Leaf size={14} />}
          to="/fields"
        />
        <StatCard
          label="Active sensors"
          value={stats?.activeSensors ?? '—'}
          foot={stats ? `${stats.simulatedProbes} simulated probe readings` : ' '}
          icon={<Radio size={14} />}
          tone="amber"
          to="/soil"
        />
        <StatCard
          label="Threat reports"
          value={stats?.threatsDetected ?? '—'}
          foot={stats ? `${stats.threatsVerified} verified · ${stats.threatsDetected - stats.threatsVerified} unconfirmed` : ' '}
          icon={<ShieldAlert size={14} />}
          tone="orange"
          to="/warnings"
        />
        <StatCard
          label="Evidence debt"
          value={debt?.score ?? '—'}
          unit={debt ? '/100' : undefined}
          foot={debt ? debt.band.label : ' '}
          icon={<Scale size={14} />}
          tone={debt ? (toneForScore(debt.score) as 'amber') : 'sage'}
          to="/observations?filter=debt"
        />
        <StatCard
          label="Current weather"
          value={temperature != null ? `${Math.round(temperature)}°` : weather.loading ? '…' : '—'}
          unit={temperature != null ? 'C' : undefined}
          foot={
            weather.data?.available
              ? `${weather.data.current?.condition ?? ''} · Open-Meteo`
              : weather.loading
                ? 'Fetching live weather'
                : 'Weather unavailable'
          }
          icon={<CloudSun size={14} />}
          tone="sunrise"
        />
      </div>

      <div className="split section">
        {debt ? (
          <EvidenceDebtMeter debt={debt} trend onOpenObservation={(id) => setOpenId(id)} />
        ) : (
          <Card>
            <LoadingBlock lines={4} />
          </Card>
        )}
        <WeatherCard refreshKey={refreshKey} />
      </div>

      <div className="split section">
        <Card className="flush">
          <div style={{ padding: '20px 22px 6px' }}>
            <div className="card-head" style={{ marginBottom: 4 }}>
              <div>
                <h3>Your fields</h3>
                <p className="card-sub">Registered fields, their latest observation and open warnings.</p>
              </div>
              <Link to="/fields" className="btn tiny ghost">
                Manage <ArrowRight size={13} />
              </Link>
            </div>
          </div>
          {loading && !data ? (
            <div style={{ padding: '10px 22px 22px' }}>
              <LoadingBlock lines={4} />
            </div>
          ) : data && data.fields.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Crop</th>
                    <th>Area</th>
                    <th>Status</th>
                    <th>Latest observation</th>
                    <th>Warnings</th>
                  </tr>
                </thead>
                <tbody>
                  {data.fields.map((field) => {
                    const meta = statusMeta(field.status === 'attention' ? 'unverified' : field.status === 'stable' ? 'verified' : 'needs_review')
                    return (
                      <tr key={field.id}>
                        <td>
                          <Link to={`/fields?focus=${field.id}`} style={{ color: 'var(--ink)', fontWeight: 600 }}>
                            {field.name}
                          </Link>
                          <div className="tiny muted mono">{field.id}</div>
                        </td>
                        <td>{field.crop}</td>
                        <td className="mono">{field.areaHa} ha</td>
                        <td>
                          <Pill tone={field.status === 'attention' ? 'orange' : field.status === 'monitor' ? 'amber' : 'sage'}>
                            {field.status}
                          </Pill>
                        </td>
                        <td style={{ maxWidth: 260 }}>
                          {field.latestObservation ? (
                            <>
                              <div style={{ fontSize: '.88rem' }}>{field.latestObservation.title}</div>
                              <div className="tiny muted">
                                {relativeTime(field.latestObservation.createdAt)} ·{' '}
                                {statusMeta(field.latestObservation.status).label}
                              </div>
                            </>
                          ) : (
                            <span className="muted small">No observations yet</span>
                          )}
                        </td>
                        <td>
                          {field.openWarningCount ? (
                            <Pill tone={meta.tone}>{field.openWarningCount} open</Pill>
                          ) : (
                            <span className="muted small">None</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: 22 }}>
              <Empty title="No fields registered">
                Add your first field to start collecting observations and evidence.
              </Empty>
            </div>
          )}
        </Card>

        <Card>
          <div className="card-head">
            <div>
              <h3>Priority actions</h3>
              <p className="card-sub">The most important unresolved items right now.</p>
            </div>
            <span className="card-icon amber">
              <BellRing size={16} />
            </span>
          </div>

          {loading && !data ? (
            <LoadingBlock lines={4} />
          ) : data?.priorityQueue.length ? (
            data.priorityQueue.map((item) => (
              <button className="action-item" key={item.observationId} onClick={() => setOpenId(item.observationId)}>
                <span
                  className={`action-icon ${item.status === 'conflicting' ? 'red' : item.openGaps ? '' : 'sage'}`}
                >
                  {item.status === 'conflicting' ? <CircleAlert size={16} /> : item.openGaps ? <Scale size={16} /> : <Leaf size={16} />}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="feed-title" style={{ display: 'block' }}>
                    {item.title}
                  </span>
                  <span className="feed-detail">
                    {item.fieldName} · {item.reason}
                  </span>
                </span>
                <ArrowRight size={14} style={{ color: 'var(--ink-muted)', flexShrink: 0 }} />
              </button>
            ))
          ) : (
            <Empty title="Nothing waiting">Every observation has its evidence and a review decision.</Empty>
          )}

          <div className="divider" />
          <div className="row between small muted">
            <span>Awaiting evidence or review</span>
            <strong style={{ color: 'var(--forest)' }}>{stats?.unverifiedObservations ?? '—'}</strong>
          </div>
          <div className="row between small muted" style={{ marginTop: 6 }}>
            <span>Verified observations</span>
            <strong style={{ color: 'var(--forest)' }}>{stats?.verifiedObservations ?? '—'}</strong>
          </div>
        </Card>
      </div>

      <section className="section">
        <SectionHead
          title="Threat visualizer"
          hint="A threat stays possible until its evidence is reviewed"
          action={
            <Link to="/warnings" className="btn tiny ghost">
              All warnings <ArrowRight size={13} />
            </Link>
          }
        />
        <div className="split-even">
          <div>
            {data?.threats?.length ? (
              data.threats.slice(0, 3).map((threat) => (
                <ThreatCard key={threat.id} threat={threat} onOpen={setOpenId} />
              ))
            ) : loading ? (
              <Card>
                <LoadingBlock lines={3} />
              </Card>
            ) : (
              <Empty title="No threat events on record">
                Threat reports appear here when monitoring, acoustic or manual observations raise them.
              </Empty>
            )}
            <div style={{ marginTop: 14 }}>
              <ThreatLegend />
            </div>
          </div>

          <Card>
            <div className="card-head">
              <div>
                <h3>Recent activity</h3>
                <p className="card-sub">Observations, analyses, reviews and transmission events.</p>
              </div>
              <span className="card-icon">
                <Sprout size={16} />
              </span>
            </div>
            {loading && !data ? (
              <LoadingBlock lines={5} />
            ) : data?.recentActivity.length ? (
              <div className="feed">
                {data.recentActivity.slice(0, 8).map((item) => (
                  <div className="feed-item" key={item.id}>
                    <span className={`feed-icon ${item.tone === 'red' ? 'red' : item.tone === 'amber' ? 'amber' : ''}`}>
                      {item.kind === 'acoustic' ? (
                        <Radio size={13} />
                      ) : item.kind === 'plant' ? (
                        <Microscope size={13} />
                      ) : item.kind === 'soil' ? (
                        <Droplets size={13} />
                      ) : item.kind === 'transmission' ? (
                        <Wind size={13} />
                      ) : (
                        <Leaf size={13} />
                      )}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      {item.observationId ? (
                        <button
                          onClick={() => setOpenId(item.observationId!)}
                          className="feed-title"
                          style={{ background: 'none', border: 0, padding: 0, textAlign: 'left' }}
                        >
                          {item.title}
                        </button>
                      ) : (
                        <span className="feed-title">{item.title}</span>
                      )}
                      <span className="feed-detail" style={{ display: 'block' }}>{item.detail}</span>
                    </span>
                    <span className="feed-time">{relativeTime(item.at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="No activity yet">Create an observation to start the record.</Empty>
            )}
          </Card>
        </div>
      </section>

      <section className="section">
        <SectionHead title="Field health summary" hint="AI-assisted, evidence-aware" />
        <div className="split-even">
          <HealthSummary refreshKey={refreshKey} />
          <Card>
            <div className="card-head">
              <div>
                <h3>Model status</h3>
                <p className="card-sub">What is actually running behind these pages.</p>
              </div>
              <span className="card-icon">
                <Microscope size={16} />
              </span>
            </div>
            <dl className="kv">
              <dt>Plant detection</dt>
              <dd>
                <Pill tone={modelStatus.data?.plant.trainedModelInstalled ? 'sage' : 'amber'} className="small">
                  {modelStatus.data?.plant.activeEngine ?? 'checking…'}
                </Pill>
              </dd>
              <dt>Acoustic</dt>
              <dd>
                <Pill tone={modelStatus.data?.audio.trainedModelInstalled ? 'sage' : 'amber'} className="small">
                  {modelStatus.data?.audio.activeEngine ?? 'checking…'}
                </Pill>
              </dd>
              <dt>AI summary</dt>
              <dd>
                {modelStatus.data?.summary.keyConfigured
                  ? `${modelStatus.data.summary.provider} · ${modelStatus.data.summary.model}`
                  : 'Local rules (no Gemini key configured)'}
              </dd>
              <dt>Evidence engine</dt>
              <dd>v{modelStatus.data?.engineVersion ?? '1.0.0'} · debt = min(100, gaps×15 + unresolved×10)</dd>
              <dt>Weather</dt>
              <dd>Open-Meteo, live fetch with a 10-minute cache</dd>
            </dl>
            <div className="note">
              Every module reports its real engine. Nothing in FIELDZY claims a trained-model result when the model
              artefact is absent.
            </div>
            <div className="btn-row" style={{ marginTop: 14 }}>
              <Link to="/plant" className="btn small ghost">
                Plant detection
              </Link>
              <Link to="/acoustic" className="btn small ghost">
                Acoustic intelligence
              </Link>
              <Link to="/network" className="btn small ghost">
                Network systems
              </Link>
            </div>
          </Card>
        </div>
      </section>

      <ObservationDrawer
        observationId={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => {
          refresh()
        }}
      />
    </div>
  )
}
