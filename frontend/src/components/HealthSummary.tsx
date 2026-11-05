import { useEffect, useState } from 'react'
import { Bot, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react'
import { api, type SummaryResponse } from '../lib/api'
import { dateTime } from '../lib/format'
import { LoadingBlock, Pill } from './ui'

export function HealthSummary({ refreshKey = 0, focusFieldId }: { refreshKey?: number; focusFieldId?: string }) {
  const [data, setData] = useState<SummaryResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async (force = false) => {
    setLoading(true)
    try {
      const result = await api.post<SummaryResponse>('/field-health-summary', {
        focusFieldId: focusFieldId ?? null,
      })
      setData(result)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The summary service did not respond.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, focusFieldId])

  const aiGenerated = data?.source === 'gemini'

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>Field health summary</h3>
          <p className="card-sub">
            Generated from your fields, observations and evidence status — not from weather alone.
          </p>
        </div>
        <div className="row tight">
          {data ? (
            <Pill tone={aiGenerated ? 'forest' : 'amber'}>
              {aiGenerated ? <Sparkles size={11} /> : <Bot size={11} />}
              {aiGenerated ? `Gemini · ${data.model}` : 'Local rules'}
            </Pill>
          ) : null}
          <button className="btn tiny ghost" onClick={() => load(true)} disabled={loading}>
            <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <LoadingBlock lines={4} />
      ) : error && !data ? (
        <div className="banner amber">
          <TriangleAlert size={16} />
          <div>
            <strong>Summary unavailable.</strong>
            <div className="small">{error}</div>
          </div>
        </div>
      ) : data ? (
        <>
          {data.summary.split(/\n\n+/).map((paragraph, index) => (
            <p key={index} style={{ fontSize: '.98rem', lineHeight: 1.38 }}>
              {paragraph}
            </p>
          ))}

          {data.highlights?.length ? (
            <div className="chip-row" style={{ marginTop: 8 }}>
              {data.highlights.map((highlight) => (
                <Pill tone="outline" key={highlight} className="small">
                  {highlight}
                </Pill>
              ))}
            </div>
          ) : null}

          <div className="note" style={{ borderLeftColor: aiGenerated ? 'var(--sage)' : 'var(--amber)' }}>
            {data.notice}
            {data.error ? <div className="tiny" style={{ marginTop: 4 }}>{data.error}</div> : null}
            <div className="tiny" style={{ marginTop: 4 }}>
              Generated {dateTime(data.generatedAt)} · the API key stays on the backend.
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
