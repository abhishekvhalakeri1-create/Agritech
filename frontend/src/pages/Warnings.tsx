import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CircleAlert,
  Gauge,
  Layers,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Siren,
} from 'lucide-react'
import { type Threat } from '../lib/api'
import { useApi } from '../lib/hooks'
import { ObservationDrawer } from '../components/ObservationDrawer'
import { ThreatCard, ThreatLegend } from '../components/ThreatCard'
import { Banner, Card, Empty, LoadingBlock, Pill, SectionHead, useApp } from '../components/ui'

const LEVELS = ['all', 'critical', 'elevated', 'moderate', 'low']

export default function Warnings() {
  const { refreshKey } = useApp()
  const { data, loading, error } = useApi<{ threats: Threat[]; counts: any; note: string }>(
    `/threats?v=${refreshKey}`,
  )
  const [level, setLevel] = useState('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const threats = data?.threats ?? []
  const filtered = useMemo(
    () => (level === 'all' ? threats : threats.filter((threat) => threat.visual.level === level)),
    [threats, level],
  )

  const counts = data?.counts ?? { total: 0, confirmed: 0, awaitingReview: 0, demoRecords: 0 }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">FIELDZY · Threat monitoring</div>
          <h1>Early warnings</h1>
          <p className="page-sub">
            A central view of potentially concerning field events — what was observed, what supports it, and whether it
            has actually been verified. The colour scale runs from slate green to emergency red according to the
            seriousness of the record.
          </p>
        </div>
        <div className="btn-row">
          <Link to="/acoustic" className="btn ghost">
            <Radio size={15} /> Acoustic analysis
          </Link>
          <Link to="/observations?filter=debt" className="btn primary">
            <ShieldAlert size={15} /> Evidence queue
          </Link>
        </div>
      </header>

      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        {[
          { label: 'Threat reports', value: counts.total, icon: <ShieldAlert size={14} />, tone: '' },
          { label: 'Verified by review', value: counts.confirmed, icon: <ShieldCheck size={14} />, tone: 'sage' },
          { label: 'Awaiting review', value: counts.awaitingReview, icon: <CircleAlert size={14} />, tone: 'amber' },
          { label: 'Demo records', value: counts.demoRecords, icon: <Layers size={14} />, tone: 'orange' },
        ].map((item) => (
          <Card className="stat tight hoverable" key={item.label}>
            <div className="row between">
              <span className="stat-label">{item.label}</span>
              <span className={`card-icon ${item.tone === 'sage' ? '' : item.tone}`} style={{ width: 28, height: 28, borderRadius: 8 }}>
                {item.icon}
              </span>
            </div>
            <div className="stat-value">{item.value}</div>
          </Card>
        ))}
      </div>

      <Card className="tight" style={{ background: 'linear-gradient(120deg, rgba(79,111,90,.08), rgba(197,143,44,.08) 45%, rgba(171,58,44,.1))' }}>
        <div className="row between" style={{ gap: 18 }}>
          <div className="row tight">
            <Siren size={16} style={{ color: 'var(--orange)' }} />
            <span className="small">
              Severity scale — slate green → amber → orange → emergency red, driven by the threat record's current
              level and verification status.
            </span>
          </div>
          <ThreatLegend />
        </div>
        <div
          style={{
            height: 8,
            borderRadius: 999,
            marginTop: 14,
            background: 'linear-gradient(90deg, var(--slate-green), var(--amber) 38%, var(--orange) 66%, var(--red))',
          }}
        />
      </Card>

      {data?.note ? (
        <div style={{ marginTop: 16 }}>
          <Banner tone="amber" icon={<Gauge size={17} />}>
            <strong>Nothing here is a live automatic detection.</strong> {data.note} Connect real image, sensor or
            acoustic evidence — each threat must travel through the same evidence workflow as every other observation.
          </Banner>
        </div>
      ) : null}

      <div className="row between" style={{ marginTop: 22 }}>
        <div className="tab-row">
          {LEVELS.map((item) => (
            <button key={item} className={`tab ${level === item ? 'active' : ''}`} onClick={() => setLevel(item)}>
              {item === 'all' ? 'All levels' : item.charAt(0).toUpperCase() + item.slice(1)}
              <span className="tiny muted">
                {' '}
                {item === 'all' ? threats.length : threats.filter((threat) => threat.visual.level === item).length}
              </span>
            </button>
          ))}
        </div>
        <span className="tiny muted">A threat is a possible event until sufficient evidence exists.</span>
      </div>

      <div className="split" style={{ marginTop: 14 }}>
        <div>
          {loading && !data ? (
            <Card>
              <LoadingBlock lines={5} />
            </Card>
          ) : error && !data ? (
            <Banner tone="red">{error}</Banner>
          ) : filtered.length === 0 ? (
            <Empty title="No threat events at this level">
              Threat reports arrive from threat monitoring, acoustic analysis and manual observations.
            </Empty>
          ) : (
            filtered.map((threat) => <ThreatCard key={threat.id} threat={threat} onOpen={setOpenId} />)
          )}
        </div>

        <div className="stack">
          <Card>
            <div className="card-head">
              <div>
                <h3>What each card carries</h3>
                <p className="card-sub">The record, not just an alarm.</p>
              </div>
              <span className="card-icon orange">
                <CircleAlert size={16} />
              </span>
            </div>
            <dl className="kv">
              <dt>Field &amp; time</dt>
              <dd>Which field, when it was captured, and by which feature.</dd>
              <dt>Category</dt>
              <dd>Disease, threat, acoustic or manual — taken from the observation itself.</dd>
              <dt>Evidence quality</dt>
              <dd>Share of automated evidence checks the record currently passes.</dd>
              <dt>Verification</dt>
              <dd>Only a recorded human review sets a report to verified.</dd>
              <dt>Required action</dt>
              <dd>Generated from the open evidence gaps and the engine's next-step guidance.</dd>
            </dl>
          </Card>

          <Card>
            <div className="card-head">
              <div>
                <h3>Clean route into the workflow</h3>
                <p className="card-sub">How a detection becomes a warning.</p>
              </div>
              <span className="card-icon">
                <ArrowRight size={16} />
              </span>
            </div>
            <div className="timeline">
              {[
                'Observation captured by a module',
                'Evidence collected and checked',
                'Validation verdict and gaps recorded',
                'Human review resolves the gaps',
                'Warning communicated with its evidence status',
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
            <div className="note">
              Trends across several observations can suggest a pattern, but FIELDZY never presents a correlation as
              proof.
            </div>
          </Card>
        </div>
      </div>

      <SectionHead title="Open the source record" hint="Every warning links to its observation" />
      <Card>
        <p className="small">
          Selecting <em>Review</em> on any threat opens the observation with its evidence gaps, validation checks and
          review history. Resolving gaps there is what changes this page — there is no separate alert state to keep in
          sync.
        </p>
      </Card>

      <ObservationDrawer observationId={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}
