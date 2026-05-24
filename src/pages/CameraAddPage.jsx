import { useEffect, useMemo, useState } from 'react'
import { analyzeStickerCodesFromImage, normalizeImageFileToBitmap } from '../utils/cameraCodeAnalyzer'

function ResultCard({ item, selectable, checked, onToggle, onManualCodeChange }) {
  return (
    <li className="camera-card-item">
      <div className="camera-card-top">
        <img src={item.thumbUrl} alt="Zona detectada" className="camera-thumb" />
        <div>
          <p className="camera-card-code">{item.code || 'No leído'}</p>
          <p className="camera-card-meta">{Math.round(item.confidence)}% · {item.status || item.reason || 'Revisar'}</p>
        </div>
      </div>
      <div className="camera-card-actions">
        {selectable ? (
          <label className="camera-select-item"><input type="checkbox" checked={checked} onChange={() => onToggle(item.id)} />Guardar</label>
        ) : null}
        <input
          type="text"
          value={item.manualCode || ''}
          onChange={(event) => onManualCodeChange(item.id, event.target.value)}
          placeholder="Corregir código"
          maxLength={6}
        />
      </div>
    </li>
  )
}

export default function CameraAddPage({ stickers, onApplyDetectedSticker }) {
  const [imageFile, setImageFile] = useState(null)
  const [isReading, setIsReading] = useState(false)
  const [readError, setReadError] = useState('')
  const [results, setResults] = useState({ good: [], review: [], invalid: [] })
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [debugRegions, setDebugRegions] = useState([])
  const [imageMeta, setImageMeta] = useState({ width: 1, height: 1 })
  const debugEnabled = useMemo(() => new URLSearchParams(window.location.search).get('cameraDebug') === '1', [])
  const validCodeSet = useMemo(() => new Set(stickers.map((item) => String(item.code || '').toUpperCase())), [stickers])

  const previewUrl = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : ''), [imageFile])

  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl])

  const handleFileChange = (event) => {
    const file = event.target.files?.[0]
    setImageFile(file || null)
    setResults({ good: [], review: [], invalid: [] })
    setSelectedIds(new Set())
    setDebugRegions([])
    setImageMeta({ width: 1, height: 1 })
    setReadError('')
  }

  const openCameraCapture = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.capture = 'environment'
    input.onchange = handleFileChange
    input.click()
  }

  const openImagePicker = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = handleFileChange
    input.click()
  }

  const handleRunOCR = async () => {
    if (!imageFile) return setReadError('Primero elige una imagen o toma una foto.')
    setIsReading(true)
    setReadError('')
    try {
      const tesseractModule = await import('https://esm.sh/tesseract.js@5?bundle')
      const recognize = tesseractModule.recognize || tesseractModule.default?.recognize
      if (!recognize) throw new Error('No se pudo inicializar OCR.')

      const bitmap = await normalizeImageFileToBitmap(imageFile)
      setImageMeta({ width: bitmap.width, height: bitmap.height })
      const { grouped, regions } = await analyzeStickerCodesFromImage(recognize, bitmap, stickers)
      setDebugRegions(debugEnabled ? regions : [])
      setResults(grouped)
      setSelectedIds(new Set(grouped.good.map((item) => item.id)))
    } catch (error) {
      setReadError(error?.message || 'Error leyendo la imagen.')
    } finally {
      setIsReading(false)
    }
  }

  const updateManualCode = (id, value) => {
    const update = (arr) => arr.map((item) => (item.id === id ? { ...item, manualCode: value.toUpperCase().replace(/\s+/g, '') } : item))
    setResults((current) => ({ ...current, good: update(current.good), review: update(current.review), invalid: update(current.invalid) }))
  }

  const toggleSelection = (id) => setSelectedIds((current) => {
    const next = new Set(current)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handleSaveSelected = () => {
    const all = [...results.good, ...results.review]
    const picked = all
      .filter((item) => selectedIds.has(item.id))
      .map((item) => (item.manualCode || item.code || '').toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter(Boolean)
      .filter((code) => validCodeSet.has(code))
    if (!picked.length) return
    if (!window.confirm(`Se guardarán ${picked.length} códigos. Revisa antes de confirmar.`)) return
    picked.forEach((code) => onApplyDetectedSticker(code))
  }

  const renderList = (title, list, selectable) => (
    <section className="camera-result-block">
      <h3>{title}</h3>
      <ul className="camera-result-list">
        {list.map((item) => (
          <ResultCard key={item.id} item={item} selectable={selectable} checked={selectedIds.has(item.id)} onToggle={toggleSelection} onManualCodeChange={updateManualCode} />
        ))}
        {!list.length ? <li className="camera-empty">Sin resultados.</li> : null}
      </ul>
    </section>
  )

  return (
    <section className="camera-page">
      <header className="camera-header-card">
        <p className="camera-kicker">Experimental</p>
        <h1>Agregar estampitas con fotografía</h1>
        <p className="camera-warning">Esta función está en prueba. Revisa los códigos antes de guardar.</p>
        <p className="camera-empty">Para mejores resultados, coloca las estampitas con el código visible, buena luz y evita que una tape el código de otra.</p>
      </header>
      <div className="camera-input-card">
        <span>Tomar foto o subir imagen</span>
        <div className="camera-actions">
          <button type="button" onClick={openCameraCapture}>Abrir cámara</button>
          <button type="button" onClick={openImagePicker}>Subir imagen</button>
        </div>
      </div>
      {previewUrl ? (
        <div className="camera-preview-wrap">
          <img className="camera-preview" src={previewUrl} alt="Vista previa" />
          {debugRegions.map((r, idx) => (
            <span
              key={`r-${idx}`}
              className="camera-debug-box"
              style={{
                left: `${(r.x / imageMeta.width) * 100}%`,
                top: `${(r.y / imageMeta.height) * 100}%`,
                width: `${(r.width / imageMeta.width) * 100}%`,
                height: `${(r.height / imageMeta.height) * 100}%`,
              }}
            />
          ))}
        </div>
      ) : null}
      <div className="camera-actions"><button type="button" onClick={handleRunOCR} disabled={isReading || !imageFile}>{isReading ? 'Leyendo imagen…' : 'Analizar imagen'}</button><button type="button" onClick={handleSaveSelected} disabled={!selectedIds.size}>Guardar seleccionadas ({selectedIds.size})</button></div>
      {readError ? <p className="camera-error">{readError}</p> : null}
      {renderList('Reconocidas con buena confianza', results.good, true)}
      {renderList('Posibles coincidencias para revisar', results.review, true)}
      {renderList('Descartadas / no válidas', results.invalid, false)}
    </section>
  )
}
