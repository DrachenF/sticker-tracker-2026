import { useEffect, useMemo, useState } from 'react'
import { classifyDetectedCodes } from '../utils/ocrStickerCodes'

function SelectableList({ title, items, selectable = false, selectedCodes = new Set(), onToggle }) {
  return (
    <section className="camera-result-block">
      <h3>{title}</h3>
      {!items.length ? <p className="camera-empty">Sin resultados.</p> : null}
      <ul className="camera-result-list">
        {items.map((item) => {
          const checked = selectedCodes.has(item.code)
          return (
            <li key={`${title}-${item.code}`}>
              {selectable ? (
                <label className="camera-select-item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(item.code)}
                  />
                  <span>{item.code}</span>
                </label>
              ) : (
                <span>{item.code}</span>
              )}
              <small>
                {Math.round(item.confidence)}%
                {item.reason ? ` · ${item.reason}` : ''}
              </small>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function normalizeSelectionSet(items) {
  return new Set(items.map((item) => item.code))
}

export default function CameraAddPage({ stickers, onApplyDetectedSticker }) {
  const [imageFile, setImageFile] = useState(null)
  const [isReading, setIsReading] = useState(false)
  const [readError, setReadError] = useState('')
  const [results, setResults] = useState({ good: [], review: [], invalid: [] })
  const [selectedCodes, setSelectedCodes] = useState(new Set())

  const previewUrl = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : ''), [imageFile])

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const handleFileChange = (event) => {
    const file = event.target.files?.[0]
    setImageFile(file || null)
    setResults({ good: [], review: [], invalid: [] })
    setSelectedCodes(new Set())
    setReadError('')
  }

  const handleRunOCR = async () => {
    if (!imageFile) {
      setReadError('Primero elige una imagen o toma una foto.')
      return
    }

    setIsReading(true)
    setReadError('')

    try {
      const tesseractModule = await import('https://esm.sh/tesseract.js@5?bundle')
      const recognize = tesseractModule.recognize || tesseractModule.default?.recognize

      if (!recognize) {
        throw new Error('No se pudo inicializar el OCR local.')
      }

      const ocrResult = await recognize(imageFile, 'eng')
      const parsed = classifyDetectedCodes({
        text: ocrResult?.data?.text || '',
        words: ocrResult?.data?.words || [],
        stickers,
        minConfidence: 60,
      })

      setResults(parsed)
      setSelectedCodes(normalizeSelectionSet(parsed.good))
    } catch (error) {
      setReadError(error?.message || 'Ocurrió un error al leer la imagen.')
    } finally {
      setIsReading(false)
    }
  }

  const handleToggleCode = (code) => {
    setSelectedCodes((current) => {
      const next = new Set(current)
      if (next.has(code)) {
        next.delete(code)
      } else {
        next.add(code)
      }
      return next
    })
  }

  const handleSaveSelected = () => {
    if (!selectedCodes.size) {
      return
    }

    const confirmed = window.confirm(
      `Se guardarán ${selectedCodes.size} estampitas detectadas. Verifica que los códigos sean correctos.`,
    )

    if (!confirmed) {
      return
    }

    selectedCodes.forEach((code) => {
      onApplyDetectedSticker(code)
    })
  }

  const selectableItems = [...results.good, ...results.review]

  return (
    <section className="camera-page">
      <header className="camera-header-card">
        <p className="camera-kicker">Experimental</p>
        <h1>Agregar estampitas con fotografía</h1>
        <p className="camera-warning">Esta función está en prueba. Revisa los códigos antes de guardar.</p>
      </header>

      <label className="camera-input-card">
        <span>Tomar foto o subir imagen</span>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileChange}
        />
      </label>

      {previewUrl ? <img className="camera-preview" src={previewUrl} alt="Vista previa para OCR" /> : null}

      <div className="camera-actions">
        <button type="button" onClick={handleRunOCR} disabled={isReading || !imageFile}>
          {isReading ? 'Leyendo imagen…' : 'Analizar imagen'}
        </button>
        <button
          type="button"
          onClick={handleSaveSelected}
          disabled={!selectableItems.length || selectedCodes.size === 0}
        >
          Guardar seleccionadas ({selectedCodes.size})
        </button>
      </div>

      {readError ? <p className="camera-error">{readError}</p> : null}

      <SelectableList
        title="Reconocidas con buena confianza"
        items={results.good}
        selectable
        selectedCodes={selectedCodes}
        onToggle={handleToggleCode}
      />
      <SelectableList
        title="Posibles coincidencias para revisar"
        items={results.review}
        selectable
        selectedCodes={selectedCodes}
        onToggle={handleToggleCode}
      />
      <SelectableList
        title="Descartadas / no válidas"
        items={results.invalid}
      />
    </section>
  )
}
