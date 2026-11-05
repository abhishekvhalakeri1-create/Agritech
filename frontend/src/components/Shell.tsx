import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  Activity,
  CloudRain,
  Leaf,
  Menu,
  Microscope,
  Radio,
  ScanEye,
  ShieldAlert,
  Sprout,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { api, flushQueue, readQueue, type Debt } from '../lib/api'
import { toneForScore } from '../lib/format'
import { useApp } from './ui'

const NAV = [
  { to: '/', label: 'Overview', icon: Sprout, end: true },
  { to: '/fields', label: 'Fields', icon: Leaf },
  { to: '/warnings', label: 'Warnings', icon: ShieldAlert },
  { to: '/observations', label: 'Observations', icon: ScanEye },
  { to: '/acoustic', label: 'Acoustic', icon: Radio },
  { to: '/plant', label: 'Plant', icon: Microscope },
  { to: '/soil', label: 'Soil', icon: CloudRain },
  { to: '/network', label: 'Network', icon: Activity },
]

const TONE_HEX: Record<string, string> = {
  sage: '#5c7a5d',
  amber: '#c58f2c',
  orange: '#c9642a',
  red: '#ab3a2c',
  neutral: '#6d7c6c',
  forest: '#1f3d2b',
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { online, queueCount, syncNow, refreshKey } = useApp()
  const [open, setOpen] = useState(false)
  const [debt, setDebt] = useState<Debt | null>(null)
  const location = useLocation()

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  useEffect(() => {
    let active = true
    api
      .get<Debt>('/evidence-debt')
      .then((result) => active && setDebt(result))
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [refreshKey, location.pathname])

  const tone = debt ? debt.band.tone : 'sage'

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="FIELDZY home">
            <span className="brand-mark">
              <Leaf size={20} strokeWidth={1.9} />
            </span>
            <span className="brand-text">
              <span className="brand-name">FIELDZY</span>
              <span className="brand-tag">Smarter Fields. Safer Harvests.</span>
            </span>
          </Link>

          <nav className={`nav-links ${open ? 'open' : ''}`} aria-label="Main">
            {NAV.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                >
                  <Icon size={15} strokeWidth={1.9} />
                  {item.label}
                  {item.to === '/network' && queueCount > 0 ? <span className="dot" /> : null}
                </NavLink>
              )
            })}
          </nav>

          <div className="nav-right">
            <Link to="/observations?filter=debt" className="nav-debt" title="Open the Evidence Debt breakdown">
              <span
                className="nav-debt-ring"
                style={{ background: TONE_HEX[tone] ?? TONE_HEX.sage }}
              >
                {debt ? debt.score : '—'}
              </span>
              <span className="nav-debt-label">Evidence&nbsp;Debt</span>
            </Link>
            <span className={`conn-pill ${online ? '' : 'offline'}`} title={online ? 'Browser reports a connection' : 'Browser is offline'}>
              <span className="light" />
              {online ? 'Online' : 'Offline'}
            </span>
            <span className="avatar" title="Hemish — field owner">H</span>
            <button className="menu-toggle" onClick={() => setOpen((v) => !v)} aria-label="Toggle navigation">
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          </div>
        </div>
      </header>

      {!online ? (
        <div
          style={{
            background: 'var(--amber-soft)',
            borderBottom: '1px solid rgba(197,143,44,.3)',
            color: '#7a5a16',
            fontSize: '.86rem',
            padding: '9px 20px',
          }}
        >
          <div style={{ width: 'min(1280px,100%)', margin: '0 auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            <WifiOff size={15} />
            <span>
              Working offline. New observations are stored on this device and queued — FIELDZY will not mark them
              delivered until the server acknowledges them.
            </span>
          </div>
        </div>
      ) : queueCount > 0 ? (
        <div
          style={{
            background: 'var(--sage-mist)',
            borderBottom: '1px solid var(--hairline)',
            color: 'var(--forest)',
            fontSize: '.86rem',
            padding: '9px 20px',
          }}
        >
          <div style={{ width: 'min(1280px,100%)', margin: '0 auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            <Wifi size={15} />
            <span>
              {queueCount} observation{queueCount === 1 ? '' : 's'} waiting to be delivered from this device.
            </span>
            <button className="btn tiny ghost" style={{ marginLeft: 'auto' }} onClick={syncNow}>
              Retry delivery
            </button>
          </div>
        </div>
      ) : null}

      <main style={{ flex: 1 }}>{children}</main>

      <footer className="footer">
        <div className="footer-inner">
          <span>
            <strong style={{ color: 'var(--forest)', letterSpacing: '.12em' }}>FIELDZY</strong> · Smarter Fields. Safer
            Harvests.
          </span>
          <span>
            Weather by Open-Meteo · Evidence engine v1.0.0 · A model prediction is a report, not a confirmed event.
          </span>
          <span>{queueCount > 0 ? `${queueCount} queued · retry pending` : 'No unsent records'}</span>
        </div>
      </footer>
    </div>
  )
}

export function useSyncOnReconnect() {
  const { online, bump, push } = useApp()
  useEffect(() => {
    if (!online) return
    if (readQueue().length === 0) return
    let cancelled = false
    flushQueue().then((result) => {
      if (cancelled) return
      if (result.sent > 0) {
        push(`${result.sent} queued observation${result.sent === 1 ? '' : 's'} delivered to the server.`)
        bump()
      }
      if (result.failed > 0) push(`${result.failed} record(s) still undelivered — they stay in the local queue.`, 'amber')
    })
    return () => {
      cancelled = true
    }
  }, [online, bump, push])
}
