import type { ReactNode } from 'react'
import { createContext, useContext, useEffect } from 'react'
import { AlertTriangle, Check, Leaf, Loader2, X } from 'lucide-react'
import type { Tone } from '../lib/api'

export function Card({
  children,
  className = '',
  as: Tag = 'div',
  ...rest
}: {
  children: ReactNode
  className?: string
  as?: any
  [key: string]: any
}) {
  return (
    <Tag className={`card ${className}`} {...rest}>
      {children}
    </Tag>
  )
}

export function SectionHead({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      <div className="row tight">
        {hint ? <span className="hint">{hint}</span> : null}
        {action}
      </div>
    </div>
  )
}

export function Pill({ children, tone = 'neutral', className = '' }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={`pill ${tone} ${className}`}>{children}</span>
}

export function StatusPill({ status }: { status?: string | null }) {
  const map: Record<string, { label: string; tone: Tone }> = {
    verified: { label: 'Verified', tone: 'sage' },
    needs_review: { label: 'Needs review', tone: 'amber' },
    unverified: { label: 'Unverified', tone: 'orange' },
    conflicting: { label: 'Conflicting', tone: 'red' },
    inconclusive: { label: 'Inconclusive', tone: 'amber' },
    resolved: { label: 'Resolved', tone: 'neutral' },
  }
  const meta = map[status ?? ''] ?? { label: (status ?? 'unknown').replace(/_/g, ' '), tone: 'neutral' as Tone }
  return (
    <span className={`pill ${meta.tone}`}>
      <span className="dot" />
      {meta.label}
    </span>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Leaf size={20} style={{ opacity: 0.5, marginBottom: 6 }} />
      <h4>{title}</h4>
      {children ? <div className="small">{children}</div> : null}
    </div>
  )
}

export function Spinner({ light = false }: { light?: boolean }) {
  return <span className={`spinner ${light ? 'light' : ''}`} aria-label="Loading" />
}

export function LoadingBlock({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack">
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className="skeleton" style={{ height: index === 0 ? 22 : 14, width: `${90 - index * 12}%` }} />
      ))}
    </div>
  )
}

export function Banner({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: 'neutral' | 'amber' | 'orange' | 'red' | 'forest'
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={`banner ${tone === 'neutral' ? '' : tone}`}>
      <div style={{ flexShrink: 0, marginTop: 1 }}>{icon ?? <AlertTriangle size={17} />}</div>
      <div>{children}</div>
    </div>
  )
}

export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <header className="drawer-head">
          <div>
            <h3 style={{ fontSize: '1.2rem' }}>{title}</h3>
            {subtitle ? <div className="small muted" style={{ marginTop: 5 }}>{subtitle}</div> : null}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        {footer ? <div style={{ padding: '14px 22px', borderTop: '1px solid var(--hairline)', background: 'var(--surface)' }}>{footer}</div> : null}
      </aside>
    </>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="row between" style={{ marginBottom: 16 }}>
          <h3>{title}</h3>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
        {footer ? <div style={{ marginTop: 18 }}>{footer}</div> : null}
      </div>
    </div>
  )
}

export function MeterBar({ value, max = 100 }: { value: number; max?: number }) {
  const width = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div className="bar-track">
      <div className="bar-fill" style={{ width: `${width}%` }} />
    </div>
  )
}

export function ConfidenceBars({ topK }: { topK?: Array<{ label: string; confidence: number | null }> }) {
  if (!topK || !topK.length) return null
  return (
    <div className="conf-bars">
      {topK.map((item) => (
        <div className="conf-row" key={item.label}>
          <div>
            <div className="row between" style={{ marginBottom: 4 }}>
              <span>{item.label}</span>
            </div>
            <div className="conf-track">
              <div className="conf-fill" style={{ width: `${Math.round((item.confidence ?? 0) * 100)}%` }} />
            </div>
          </div>
          <span className="mono small muted">{item.confidence === null ? '—' : `${Math.round(item.confidence * 100)}%`}</span>
        </div>
      ))}
    </div>
  )
}

export function CheckList({ checks }: { checks: Array<{ key: string; label: string; passed: boolean; detail: string }> }) {
  return (
    <div className="check-list">
      {checks.map((check) => (
        <div className={`check ${check.passed ? '' : 'fail'}`} key={check.key}>
          <span className="mark">{check.passed ? <Check size={11} /> : <X size={11} />}</span>
          <div>
            <div>{check.label}</div>
            <div className="tiny muted">{check.detail}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function Busy({ label = 'Working' }: { label?: string }) {
  return (
    <span className="row tight small muted">
      <Loader2 size={14} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
      {label}
    </span>
  )
}

/* ------------------------------------------------------- app-level context */
interface AppContextValue {
  online: boolean
  queueCount: number
  push: (message: string, tone?: 'forest' | 'amber' | 'red') => void
  syncNow: () => void
  refreshKey: number
  bump: () => void
}

export const AppContext = createContext<AppContextValue>({
  online: true,
  queueCount: 0,
  push: () => {},
  syncNow: () => {},
  refreshKey: 0,
  bump: () => {},
})

export function useApp() {
  return useContext(AppContext)
}
