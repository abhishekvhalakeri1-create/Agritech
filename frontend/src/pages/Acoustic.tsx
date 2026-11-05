import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CircleSlash,
  FileAudio,
  Info,
  Mic,
  MicOff,
  Radio,
  RotateCcw,
  Send,
  Square,
  Upload,
  Waves,
} from 'lucide-react'
import {
  api,
  type AudioAnalysis,
  type AudioResult,
  type Field,
  type ModelStatus,
  type Observation,
} from '../lib/api'
import { useApi } from '../lib/hooks'
import { featureLabel, percent, relativeTime, statusMeta } from '../lib/format'
import {
  Banner,
  Card,
  ConfidenceBars,
  Empty,
  LoadingBlock,
  Pill,
  SectionHead,
  Spinner,
  StatusPill,
  useApp,
} from '../components/ui'

type MicState = 'unknown' | 'ready' | 'denied' | 'unsupported'

function writeString(view: DataView, offset: number, text: string) {
  for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let offset = 44
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }
  return new Blob([view], { type: 'audio/wav' })
}

export default function Acoustic() {
  const { refreshKey, bump, push } = useApp()
  const { data: status } = useApi<ModelStatus>('/model-status', { cacheKey: 'model-status' })
  const { data: fieldsData } = useApi<{ fields: Field[] }>(`/fields?v=${refreshKey}`, { cacheKey: 'fields' })
  const history = useApi<{ analyses: AudioAnalysis[]; count: number }>(`/audio-analyses?v=${refreshKey}`)

  const [mic, setMic] = useState<MicState>('unknown')
  const [micError, setMicError] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [duration, setDuration] = useState(0)
  const [level, setLevel] = useState(0)
  const [clip, setClip] = useState<{ blob: Blob; name: string; source: 'microphone' | 'upload'; duration: number } | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [result, setResult] = useState<AudioResult | null>(null)
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null)
  const [observation, setObservation] = useState<Observation | null>(null)
  const [creating, setCreating] = useState(false)
  const [fieldId, setFieldId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const levelsRef = useRef<number[]>([])
  const chunksRef = useRef<Float32Array[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const timerRef = useRef<number | null>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio
      canvas.height = height * ratio
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const levels = levelsRef.current
    const bars = Math.max(1, Math.floor(width / 6))
    const slice = levels.slice(-bars)
    const mid = height / 2
    const barWidth = width / bars

    ctx.strokeStyle = 'rgba(223,231,217,0.16)'
    ctx.beginPath()
    ctx.moveTo(0, mid)
    ctx.lineTo(width, mid)
    ctx.stroke()

    slice.forEach((value, index) => {
      const magnitude = Math.min(1, value * 6.2)
      const barHeight = Math.max(2, magnitude * (height * 0.82))
      const x = index * barWidth + 1
      const gradient = ctx.createLinearGradient(0, mid - barHeight / 2, 0, mid + barHeight / 2)
      gradient.addColorStop(0, 'rgba(224,160,60,0.95)')
      gradient.addColorStop(0.5, 'rgba(223,231,217,0.95)')
      gradient.addColorStop(1, 'rgba(127,156,125,0.9)')
      ctx.fillStyle = gradient
      ctx.beginPath()
      if (typeof (ctx as any).roundRect === 'function') {
        ;(ctx as any).roundRect(x, mid - barHeight / 2, Math.max(2, barWidth - 2), barHeight, 1.5)
      } else {
        ctx.rect(x, mid - barHeight / 2, Math.max(2, barWidth - 2), barHeight)
      }
      ctx.fill()
    })

    if (!slice.length) {
      ctx.fillStyle = 'rgba(223,231,217,0.35)'
      ctx.font = '13px Garamond, serif'
      ctx.fillText('Microphone idle — the wave appears here while you record.', 16, mid + 4)
    }
  }, [])

  useEffect(() => {
    draw()
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [draw])

  const stopEverything = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    processorRef.current?.disconnect()
    processorRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (contextRef.current && contextRef.current.state !== 'closed') void contextRef.current.close()
    contextRef.current = null
    setRecording(false)
    setLevel(0)
  }, [])

  const startRecording = async () => {
    setError(null)
    setObservation(null)
    setResult(null)
    setAnalysis(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setMic('unsupported')
      setMicError('This browser does not expose microphone capture.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      streamRef.current = stream
      setMic('ready')
      setMicError(null)

      const AudioCtor = window.AudioContext || (window as any).webkitAudioContext
      const context: AudioContext = new AudioCtor()
      contextRef.current = context
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor
      const silence = context.createGain()
      silence.gain.value = 0

      chunksRef.current = []
      levelsRef.current = []
      setDuration(0)
      setClip(null)
      setRecording(true)

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0)
        chunksRef.current.push(new Float32Array(input))
        let sum = 0
        for (let index = 0; index < input.length; index += 1) sum += input[index] * input[index]
        const rms = Math.sqrt(sum / input.length)
        levelsRef.current.push(rms)
        if (levelsRef.current.length > 480) levelsRef.current.shift()
        setLevel(rms)
        draw()
      }

      source.connect(processor)
      processor.connect(silence)
      silence.connect(context.destination)

      const startedAt = Date.now()
      timerRef.current = window.setInterval(() => {
        const seconds = (Date.now() - startedAt) / 1000
        setDuration(seconds)
        if (seconds >= 60) {
          push('Recording stopped at the 60 second analysis limit.', 'amber')
          void stopRecording()
        }
      }, 200)
    } catch (err: any) {
      const name = err?.name ?? ''
      setMic(name === 'NotAllowedError' ? 'denied' : 'unknown')
      setMicError(
        name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow access in the browser address bar, or upload a WAV file instead.'
          : err?.message || 'The microphone could not be started.',
      )
      stopEverything()
    }
  }

  const stopRecording = async () => {
    const chunks = chunksRef.current
    const context = contextRef.current
    const sampleRate = context?.sampleRate ?? 48000
    stopEverything()
    if (!chunks.length) {
      setError('Nothing was captured. Check that the microphone is connected and try again.')
      return
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const samples = new Float32Array(total)
    let offset = 0
    for (const chunk of chunks) {
      samples.set(chunk, offset)
      offset += chunk.length
    }
    const blob = encodeWav(samples, sampleRate)
    const seconds = total / sampleRate
    setClip({ blob, name: `field-capture-${Date.now()}.wav`, source: 'microphone', duration: seconds })
    setDuration(seconds)
    levelsRef.current = Array.from(samples.slice(0, 480 * 100).filter((_, index) => index % 100 === 0)).map((sample) => Math.abs(sample))
    draw()
  }

  const onUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    setResult(null)
    setAnalysis(null)
    setObservation(null)
    if (file.size > 25 * 1024 * 1024) {
      setError('That file is larger than the 25 MB upload limit.')
      return
    }
    setClip({ blob: file, name: file.name, source: 'upload', duration: 0 })
    levelsRef.current = Array.from({ length: 80 }, (_, index) => 0.12 + 0.1 * Math.abs(Math.sin(index / 4)))
    draw()
    if (!/\.wav$/i.test(file.name)) {
      push('Only PCM WAV files can be decoded by this backend. The analysis will report that clearly if not.', 'amber')
    }
  }

  const analyse = async () => {
    if (!clip) return
    setAnalysing(true)
    setError(null)
    setObservation(null)
    try {
      const form = new FormData()
      form.append('file', clip.blob, clip.name)
      form.append('fieldId', fieldId)
      form.append('source', clip.source)
      const response = await api.form<{ analysis: AudioAnalysis; result: AudioResult }>('/analyse-audio', form)
      setResult(response.result)
      setAnalysis(response.analysis)
      history.refresh()
      push(`Analysis complete · ${response.result.label}`, response.result.predictedClass === 'no_signal' ? 'amber' : 'forest')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The audio analysis failed.')
    } finally {
      setAnalysing(false)
    }
  }

  const createObservation = async () => {
    if (!analysis) return
    setCreating(true)
    try {
      const response = await api.post<{ observation: Observation }>(
        `/audio-analyses/${analysis.id}/observation`,
        { fieldId: fieldId || null },
      )
      setObservation(response.observation)
      push(
        response.observation.evidenceGaps.length
          ? `Observation created with ${response.observation.evidenceGaps.length} evidence gap(s).`
          : 'Observation created and sent for review.',
        'amber',
      )
      history.refresh()
      bump()
    } catch (err) {
      push(err instanceof Error ? err.message : 'Could not create the observation.', 'red')
    } finally {
      setCreating(false)
    }
  }

  const reset = () => {
    stopEverything()
    levelsRef.current = []
    chunksRef.current = []
    setClip(null)
    setDuration(0)
    setResult(null)
    setAnalysis(null)
    setObservation(null)
    setError(null)
    draw()
  }

  const audioStatus = status?.audio
  const trained = Boolean(audioStatus?.trainedModelInstalled)
  const analyses = history.data?.analyses ?? []

  const dsp = ((result?.features ?? {}) as Record<string, any>)
  const rawBands = (dsp.bands ?? {}) as Record<string, number>
  const bands = Object.keys(rawBands).length
    ? [
        { key: 'low', label: '20–250 Hz', share: rawBands.low ?? 0 },
        { key: 'lowMid', label: '250–800', share: rawBands.lowMid ?? 0 },
        { key: 'mid', label: '0.8–2 kHz', share: rawBands.mid ?? 0 },
        { key: 'high', label: '2–6 kHz', share: rawBands.high ?? 0 },
        { key: 'veryHigh', label: '6–8 kHz', share: rawBands.veryHigh ?? 0 },
      ]
    : []

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">FIELDZY · Acoustic intelligence</div>
          <h1>Acoustic intelligence</h1>
          <p className="page-sub">
            Record or upload a clip from the field. FIELDZY extracts audio features, classifies the sound with the
            installed engine, and turns a meaningful finding into an observation that carries its evidence — or its
            gaps.
          </p>
        </div>
        <div className="btn-row">
          <Pill tone={trained ? 'sage' : 'amber'}>
            <Radio size={12} /> {trained ? 'Trained classifier active' : 'Screening rules active'}
          </Pill>
        </div>
      </header>

      <div className="split">
        <div className="stack">
          <Card className="recorder">
            <div className="card-head">
              <div>
                <h3>Microphone monitor</h3>
                <p className="card-sub">
                  Live input level while recording. Nothing is captured until you press record, and monitoring stops the
                  moment you stop.
                </p>
              </div>
              <Pill tone={recording ? 'red' : mic === 'denied' ? 'amber' : 'neutral'} className="small">
                {recording ? 'Recording' : mic === 'denied' ? 'Permission denied' : mic === 'ready' ? 'Microphone ready' : 'Idle'}
              </Pill>
            </div>

            <div className="wave-shell">
              <div className="wave-grid" />
              <span className="wave-status">
                {recording ? (
                  <>
                    <span className="rec-dot" /> capturing input
                  </>
                ) : (
                  <>
                    <CircleSlash size={11} /> input not active
                  </>
                )}
              </span>
              <canvas ref={canvasRef} style={{ height: 138 }} />
              <span className="wave-time">{duration.toFixed(1)}s / 60s</span>
            </div>

            <div className="rec-metrics">
              <div className="rec-metric">
                <div className="k">Input level</div>
                <div className="v">{recording ? `${Math.min(100, Math.round(level * 900))}%` : '—'}</div>
              </div>
              <div className="rec-metric">
                <div className="k">Duration</div>
                <div className="v">{duration ? `${duration.toFixed(1)}s` : '0.0s'}</div>
              </div>
              <div className="rec-metric">
                <div className="k">Source</div>
                <div className="v">{clip ? (clip.source === 'microphone' ? 'Microphone' : 'Upload') : 'None'}</div>
              </div>
            </div>

            <div className="btn-row" style={{ marginTop: 16 }}>
              {!recording ? (
                <button className="btn primary" onClick={startRecording} disabled={analysing}>
                  <Mic size={15} /> Start recording
                </button>
              ) : (
                <button className="btn danger" onClick={stopRecording}>
                  <Square size={14} /> Stop recording
                </button>
              )}

              <label className="btn ghost" style={{ cursor: 'pointer' }}>
                <Upload size={14} /> Upload audio
                <input type="file" accept="audio/wav,audio/x-wav,audio/*" onChange={onUpload} style={{ display: 'none' }} />
              </label>

              <button className="btn ghost" onClick={analyse} disabled={!clip || analysing || recording}>
                {analysing ? <Spinner /> : <Waves size={14} />} Analyse audio
              </button>

              <button className="btn ghost" onClick={reset} disabled={analysing || recording}>
                <RotateCcw size={14} /> Clear
              </button>
            </div>

            {micError ? (
              <div style={{ marginTop: 12 }}>
                <Banner tone="amber" icon={<MicOff size={16} />}>
                  {micError}
                </Banner>
              </div>
            ) : null}

            {clip ? (
              <div className="row between" style={{ marginTop: 12 }}>
                <span className="small">
                  <FileAudio size={14} style={{ verticalAlign: '-2px', marginRight: 5 }} />
                  {clip.name} · {(clip.blob.size / 1024).toFixed(0)} KB
                  {clip.source === 'upload' && clip.duration === 0 ? ' · duration read on the server' : ''}
                </span>
                <select
                  value={fieldId}
                  onChange={(event) => setFieldId(event.target.value)}
                  style={{ maxWidth: 230 }}
                  aria-label="Field for this clip"
                >
                  <option value="">No field (unassigned)</option>
                  {(fieldsData?.fields ?? []).map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            {error ? (
              <div style={{ marginTop: 12 }}>
                <Banner tone="red">
                  <strong>Analysis failed.</strong> {error}
                </Banner>
              </div>
            ) : null}
          </Card>

          {result ? (
            <Card>
              <div className="card-head">
                <div>
                  <h3>Analysis result</h3>
                  <p className="card-sub">A classification describes a sound — it does not prove a threat.</p>
                </div>
                <Pill tone={result.isTrainedModel ? 'sage' : 'amber'} className="small">
                  {result.isTrainedModel ? 'Trained classifier' : 'Screening rules'}
                </Pill>
              </div>

              <div className="result-hero">
                <span className={`card-icon ${result.threatRelevance === 'elevated' ? 'red' : result.threatRelevance === 'moderate' ? 'orange' : ''}`} style={{ width: 46, height: 46 }}>
                  <Waves size={22} />
                </span>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div className="label">{result.label}</div>
                  <div className="sub">{result.description}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="small muted">Confidence</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 600, color: 'var(--forest)' }}>
                    {result.confidence ? percent(result.confidence) : '—'}
                  </div>
                </div>
              </div>

              <div className="grid grid-3" style={{ marginTop: 14 }}>
                <div className="rec-metric">
                  <div className="k">Engine</div>
                  <div className="v" style={{ fontSize: '.84rem' }}>{result.engine}</div>
                </div>
                <div className="rec-metric">
                  <div className="k">Duration</div>
                  <div className="v">{result.durationSec}s</div>
                </div>
                <div className="rec-metric">
                  <div className="k">Clarity</div>
                  <div className="v">{percent(result.clarityScore)}</div>
                </div>
              </div>
              <p className="tiny muted" style={{ marginTop: 8 }}>{result.claritySummary}</p>

              <ConfidenceBars topK={result.topK} />

              {bands.length ? (
                <div style={{ marginTop: 16 }}>
                  <div className="row between small">
                    <strong style={{ fontSize: '.9rem' }}>Spectral fingerprint</strong>
                    <span className="tiny muted">share of energy per band</span>
                  </div>
                  <div className="band-grid">
                    {bands.map((band) => (
                      <div className="band" key={band.key}>
                        <div className="band-bar-shell">
                          <div className="band-bar" style={{ height: `${Math.max(3, band.share * 100)}%` }} />
                        </div>
                        <div className="band-label">{band.label}</div>
                        <div className="band-value">{Math.round(band.share * 100)}%</div>
                      </div>
                    ))}
                  </div>
                  <div className="dsp-grid">
                    <div className="rec-metric">
                      <div className="k">Tonality</div>
                      <div className="v">{Math.round((dsp.tonality ?? 0) * 100)}%</div>
                    </div>
                    <div className="rec-metric">
                      <div className="k">Envelope modulation</div>
                      <div className="v">
                        {Math.round(dsp.modulationHz ?? 0)} Hz · {Math.round((dsp.modulationDepth ?? 0) * 100)}%
                      </div>
                    </div>
                    <div className="rec-metric">
                      <div className="k">Transients</div>
                      <div className="v">{dsp.transientCount ?? 0}</div>
                    </div>
                    <div className="rec-metric">
                      <div className="k">Spectral centroid</div>
                      <div className="v">{Math.round(dsp.spectralCentroid ?? 0)} Hz</div>
                    </div>
                  </div>
                  <p className="tiny muted" style={{ marginTop: 6 }}>
                    Measured from the clip itself. These describe the sound, not the threat.
                  </p>
                </div>
              ) : null}

              <div className="divider" />
              <dl className="kv">
                <dt>Threat relevance</dt>
                <dd className="capitalize">{result.threatRelevance}</dd>
                <dt>Category</dt>
                <dd>{result.threatCategory}</dd>
                <dt>Recommended action</dt>
                <dd>{result.recommendedAction}</dd>
                <dt>Analysis timestamp</dt>
                <dd>{relativeTime(analysis?.createdAt)}</dd>
                <dt>Audio source</dt>
                <dd>{analysis?.source === 'microphone' ? 'Microphone recording' : 'Uploaded file'}</dd>
              </dl>

              <div className="note">{result.note}</div>

              <div className="row between" style={{ marginTop: 14 }}>
                <span className="small muted">Evidence status: not yet an observation</span>
                <button
                  className="btn primary small"
                  onClick={createObservation}
                  disabled={creating || Boolean(observation) || result.predictedClass === 'no_signal'}
                >
                  {creating ? <Spinner light /> : <Send size={14} />}
                  {observation ? 'Observation created' : 'Create observation'}
                </button>
              </div>

              {observation ? (
                <div style={{ marginTop: 12 }}>
                  <Banner tone={observation.status === 'verified' ? 'forest' : 'amber'} icon={<Info size={16} />}>
                    <strong>{observation.title}</strong> — {statusMeta(observation.status).label}.{' '}
                    {observation.evidenceGaps.length} evidence gap
                    {observation.evidenceGaps.length === 1 ? '' : 's'} recorded; the Evidence Debt Meter now includes
                    this report.
                    <div className="small" style={{ marginTop: 4 }}>{observation.nextAction}</div>
                  </Banner>
                </div>
              ) : null}
            </Card>
          ) : (
            <Card>
              <div className="card-head">
                <div>
                  <h3>Why a sound is not a verdict</h3>
                  <p className="card-sub">The same evidence rules apply to every FIELDZY module.</p>
                </div>
                <span className="card-icon">
                  <Info size={16} />
                </span>
              </div>
              <ol className="small" style={{ paddingLeft: 18, margin: 0, color: 'var(--ink-soft)' }}>
                <li style={{ marginBottom: 6 }}>A clip is decoded and validated (PCM WAV, up to 60 seconds).</li>
                <li style={{ marginBottom: 6 }}>
                  Features are extracted — YAMNet embeddings when TensorFlow and the classifier are installed, otherwise
                  band energy, tonality, transients and envelope modulation.
                </li>
                <li style={{ marginBottom: 6 }}>The installed classifier, or the labelled screen, returns its prediction.</li>
                <li>Only when you create an observation does the evidence engine attach gaps and update the debt meter.</li>
              </ol>
            </Card>
          )}
        </div>

        <div className="stack">
          <Card>
            <div className="card-head">
              <div>
                <h3>Engine status</h3>
                <p className="card-sub">Reported live by the backend.</p>
              </div>
              <span className={`card-icon ${trained ? '' : 'amber'}`}>
                <Radio size={16} />
              </span>
            </div>
            {status ? (
              <>
                <dl className="kv">
                  <dt>Active engine</dt>
                  <dd>{audioStatus?.activeEngine}</dd>
                  <dt>Trained model</dt>
                  <dd>{trained ? 'Installed' : 'Not installed'}</dd>
                  <dt>Classifier file</dt>
                  <dd className="tiny" style={{ wordBreak: 'break-all' }}>{audioStatus?.classifierPath}</dd>
                  <dt>Label source</dt>
                  <dd>{audioStatus?.labelSource}</dd>
                </dl>
                <div className="note">{audioStatus?.detail}</div>
                {!trained ? (
                  <div style={{ marginTop: 12 }}>
                    <Banner tone="amber" icon={<AlertTriangle size={16} />}>
                      The trained classifier and YAMNet are not present in this deployment, so every result is
                      labelled screening rather than model output. Install the artefacts to switch engines — no code
                      change needed.
                    </Banner>
                  </div>
                ) : null}
              </>
            ) : (
              <LoadingBlock lines={4} />
            )}
          </Card>

          <Card>
            <div className="card-head">
              <div>
                <h3>Planned acoustic work</h3>
                <p className="card-sub">Not yet implemented — listed so nothing is overstated.</p>
              </div>
            </div>
            <ul className="small" style={{ paddingLeft: 16, margin: 0, color: 'var(--ink-soft)' }}>
              <li>Farm-specific audio classification with crop and environment context.</li>
              <li>A larger labelled agricultural audio dataset.</li>
              <li>Domain-specific classifier training with separate validation and test splits.</li>
              <li>Confidence calibration and richer sound categories.</li>
              <li>Multi-signal corroboration (acoustic + image + sensor) before a threat is raised.</li>
            </ul>
          </Card>
        </div>
      </div>

      <section className="section">
        <SectionHead title="Acoustic activity history" hint="Every clip you have actually analysed" />
        <Card className="flush">
          {history.loading && !history.data ? (
            <div style={{ padding: 22 }}>
              <LoadingBlock lines={4} />
            </div>
          ) : analyses.length === 0 ? (
            <div style={{ padding: 22 }}>
              <Empty title="No analyses yet">
                Record or upload a clip above. FIELDZY will not invent history entries.
              </Empty>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Prediction</th>
                    <th>Field</th>
                    <th>Source</th>
                    <th>Confidence</th>
                    <th>Engine</th>
                    <th>Observation</th>
                  </tr>
                </thead>
                <tbody>
                  {analyses.map((item) => (
                    <tr key={item.id}>
                      <td className="small muted nowrap">{relativeTime(item.createdAt)}</td>
                      <td>
                        <strong>{item.label}</strong>
                        <div className="tiny muted">{item.predictedClass}</div>
                      </td>
                      <td>{item.fieldName || 'Unassigned'}</td>
                      <td className="capitalize">{item.source}</td>
                      <td className="mono">{item.confidence !== null ? percent(item.confidence) : '—'}</td>
                      <td className="tiny">{item.isTrainedModel ? 'trained classifier' : 'screening rules'}</td>
                      <td>
                        {item.observationId ? (
                          <span className="row tight">
                            <Pill tone={item.observationStatus === 'verified' ? 'sage' : 'amber'} className="small">
                              {statusMeta(item.observationStatus).label}
                            </Pill>
                          </span>
                        ) : (
                          <span className="muted small">not linked</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <p className="tiny muted" style={{ marginTop: 10 }}>
          {featureLabel('acoustic_intelligence')} · clips are processed in memory and are not retained on the server.
        </p>
      </section>
    </div>
  )
}
