import { useEffect, useMemo, useState } from 'react'
import {
  CloudOff,
  Database,
  HardDriveDownload,
  Inbox,
  RefreshCw,
  Send,
  ServerCog,
  ShieldCheck,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { api, flushQueue, readQueue, type Debt, type Transmission } from '../lib/api'
import { useApi } from '../lib/hooks'
import { dateTime, relativeTime, syncMeta } from '../lib/format'
import { Banner, Card, Empty, LoadingBlock, Pill, SectionHead, Spinner, useApp } from '../components/ui'

interface NetworkState {
  serverReachable: boolean
  trackedObservations: number
  unverifiedRecords: number
  localOnly: number
  pendingSync: number
  synced: number
  failed: number
  evidenceGaps: number
  transmissionCounts: Record<string, number>
  transmissions: Transmission[]
  evidenceDebt: number
  note: string
}

export default function Network() {
  const { online, refreshKey, bump, push, syncNow } = useApp()
  const [queue, setQueue] = useState(() => readQueue())
  const [busy, setBusy] = useState(false)
  const network = useApi<NetworkState>(`/network?v=${refreshKey}`, { cacheKey: 'network' })
  const debt = useApi<Debt>(`/evidence-debt?v=${refreshKey}`, { cacheKey: 'debt' })

  useEffect(() => {
    const update = () => setQueue(readQueue())
    window.addEventListener('fieldzy:queue', update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener('fieldzy:queue', update)
      window.removeEventListener('storage', update)
    }
  }, [])

  const counts = network.data?.transmissionCounts ?? {}
  const transmissions = network.data?.transmissions ?? []

  const localRecords = useMemo(
    () => [
      { label: 'Queued in this browser', value: queue.length, tone: queue.length ? 'amber' : 'sage', icon: <HardDriveDownload size={14} /> },
      { label: 'Saved locally (server)', value: network.data?.localOnly ?? 0, tone: 'neutral', icon: <Database size={14} /> },
      { label: 'Awaiting sync', value: network.data?.pendingSync ?? 0, tone: 'amber', icon: <CloudOff size={14} /> },
      { label: 'Acknowledged', value: network.data?.synced ?? 0, tone: 'sage', icon: <ShieldCheck size={14} /> },
      { label: 'Failed delivery', value: network.data?.failed ?? 0, tone: 'red', icon: <WifiOff size={14} /> },
    ],
    [queue.length, network.data],
  )

  const retry = async () => {
    setBusy(true)
    try {
      const result = await flushQueue()
      setQueue(readQueue())
      await network.refresh()
      if (result.sent) {
        push(`${result.sent} queued record(s) delivered and acknowledged.`)
        bump()
      } else if (result.failed) {
        push(`${result.failed} record(s) still undelivered.`, 'amber')
      } else {
        await syncNow()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">FIELDZY · Network systems</div>
          <h1>Network &amp; relay</h1>
          <p className="page-sub">
            Local storage, delivery state and transmission activity. FIELDZY never treats “the browser says online” as
            proof that a record reached the server.
          </p>
        </div>
        <div className="btn-row">
          <Pill tone={online ? 'sage' : 'orange'}>
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {online ? 'Browser online' : 'Browser offline'}
          </Pill>
          <button className="btn ghost" onClick={retry} disabled={busy}>
            {busy ? <Spinner /> : <RefreshCw size={14} />} Retry delivery
          </button>
        </div>
      </header>

      <Banner tone={online ? 'forest' : 'amber'} icon={online ? <Wifi size={17} /> : <WifiOff size={17} />}>
        <strong>{online ? 'Link reported up.' : 'Working offline.'}</strong>{' '}
        {online
          ? 'Delivery is only marked complete when the server acknowledges a specific record. A record can still be local-only while the browser reports a connection.'
          : 'New observations are written to this device and queued. They will be retried automatically when the link returns.'}
      </Banner>

      <div className="grid grid-5" style={{ marginTop: 18 }}>
        {localRecords.map((item) => (
          <Card className="stat tight" key={item.label}>
            <div className="row between">
              <span className="stat-label">{item.label}</span>
              <span className="muted">{item.icon}</span>
            </div>
            <div
              className="stat-value"
              style={{
                fontSize: '1.65rem',
                color:
                  item.tone === 'red'
                    ? 'var(--red)'
                    : item.tone === 'amber'
                      ? 'var(--orange)'
                      : 'var(--forest)',
              }}
            >
              {item.value}
            </div>
          </Card>
        ))}
      </div>

      <div className="split section">
        <Card className="flush">
          <div style={{ padding: '20px 22px 10px' }}>
            <div className="card-head" style={{ marginBottom: 0 }}>
              <div>
                <h3>Transmission feed</h3>
                <p className="card-sub">Every state change recorded by FIELDZY — real events only.</p>
              </div>
              <span className="card-icon">
                <Send size={16} />
              </span>
            </div>
            <div className="row tight" style={{ marginTop: 10 }}>
              <Pill tone="sage" className="small">acknowledged {counts.synced ?? 0}</Pill>
              <Pill tone="amber" className="small">queued {counts.queued ?? 0}</Pill>
              <Pill tone="neutral" className="small">local {counts.saved_local ?? 0}</Pill>
              <Pill tone="red" className="small">failed {counts.failed ?? 0}</Pill>
            </div>
          </div>

          {network.loading && !network.data ? (
            <div style={{ padding: 22 }}>
              <LoadingBlock lines={5} />
            </div>
          ) : transmissions.length === 0 ? (
            <div style={{ padding: 22 }}>
              <Empty title="No transmission events">Create an observation to see its delivery trail here.</Empty>
            </div>
          ) : (
            <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
              <table className="data">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Observation</th>
                    <th>State</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {transmissions.map((item) => {
                    const meta = syncMeta(item.state)
                    return (
                      <tr key={item.id}>
                        <td style={{ maxWidth: 300 }}>
                          <strong style={{ fontWeight: 600 }}>{item.event}</strong>
                          <div className="tiny muted">{item.detail}</div>
                        </td>
                        <td className="small">{item.observationTitle ?? '—'}</td>
                        <td>
                          <Pill tone={meta.tone} className="small">
                            {meta.label}
                          </Pill>
                        </td>
                        <td className="small muted nowrap">{relativeTime(item.createdAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="stack">
          <Card>
            <div className="card-head">
              <div>
                <h3>Local queue</h3>
                <p className="card-sub">Records held in this browser only.</p>
              </div>
              <span className={`card-icon ${queue.length ? 'amber' : ''}`}>
                <Inbox size={16} />
              </span>
            </div>

            {queue.length === 0 ? (
              <p className="small muted">The queue is empty. Nothing is waiting for delivery.</p>
            ) : (
              <div className="stack tight">
                {queue.map((item) => (
                  <div className="gap-chip" key={item.id}>
                    <div style={{ minWidth: 0 }}>
                      <div className="gap-title">{String(item.payload.title ?? 'Untitled observation')}</div>
                      <div className="gap-detail">
                        Queued {relativeTime(item.createdAt)} · {item.attempts} attempt{item.attempts === 1 ? '' : 's'}
                        {item.lastError ? ` · ${item.lastError}` : ''}
                      </div>
                    </div>
                    <div className="gap-actions">
                      <Pill tone="amber" className="small">
                        pending
                      </Pill>
                    </div>
                  </div>
                ))}
                <button className="btn small primary" onClick={retry} disabled={busy}>
                  {busy ? <Spinner light /> : <Send size={14} />} Send now
                </button>
              </div>
            )}

            <div className="note">
              The queue lives in this browser's local storage. Clearing site data will remove undelivered records — the
              server only knows about what it has acknowledged.
            </div>
          </Card>

          <Card>
            <div className="card-head">
              <div>
                <h3>Record integrity</h3>
                <p className="card-sub">What the server currently holds.</p>
              </div>
              <span className="card-icon">
                <ServerCog size={16} />
              </span>
            </div>
            <dl className="kv">
              <dt>Tracked observations</dt>
              <dd>{network.data?.trackedObservations ?? '—'}</dd>
              <dt>Unverified records</dt>
              <dd>{network.data?.unverifiedRecords ?? '—'}</dd>
              <dt>Open evidence gaps</dt>
              <dd>{network.data?.evidenceGaps ?? '—'}</dd>
              <dt>Evidence debt</dt>
              <dd>
                {debt.data ? `${debt.data.score} · ${debt.data.band.label}` : '—'}
              </dd>
              <dt>Last refresh</dt>
              <dd>{network.data ? dateTime(new Date().toISOString()) : '—'}</dd>
            </dl>
            <div className="divider" />
            <div className="row between small" style={{ alignItems: 'flex-start' }}>
              <div>
                <strong>Relay activity</strong>
                <div className="tiny muted">
                  No device-to-device transport is implemented, so there is no relay traffic to report.
                </div>
              </div>
              <Pill tone="neutral" className="small">not available</Pill>
            </div>
            <div className="note">{network.data?.note ?? 'Loading network state from the server…'}</div>
          </Card>
        </div>
      </div>

      <SectionHead title="Offline-aware design" hint="What is real today, what is planned" />
      <div className="split-even">
        <Card>
          <div className="card-head">
            <div>
              <h3>Implemented now</h3>
              <p className="card-sub">Intentionally modest.</p>
            </div>
            <span className="card-icon">
              <ShieldCheck size={16} />
            </span>
          </div>
          <ul className="small" style={{ paddingLeft: 16, margin: 0, color: 'var(--ink-soft)' }}>
            <li>Separate delivery states: saved locally, queued, acknowledged, failed.</li>
            <li>A persistent browser-side queue with retry and attempt counts.</li>
            <li>Explicit server acknowledgement before a record is marked delivered.</li>
            <li>Locally cached dashboard data shown with a “stale” warning when the server cannot be reached.</li>
            <li>A transmission trail written for every state change.</li>
          </ul>
        </Card>
        <Card>
          <div className="card-head">
            <div>
              <h3>Planned, not claimed</h3>
              <p className="card-sub">No device-to-device mesh exists in this build.</p>
            </div>
            <span className="card-icon amber">
              <CloudOff size={16} />
            </span>
          </div>
          <ul className="small" style={{ paddingLeft: 16, margin: 0, color: 'var(--ink-soft)' }}>
            <li>PWA install with a service worker and an offline application shell.</li>
            <li>IndexedDB persistence for evidence files, not just JSON records.</li>
            <li>Reliable sync queues with duplicate prevention and conflict handling.</li>
            <li>Explicit sync acknowledgements surfaced per record.</li>
            <li>True relay between nearby devices — requires real device-to-device transport and testing.</li>
          </ul>
          <div className="note">
            FIELDZY says what it does. Until a relay is built and tested, this page will not pretend one exists.
          </div>
        </Card>
      </div>
    </div>
  )
}
