import { useState } from 'react'
import { CloudSun, Droplets, ExternalLink, MapPin, RefreshCw, Thermometer, Wind } from 'lucide-react'
import { api, type Weather } from '../lib/api'
import { useApi } from '../lib/hooks'
import { LoadingBlock, Pill } from './ui'

export function WeatherCard({ refreshKey }: { refreshKey?: number }) {
  const { data, loading, error, refresh } = useApi<Weather>('/weather', { cacheKey: 'weather' })
  const [refreshing, setRefreshing] = useState(false)

  const doRefresh = async () => {
    setRefreshing(true)
    try {
      await api.get<Weather>('/weather?force=true')
      await refresh()
    } catch {
      await refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const unavailable = (!loading && !data?.available) || Boolean(error)
  const current = data?.current

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>Weather</h3>
          <p className="card-sub">
            {data?.fieldName ? (
              <>
                <MapPin size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                {data.fieldName}
              </>
            ) : (
              'Nearest registered field'
            )}
          </p>
        </div>
        <div className="row tight">
          {refreshing || loading ? <RefreshCw size={14} className="spin" style={{ animation: 'spin 1s linear infinite', color: 'var(--ink-muted)' }} /> : null}
          <button className="btn tiny ghost" onClick={doRefresh} disabled={refreshing || loading}>
            Refresh
          </button>
        </div>
      </div>

      {loading && !data ? (
        <LoadingBlock lines={3} />
      ) : unavailable ? (
        <div className="stack tight">
          <div className="banner amber">
            <CloudSun size={17} />
            <div>
              <strong>Weather source unavailable.</strong>
              <div className="small" style={{ marginTop: 4 }}>
                {data?.error || error || 'The Open-Meteo request did not complete.'} FIELDZY does not show
                remembered or estimated values as live weather.
              </div>
            </div>
          </div>
          <button className="btn small ghost" onClick={doRefresh} disabled={refreshing}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div>
              <div className="weather-temp">
                {current?.temperature !== null && current?.temperature !== undefined
                  ? `${Math.round(current.temperature)}°C`
                  : '—'}
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                {current?.condition ?? '—'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <Pill tone="sage">Open-Meteo</Pill>
              <div className="tiny muted" style={{ marginTop: 6 }}>
                {data?.cached ? `Cached ${data?.fetchedAt?.slice(11, 16) ?? ''} UTC` : 'Live fetch'}
              </div>
            </div>
          </div>

          <div className="weather-grid">
            <div className="weather-item">
              <Thermometer size={12} style={{ marginRight: 4 }} />
              Feels like
              <b>{current?.apparentTemperature !== null && current?.apparentTemperature !== undefined ? `${Math.round(current.apparentTemperature)}°C` : '—'}</b>
            </div>
            <div className="weather-item">
              <Droplets size={12} style={{ marginRight: 4 }} />
              Humidity
              <b>{current?.humidity != null ? `${Math.round(current.humidity)}%` : '—'}</b>
            </div>
            <div className="weather-item">
              <Wind size={12} style={{ marginRight: 4 }} />
              Wind
              <b>{current?.windSpeed != null ? `${Math.round(current.windSpeed)} km/h` : '—'}</b>
            </div>
            <div className="weather-item">
              <Droplets size={12} style={{ marginRight: 4 }} />
              Rain probability (6 h)
              <b>{data?.rainProbabilityNext6h != null ? `${data.rainProbabilityNext6h}%` : '—'}</b>
            </div>
          </div>

          <div className="row between" style={{ marginTop: 14 }}>
            <span className="tiny muted">External weather source — not a field measurement.</span>
            <a
              className="tiny"
              href="https://open-meteo.com/"
              target="_blank"
              rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              open-meteo.com <ExternalLink size={11} />
            </a>
          </div>
        </>
      )}
    </section>
  )
}
