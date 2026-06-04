import { useEffect, useMemo, useRef, useState } from 'react'
import StickerCard from '../components/StickerCard'
import { getAccentColorForTeam } from '../utils/teamAccents'
import {
  QR_EXCHANGE_ERROR,
  appCodeToCanonicalId,
  buildMyExchangeSets,
  buildQrImageUrl,
  canonicalIdToAppCode,
  compareExchange,
  decodeExchangeText,
  encodeExchangeText,
} from '../utils/qrExchangeCodec'

const UNEVEN_WARNING = 'La cantidad recibida y entregada no es igual. Confirma si este intercambio es correcto.'

function getBarcodeDetector() {
  if (!('BarcodeDetector' in window)) {
    return null
  }

  return new window.BarcodeDetector({ formats: ['qr_code', 'aztec', 'data_matrix', 'pdf417'] })
}

function getStickerMeta(sticker) {
  return sticker?.teamCode || sticker?.section || 'base'
}

function CodeList({ title, codes }) {
  return (
    <div className="exchange-code-list">
      <strong>{title}</strong>
      <p>{codes.length ? codes.join(', ') : 'Sin seleccionadas.'}</p>
    </div>
  )
}

function SelectableStickerGrid({ title, helper, codes, selectedCodes, stickersByCanonicalCode, collection, context, onToggle }) {
  return (
    <section className="exchange-column">
      <header className="exchange-column-header">
        <div>
          <p className="camera-kicker">{codes.length} útiles</p>
          <h2>{title}</h2>
        </div>
        <span className="exchange-selection-count">{selectedCodes.size} seleccionadas</span>
      </header>
      <p className="camera-empty">{helper}</p>
      <div className="exchange-sticker-grid">
        {codes.map((canonicalCode) => {
          const appCode = canonicalIdToAppCode(canonicalCode)
          const sticker = stickersByCanonicalCode[canonicalCode]
          const isSelected = selectedCodes.has(canonicalCode)

          if (!sticker) {
            return (
              <button
                key={canonicalCode}
                type="button"
                className={`exchange-unknown-sticker ${isSelected ? 'is-selected' : ''}`}
                onClick={() => onToggle(canonicalCode)}
              >
                {canonicalCode}
              </button>
            )
          }

          const state = context === 'duplicates'
            ? { owned: true, duplicates: Math.max(1, collection[appCode]?.duplicates ?? 1), pasted: false }
            : { owned: false, duplicates: 0, pasted: false }

          return (
            <div key={canonicalCode} className={`exchange-selectable-card ${isSelected ? 'is-selected' : ''}`}>
              <StickerCard
                sticker={sticker}
                stickerState={state}
                accentColor={getAccentColorForTeam(getStickerMeta(sticker))}
                context={context}
                variant="album-grid"
                onToggleOwned={() => onToggle(canonicalCode)}
                onTogglePasted={() => {}}
                onIncrementDuplicates={() => {}}
                onDecrementDuplicates={() => {}}
              />
              <span className="exchange-selected-badge">{isSelected ? 'Elegida' : 'Tocar para elegir'}</span>
            </div>
          )
        })}
      </div>
      {!codes.length ? <p className="camera-empty">No hay coincidencias útiles en este lado.</p> : null}
    </section>
  )
}

export default function CameraAddPage({
  stickers,
  collection,
  onApplyQrExchange,
  onMarkQrObtainedElsewhere,
  onUndoQrExchange,
  canUndoQrExchange,
}) {
  const fileInputRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const scanLoopRef = useRef(0)
  const [isScanning, setIsScanning] = useState(false)
  const [isReading, setIsReading] = useState(false)
  const [error, setError] = useState('')
  const [decodedExchange, setDecodedExchange] = useState(null)
  const [selectedReceive, setSelectedReceive] = useState(new Set())
  const [selectedGive, setSelectedGive] = useState(new Set())
  const [generatedText, setGeneratedText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [exchangeMessage, setExchangeMessage] = useState('')
  const [lastApplied, setLastApplied] = useState(null)

  const stickersByCanonicalCode = useMemo(() => {
    return stickers.reduce((acc, sticker) => {
      acc[appCodeToCanonicalId(sticker.code)] = sticker
      return acc
    }, {})
  }, [stickers])

  const mySets = useMemo(() => buildMyExchangeSets(stickers, collection), [stickers, collection])

  const stopCamera = () => {
    window.cancelAnimationFrame(scanLoopRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setIsScanning(false)
  }

  useEffect(() => () => stopCamera(), [])

  const applyDecodedText = async (rawText) => {
    setIsReading(true)
    setError('')
    setExchangeMessage('')

    try {
      const decoded = await decodeExchangeText(rawText)
      const comparison = compareExchange({
        ...mySets,
        theirMissing: decoded.theirMissing,
        theirDuplicates: decoded.theirDuplicates,
      })

      setDecodedExchange({ ...decoded, ...comparison })
      setSelectedReceive(new Set())
      setSelectedGive(new Set())
      stopCamera()
    } catch (decodeError) {
      setError(decodeError.message || QR_EXCHANGE_ERROR)
    } finally {
      setIsReading(false)
    }
  }

  const startCameraScan = async () => {
    setError('')
    const detector = getBarcodeDetector()

    if (!detector) {
      setError('Tu navegador no soporta lectura directa de QR. Usa “Subir imagen de QR”.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setIsScanning(true)

      const scan = async () => {
        if (!streamRef.current || !videoRef.current) {
          return
        }

        try {
          const barcodes = await detector.detect(videoRef.current)
          const value = barcodes.find((barcode) => barcode.rawValue)?.rawValue

          if (value) {
            await applyDecodedText(value)
            return
          }
        } catch {
          // Keep scanning; some frames may not be readable.
        }

        scanLoopRef.current = window.requestAnimationFrame(scan)
      }

      scanLoopRef.current = window.requestAnimationFrame(scan)
    } catch {
      setError('No se pudo abrir la cámara. Revisa permisos o sube una imagen del QR.')
    }
  }

  const handleImageUpload = async (file) => {
    if (!file) {
      return
    }

    setError('')
    const detector = getBarcodeDetector()

    if (!detector) {
      setError('Tu navegador no soporta leer QR desde imagen en esta app.')
      return
    }

    setIsReading(true)
    try {
      const bitmap = await createImageBitmap(file)
      const barcodes = await detector.detect(bitmap)
      bitmap.close?.()
      const value = barcodes.find((barcode) => barcode.rawValue)?.rawValue

      if (!value) {
        throw new Error(QR_EXCHANGE_ERROR)
      }

      await applyDecodedText(value)
    } catch (uploadError) {
      setError(uploadError.message || QR_EXCHANGE_ERROR)
    } finally {
      setIsReading(false)
      fileInputRef.current.value = ''
    }
  }

  const handleGenerateQr = async () => {
    setIsGenerating(true)
    setError('')

    try {
      const text = await encodeExchangeText({
        missingIds: mySets.myMissing,
        duplicateIds: mySets.myDuplicates,
      })
      setGeneratedText(text)
    } catch (generateError) {
      setError(generateError.message || 'No se pudo generar tu QR de intercambio.')
    } finally {
      setIsGenerating(false)
    }
  }

  const toggleSetCode = (setter, code) => {
    setter((current) => {
      const next = new Set(current)
      if (next.has(code)) {
        next.delete(code)
      } else {
        next.add(code)
      }
      return next
    })
  }

  const handleConfirmExchange = () => {
    const receiveCodes = Array.from(selectedReceive)
    const giveCodes = Array.from(selectedGive)

    if (!receiveCodes.length && !giveCodes.length) {
      setError('Selecciona al menos una figurita para intercambiar.')
      return
    }

    if (receiveCodes.length !== giveCodes.length && !window.confirm(UNEVEN_WARNING)) {
      return
    }

    const applied = onApplyQrExchange(receiveCodes, giveCodes)
    setLastApplied({ receiveCodes, giveCodes, appliedAt: Date.now() })
    setSelectedReceive(new Set())
    setSelectedGive(new Set())
    setExchangeMessage(applied?.message || 'Intercambio aplicado correctamente')
    setError('')
  }

  const handleMarkElsewhere = () => {
    const receiveCodes = Array.from(selectedReceive)

    if (!receiveCodes.length) {
      setError('Selecciona cartas de “Te puede dar” para marcarlas como obtenidas por otro método.')
      return
    }

    onMarkQrObtainedElsewhere(receiveCodes)
    setSelectedReceive(new Set())
    setExchangeMessage('Figuritas marcadas como obtenidas por otro método.')
    setError('')
  }

  const hasSelection = selectedReceive.size > 0 || selectedGive.size > 0

  return (
    <section className="camera-page exchange-page">
      <header className="camera-header-card">
        <p className="camera-kicker">Intercambio QR</p>
        <h1>Códigos compatibles</h1>
        <p className="camera-warning">Lee o genera códigos de “Figuritas App - Usa Méx Can 26” sin modificar tu inventario hasta confirmar el intercambio.</p>
      </header>

      <div className="camera-input-card">
        <div className="camera-actions exchange-primary-actions">
          <button type="button" onClick={startCameraScan} disabled={isScanning || isReading}>Escanear QR de intercambio</button>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isReading}>Subir imagen de QR</button>
          <button type="button" onClick={handleGenerateQr} disabled={isGenerating}>{isGenerating ? 'Generando…' : 'Generar mi QR'}</button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(event) => handleImageUpload(event.target.files?.[0])} />
        <div className={`exchange-camera-view ${isScanning ? 'is-active' : ''}`}>
          <video ref={videoRef} playsInline muted aria-label="Vista de cámara para escanear QR" />
          {isScanning ? <button type="button" onClick={stopCamera}>Cerrar cámara</button> : null}
        </div>
      </div>

      {error ? <p className="camera-error">{error}</p> : null}
      {exchangeMessage ? <p className="exchange-success">{exchangeMessage}</p> : null}

      {generatedText ? (
        <section className="camera-result-block exchange-generated-card">
          <header className="exchange-column-header">
            <div>
              <p className="camera-kicker">Mi código</p>
              <h2>QR para que escaneen tu inventario</h2>
            </div>
          </header>
          <img src={buildQrImageUrl(generatedText)} alt="QR de intercambio generado" className="exchange-qr-image" />
          <textarea readOnly value={generatedText} aria-label="Texto completo del QR generado" />
          <p className="camera-empty">El QR usa faltantes y repetidas actuales. Las repetidas se guardan como sí/no, sin cantidades.</p>
        </section>
      ) : null}

      {decodedExchange ? (
        <>
          <section className="camera-result-block exchange-summary-card">
            <p className="camera-kicker">Código leído</p>
            <div className="exchange-summary-grid">
              <span>Faltantes detectados: <strong>{decodedExchange.theirMissing.length}</strong></span>
              <span>Repetidas detectadas: <strong>{decodedExchange.theirDuplicates.length}</strong></span>
              <span>Bytes por bloque: <strong>{decodedExchange.blockBytes.missing}/{decodedExchange.blockBytes.duplicates}</strong></span>
              <span>{decodedExchange.hasCocaCola ? 'Incluye espacio Coca-Cola' : 'Álbum base'}</span>
            </div>
            {decodedExchange.unknownIds.length ? <p className="camera-warning">Se detectaron códigos futuros o desconocidos: {decodedExchange.unknownIds.join(', ')}.</p> : null}
          </section>

          <div className={`exchange-columns ${lastApplied ? 'is-exchange-applied' : ''}`}>
            <SelectableStickerGrid
              title="Te puede dar"
              helper="Repetidas de esa persona que están en tus faltantes. Selecciona solo las que recibirás."
              codes={decodedExchange.theyCanGiveMe}
              selectedCodes={selectedReceive}
              stickersByCanonicalCode={stickersByCanonicalCode}
              collection={collection}
              context="missing"
              onToggle={(code) => toggleSetCode(setSelectedReceive, code)}
            />
            <SelectableStickerGrid
              title="Le puedes dar"
              helper="Tus repetidas que están en sus faltantes. Selecciona solo las que entregarás."
              codes={decodedExchange.iCanGiveThem}
              selectedCodes={selectedGive}
              stickersByCanonicalCode={stickersByCanonicalCode}
              collection={collection}
              context="duplicates"
              onToggle={(code) => toggleSetCode(setSelectedGive, code)}
            />
          </div>

          <section className="camera-result-block exchange-confirm-card">
            <p className="camera-kicker">Confirmación</p>
            <h2>Intercambiar seleccionadas</h2>
            <p>Vas a recibir: <strong>{selectedReceive.size} figuritas</strong></p>
            <p>Vas a entregar: <strong>{selectedGive.size} figuritas</strong></p>
            {hasSelection && selectedReceive.size !== selectedGive.size ? <p className="camera-warning">{UNEVEN_WARNING}</p> : null}
            <CodeList title="Recibes" codes={Array.from(selectedReceive)} />
            <CodeList title="Entregas" codes={Array.from(selectedGive)} />
            <div className="camera-actions">
              <button type="button" onClick={handleConfirmExchange} disabled={!hasSelection}>Intercambiar seleccionadas</button>
              <button type="button" className="secondary-button" onClick={handleMarkElsewhere} disabled={!selectedReceive.size}>Obtenidas por otro método</button>
              <button type="button" className="secondary-button" onClick={onUndoQrExchange} disabled={!canUndoQrExchange}>Deshacer último intercambio</button>
            </div>
          </section>
        </>
      ) : null}
    </section>
  )
}
