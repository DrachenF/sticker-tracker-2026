import { useEffect, useMemo, useState } from 'react'
import { classifyZoneReadings, detectCodeLabelRegions } from '../utils/ocrStickerCodes'

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

  const runZoneOCR = async (recognize, bitmap, zone, zoneIndex) => {
    const attempts = [
      { rotate: 0, invert: false },
      { rotate: 0, invert: true },
      { rotate: 90, invert: false },
      { rotate: 270, invert: false },
      { rotate: 180, invert: false },
    ]

    let best = { confidence: 0, rawText: '' }
    for (const attempt of attempts) {
      const workerCanvas = document.createElement('canvas')
      workerCanvas.width = zone.width * 2
      workerCanvas.height = zone.height * 2
      const ctx = workerCanvas.getContext('2d')
      ctx.drawImage(bitmap, zone.x, zone.y, zone.width, zone.height, 0, 0, workerCanvas.width, workerCanvas.height)
      if (attempt.invert) {
        const imageData = ctx.getImageData(0, 0, workerCanvas.width, workerCanvas.height)
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] = 255 - imageData.data[i]
          imageData.data[i + 1] = 255 - imageData.data[i + 1]
          imageData.data[i + 2] = 255 - imageData.data[i + 2]
        }
        ctx.putImageData(imageData, 0, 0)
      }

      const result = await recognize(workerCanvas, 'eng', {
        rotateAuto: false,
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      })
      const confidence = Number(result?.data?.confidence ?? 0)
      const rawText = String(result?.data?.text || '')
      if (confidence > best.confidence) {
        best = { confidence, rawText }
      }
    }

    return {
      id: `zone-${zoneIndex}`,
      ...best,
      region: zone,
      thumbUrl: workerCanvasToUrl(bitmap, zone),
      manualCode: '',
    }
  }

  const workerCanvasToUrl = (bitmap, zone) => {
    const c = document.createElement('canvas')
    c.width = zone.width
    c.height = zone.height
    const cx = c.getContext('2d')
    cx.drawImage(bitmap, zone.x, zone.y, zone.width, zone.height, 0, 0, zone.width, zone.height)
    return c.toDataURL('image/jpeg', 0.86)
  }

  const handleRunOCR = async () => {
    if (!imageFile) return setReadError('Primero elige una imagen o toma una foto.')
    setIsReading(true)
    setReadError('')
    try {
      const tesseractModule = await import('https://esm.sh/tesseract.js@5?bundle')
      const recognize = tesseractModule.recognize || tesseractModule.default?.recognize
      if (!recognize) throw new Error('No se pudo inicializar OCR.')

      const bitmap = await createImageBitmap(imageFile)
      setImageMeta({ width: bitmap.width, height: bitmap.height })
      const regions = detectCodeLabelRegions(bitmap)
      setDebugRegions(debugEnabled ? regions : [])

      const zoneReadings = []
      for (let i = 0; i < regions.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const zoneResult = await runZoneOCR(recognize, bitmap, regions[i], i)
        zoneReadings.push(zoneResult)
      }

      const grouped = classifyZoneReadings(zoneReadings, stickers)
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
