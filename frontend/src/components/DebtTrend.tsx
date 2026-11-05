import { useMemo } from 'react'
import type { DebtHistory } from '../lib/api'
import { relativeTime } from '../lib/format'

/** Debt over time — recorded snapshots plus the replayed history. */
export function DebtTrend({ history, height = 150 }: { history: DebtHistory; height?: number }) {
  const width = 620
  const pad = { top: 14, right: 12, bottom: 20, left: 26 }
  const points = history.series

  const { path, area, dots, labels } = useMemo(() => {
    if (!points.length) return { path: '', area: '', dots: [] as any[], labels: [] as string[] }
    const innerW = width - pad.left - pad.right
    const innerH = height - pad.top - pad.bottom
    const x = (index: number) => pad.left + (index / Math.max(1, points.length - 1)) * innerW
    const y = (score: number) => pad.top + innerH - (score / 100) * innerH
    const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.score).toFixed(1)}`).join(' ')
    return {
      path: line,
      area: `${line} L${x(points.length - 1).toFixed(1)},${(height - pad.bottom).toFixed(1)} L${x(0).toFixed(1)},${(height - pad.bottom).toFixed(1)} Z`,
      dots: points.map((point, index) => ({ ...point, cx: x(index), cy: y(point.score) })),
      labels: [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]].map((point) => point.at),
    }
  }, [points, height])

  if (!points.length) {
    return <p className="small muted">No history yet — the trend appears as soon as records change.</p>
  }

  const delta = history.delta24h
  const deltaTone = delta > 0 ? 'var(--orange)' : delta < 0 ? 'var(--sage-deep)' : 'var(--ink-muted)'

  return (
    <>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div className="row tight">
          <span className="pill small" style={{ background: 'var(--sage-mist)', color: 'var(--sage-deep)' }}>
            now {history.current}
          </span>
          <span className="pill small" style={{ background: 'var(--cream)', color: deltaTone }}>
            {delta === 0 ? 'no change in 24 h' : `${delta > 0 ? '+' : ''}${delta} in 24 h`}
          </span>
        </div>
        <span className="tiny muted">
          range {history.min}–{history.max} · {history.points} points
        </span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }} role="img" aria-label="Evidence debt over time">
        <defs>
          <linearGradient id="debtArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(201,100,42,.28)" />
            <stop offset="100%" stopColor="rgba(201,100,42,0)" />
          </linearGradient>
        </defs>
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = pad.top + (height - pad.top - pad.bottom) - (tick / 100) * (height - pad.top - pad.bottom)
         	return (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="rgba(31,61,43,.09)" strokeDasharray="3 4" />
              <text x={4} y={y + 3} fontSize="9" fill="var(--ink-muted)">
                {tick}
              </text>
            </g>
          )
        })}
        <path d={area} fill="url(#debtArea)" />
        <path d={path} fill="none" stroke="var(--forest-soft)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {dots.map((dot, index) => (
          <circle
            key={`${dot.at}-${index}`}
            cx={dot.cx}
            cy={dot.cy}
            r={dot.source === 'recorded' || dot.source === 'live' ? 3.2 : 2.2}
            fill={dot.source === 'recorded' || dot.source === 'live' ? 'var(--forest)' : 'var(--sage)'}
          >
            <title>{`${dot.score} · ${new Date(dot.at).toLocaleString()} (${dot.source})`}</title>
          </circle>
        ))}
        {labels.map((label, index) => (
          <text
            key={`${label}-${index}`}
            x={index === 0 ? pad.left : index === 1 ? width / 2 : width - pad.right}
            y={height - 5}
            fontSize="9"
            fill="var(--ink-muted)"
            textAnchor={index === 0 ? 'start' : index === 1 ? 'middle' : 'end'}
          >
            {relativeTime(label)}
          </text>
        ))}
      </svg>

      <div className="legend" style={{ marginTop: 4 }}>
        <span><i style={{ background: 'var(--forest)' }} />Recorded snapshot / live</span>
        <span><i style={{ background: 'var(--sage)' }} />Reconstructed from event timestamps</span>
      </div>
    </>
  )
}
