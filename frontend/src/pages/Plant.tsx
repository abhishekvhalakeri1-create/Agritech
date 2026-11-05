import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ImagePlus,
  Microscope,
  ScanLine,
  Send,
  Sparkles,
  X,
} from 'lucide-react'
import {
  api,
  type Field,
  type ModelStatus,
  type Observation,
  type PlantAnalysis,
} from '../lib/api'
import { useApi } from '../lib/hooks'
import { percent, relativeTime, statusMeta } from '../lib/format'
import {
  Banner,
  Card,
  ConfidenceBars,
  Empty,
  LoadingBlock,
  MeterBar,
  Pill,
  SectionHead,
  Spinner,
  StatusPill,
  useApp,
} from '../components/ui'

export default function Plant() {
  const { refreshKey, bump, push } = useApp()
  const { data: status } = useApi<ModelStatus>('/model-status', { cacheKey: 'model-status' })
  const fields = useApi<{ fields: Field[] }>(`/fields?v=${refreshKey}`, { cacheKey: 'fields' })
  const history = useApi<{ analyses: PlantAnalysis[]; count: number }>(`/plant-analyses?v=${refreshKey}`)

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [fieldId, setFieldId] = useState('')
  const [crop, setCrop] = useState('')
  const [analysing, setAnalysing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [analysis, setAnalysis] = useState<PlantAnalysis | null>(null)
  const [observation, setObservation] = useState<Observation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const plantStatus = status?.plant

  const pick = (picked: File | null) => {
    if (!picked) return
    if (!picked.type.startsWith('image/')) {
      setError('Please choose a JPEG or PNG photograph.')
      return
    }
    if (picked.size > 12 * 1024 * 1024) {
      setError('That image is larger than the 12 MB limit.')
      return
    }
    setError(null)
    setAnalysis(null)
    setObservation(null)
    setFile(picked)
    setPreview(URL.createObjectURL(picked))
  }

  const analyse = async () => {
    if (!file) return
    setAnalysing(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('fieldId', fieldId)
      form.append('crop', crop)
      const response = await api.form<{ analysis: PlantAnalysis }>('/predict-plant', form)
      setAnalysis(response.analysis)
      history.refresh()
      push(`Screening complete · ${response.analysis.label}`, 'forest')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The plant analysis failed.')
    } finally {
      setAnalysing(false)
    }
  }

  const createObservation = async () => {
    if (!analysis) return
    setCreating(true)
    try {
      const response = await api.post<{ observation: Observation }>(
        `/plant-analyses/${analysis.id}/observation`,
        { fieldId: fieldId || null },
      )
      setObservation(response.observation)
      push(
        response.observation.evidenceGaps.length
          ? `Observation created with ${response.observation.evidenceGaps.length} evidence gap(s) to close.`
          : 'Observation created and sent for human review.',
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

  const clear = () => {
    setFile(null)
    setPreview(null)
    setAnalysis(null)
    setObservation(null)
    setError(null)
  }

  const analyses = history.data?.analyses ?? []
  const quality = analysis?.quality
  const qualityIssues = useMemo(() => quality?.issues ?? [], [quality])

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">FIELDZY · Plant disease detection</div>
          <h1>Plant health</h1>
          <p className="page-sub">
            Photograph a leaf and FIELDZY runs the installed plant model — or a clearly-labelled screening pass when the
            trained artefacts are absent. A prediction is a report to be confirmed in the field, not a diagnosis.
          </p>
        </div>
        <Pill tone={plantStatus?.trainedModelInstalled ? 'sage' : 'amber'}>
          <Microscope size={12} /> {plantStatus?.trainedModelInstalled ? 'SavedModel active' : 'Screening rules active'}
        </Pill>
      </header>

      <div className="split">
        <Card>
          <div className="card-head">
            <div>
              <h3>Leaf capture</h3>
              <p className="card-sub">Clear, well-lit, close to the affected area.</p>
            </div>
            <span className="card-icon">
              <Camera size={16} />
            </span>
          </div>

          <label
            className={`dropzone ${dragging ? 'drag' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              pick(event.dataTransfer.files?.[0] ?? null)
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => pick(event.target.files?.[0] ?? null)}
            />
            {preview ? (
              <img src={preview} alt="Selected leaf" className="preview-thumb" />
            ) : (
              <div className="stack tight" style={{ alignItems: 'center' }}>
                <ImagePlus size={26} style={{ color: 'var(--sage-deep)' }} />
                <strong style={{ fontSize: '.98rem' }}>Drop a leaf photograph here</strong>
                <span className="small muted">or choose a file · JPEG / PNG · up to 12 MB</span>
              </div>
            )}
          </label>

          {file ? (
            <div className="row between" style={{ marginTop: 12 }}>
              <span className="small">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </span>
              <button className="btn tiny ghost" onClick={clear}>
                <X size={12} /> Remove
              </button>
            </div>
          ) : null}

          <div className="form-row" style={{ marginTop: 14 }}>
            <label className="field">
              <span>Field</span>
              <select value={fieldId} onChange={(event) => setFieldId(event.target.value)}>
                <option value="">Unassigned</option>
                {(fields.data?.fields ?? []).map((field) => (
                  <option key={field.id} value={field.id}>
                    {field.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Crop (optional)</span>
              <input
                type="text"
                value={crop}
                onChange={(event) => setCrop(event.target.value)}
                placeholder="Tomato"
              />
            </label>
          </div>

          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={analyse} disabled={!file || analysing}>
              {analysing ? <Spinner light /> : <ScanLine size={15} />} Analyse image
            </button>
            <button className="btn ghost" onClick={() => inputRef.current?.click()}>
              Choose another
            </button>
          </div>

          {error ? (
            <div style={{ marginTop: 12 }}>
              <Banner tone="red">
                <strong>Analysis failed.</strong> {error}
              </Banner>
            </div>
          ) : null}

          {quality ? (
            <div style={{ marginTop: 18 }}>
              <div className="row between small">
                <span>Capture quality</span>
                <span className="mono">{percent(quality.score)}</span>
              </div>
              <MeterBar value={quality.score * 100} />
              <div className="tiny muted" style={{ marginTop: 6 }}>{quality.summary}</div>
              {qualityIssues.length ? (
                <div className="row tight" style={{ marginTop: 6 }}>
                  {qualityIssues.map((issue) => (
                    <Pill tone="amber" key={issue} className="small">
                      {issue}
                    </Pill>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>

        <div className="stack">
          {analysis ? (
            <Card>
              <div className="card-head">
                <div>
                  <h3>Screening result</h3>
                  <p className="card-sub">Engine: {analysis.engine}</p>
                </div>
                <Pill tone={analysis.isTrainedModel ? 'sage' : 'amber'} className="small">
                  {analysis.isTrainedModel ? 'Trained model' : 'Screening rules'}
                </Pill>
              </div>

              <div className="result-hero">
                <span className={`card-icon ${analysis.isTrainedModel ? '' : 'amber'}`} style={{ width: 46, height: 46 }}>
                  <Sparkles size={22} />
                </span>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div className="label">{analysis.predictedClass}</div>
                  <div className="sub">{analysis.label}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="small muted">Confidence</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 600, color: 'var(--forest)' }}>
                    {percent(analysis.confidence)}
                  </div>
                </div>
              </div>

              <ConfidenceBars topK={analysis.topK} />

              <div className="note">
                {analysis.note ??
                  'Produced by the active FIELDZY engine. No accuracy is claimed unless it was measured on a separate evaluation set.'}
              </div>

              {observation ? (
                <div style={{ marginTop: 12 }}>
                  <Banner tone="amber" icon={<CheckCircle2 size={16} />}>
                    <strong>Observation created:</strong> {observation.title}. Status {statusMeta(observation.status).label}
                    {' · '}
                    {observation.evidenceGaps.length} evidence gap(s). The Evidence Debt Meter now reflects it.
                  </Banner>
                </div>
              ) : (
                <div className="row between" style={{ marginTop: 14 }}>
                  <span className="small muted">Not yet part of the observation record</span>
                  <button className="btn primary small" onClick={createObservation} disabled={creating}>
                    {creating ? <Spinner light /> : <Send size={14} />} Create observation
                  </button>
                </div>
              )}
            </Card>
          ) : (
            <Card>
              <div className="card-head">
                <div>
                  <h3>What the screen measures</h3>
                  <p className="card-sub">Transparent features, not a black box.</p>
                </div>
                <span className="card-icon">
                  <Microscope size={16} />
                </span>
              </div>
              <ul className="small" style={{ paddingLeft: 16, margin: 0, color: 'var(--ink-soft)' }}>
                <li>Necrotic, chlorotic and rust-toned leaf area shares.</li>
                <li>Local-contrast spot detection for lesions and pustules.</li>
                <li>Powdery surface reflectance and water-soaked darkness.</li>
                <li>Capture sharpness, exposure and resolution, reported separately from the prediction.</li>
              </ul>
              <div className="note">
                When the TensorFlow SavedModel is installed, the prediction comes from that model instead and these
                features are used only for capture quality.
              </div>
            </Card>
          )}

          <Card>
            <div className="card-head">
              <div>
                <h3>Model status</h3>
                <p className="card-sub">Read from the backend at load time.</p>
              </div>
            </div>
            {status ? (
              <>
                <dl className="kv">
                  <dt>Installed model</dt>
                  <dd>{plantStatus?.trainedModelInstalled ? 'Yes' : 'No'}</dd>
                  <dt>Engine in use</dt>
                  <dd>{plantStatus?.activeEngine}</dd>
                  <dt>Expected path</dt>
                  <dd className="tiny" style={{ wordBreak: 'break-all' }}>{plantStatus?.expectedModelPath}</dd>
                  <dt>Labels</dt>
                  <dd>{plantStatus?.labels?.length ?? 0} classes</dd>
                </dl>
                <div className="note">{plantStatus?.detail}</div>
                {!plantStatus?.trainedModelInstalled ? (
                  <div style={{ marginTop: 12 }}>
                    <Banner tone="amber" icon={<AlertTriangle size={16} />}>
                      TensorFlow and a SavedModel are not installed here. Every result is marked{' '}
                      <strong>screening</strong> and the evidence engine attaches a “model artefact not installed” gap
                      automatically.
                    </Banner>
                  </div>
                ) : null}
              </>
            ) : (
              <LoadingBlock lines={4} />
            )}
          </Card>
        </div>
      </div>

      <section className="section">
        <SectionHead title="Previous plant analyses" hint="Only analyses actually run in this deployment" />
        <Card className="flush">
          {history.loading && !history.data ? (
            <div style={{ padding: 22 }}>
              <LoadingBlock lines={4} />
            </div>
          ) : analyses.length === 0 ? (
            <div style={{ padding: 22 }}>
              <Empty title="No analyses yet">Upload a leaf photograph to create the first record.</Empty>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Prediction</th>
                    <th>Field</th>
                    <th>Confidence</th>
                    <th>Capture quality</th>
                    <th>Engine</th>
                    <th>Observation</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {analyses.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.fileName}
                            style={{ width: 54, height: 54, objectFit: 'cover', borderRadius: 9, border: '1px solid var(--hairline)' }}
                          />
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                      <td>
                        <strong>{item.predictedClass}</strong>
                        <div className="tiny muted">{item.fileName}</div>
                      </td>
                      <td>{item.fieldName || 'Unassigned'}</td>
                      <td className="mono">{percent(item.confidence)}</td>
                      <td className="mono">{percent(item.quality?.score)}</td>
                      <td className="tiny">{item.isTrainedModel ? 'trained model' : 'screening rules'}</td>
                      <td>
                        {item.observationId ? (
                          <Pill tone="amber" className="small">
                            linked
                          </Pill>
                        ) : (
                          <span className="muted small">not linked</span>
                        )}
                      </td>
                      <td className="small muted nowrap">{relativeTime(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <div className="section">
        <Banner tone="forest">
          <strong>Planned plant-model work.</strong> Agricultural dataset evaluation, crop-specific classification,
          fine-tuning where suitable, stronger image-quality validation, independent validation and reported precision,
          recall, F1 and confusion matrices. None of these improvements are claimed yet.
        </Banner>
      </div>
    </div>
  )
}
