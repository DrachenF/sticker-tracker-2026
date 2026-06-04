import { useEffect, useMemo, useRef, useState } from 'react'
import StickerCard from '../components/StickerCard'
import { buildSections } from '../utils/collectionStats'
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

function SelectableSticker({ canonicalCode, selectedCodes, stickersByCanonicalCode, collection, context, onToggle }) {
  const appCode = canonicalIdToAppCode(canonicalCode)
  const sticker = stickersByCanonicalCode[canonicalCode]
  const isSelected = selectedCodes.has(canonicalCode)

  if (!sticker) {
    return (
      <button
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
    <div className={`exchange-selectable-card ${isSelected ? 'is-selected' : ''}`}>
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
        {codes.map((canonicalCode) => (
          <SelectableSticker
            key={canonicalCode}
            canonicalCode={canonicalCode}
            selectedCodes={selectedCodes}
            stickersByCanonicalCode={stickersByCanonicalCode}
            collection={collection}
            context={context}
            onToggle={onToggle}
          />
        ))}
      </div>
      {!codes.length ? <p className="camera-empty">No hay coincidencias útiles en este lado.</p> : null}
    </section>
  )
}

function ManualAccordionList({ title, helper, sections, selectedCodes, stickersByCanonicalCode, collection, context, onToggle }) {
  return (
    <section className="exchange-column manual-exchange-list">
      <header className="exchange-column-header">
        <div>
          <p className="camera-kicker">{sections.reduce((total, section) => total + section.stickers.length, 0)} disponibles</p>
          <h2>{title}</h2>
        </div>
        <span className="exchange-selection-count">{selectedCodes.size} seleccionadas</span>
      </header>
      <p className="camera-empty">{helper}</p>
      <div className="manual-section-stack">
        {sections.map((section, index) => (
          <details key={section.id} className="manual-section-accordion" open={index === 0}>
            <summary>
              <span>{section.flagUrl ? <img src={section.flagUrl} alt="" /> : section.emoji}</span>
              <strong>{section.title}</strong>
              <em>{section.stickers.length}</em>
            </summary>
            <div className="exchange-sticker-grid">
              {section.stickers.map((sticker) => {
                const canonicalCode = appCodeToCanonicalId(sticker.code)
                return (
                  <SelectableSticker
                    key={canonicalCode}
                    canonicalCode={canonicalCode}
                    selectedCodes={selectedCodes}
                    stickersByCanonicalCode={stickersByCanonicalCode}
                    collection={collection}
                    context={context}
                    onToggle={onToggle}
                  />
                )
              })}
            </div>
          </details>
        ))}
      </div>
      {!sections.length ? <p className="camera-empty">No hay cartas para mostrar en esta lista.</p> : null}
    </section>
  )
}

function ReviewSelectedCards({ title, helper, codes, selectedCodes, stickersByCanonicalCode, collection, context, onToggle }) {
  return (
    <section className="exchange-review-column">
      <header className="exchange-column-header">
        <div>
          <p className="camera-kicker">{codes.length} seleccionadas</p>
          <h3>{title}</h3>
        </div>
      </header>
      <p className="camera-empty">{helper}</p>
      <div className="exchange-sticker-grid exchange-review-grid">
        {codes.map((canonicalCode) => (
          <SelectableSticker
            key={canonicalCode}
            canonicalCode={canonicalCode}
            selectedCodes={selectedCodes}
            stickersByCanonicalCode={stickersByCanonicalCode}
            collection={collection}
            context={context}
            onToggle={onToggle}
          />
        ))}
      </div>
      {!codes.length ? <p className="camera-empty">Sin seleccionadas.</p> : null}
    </section>
  )
}

function ReviewExchange({
  mode,
  selectedReceive,
  selectedGive,
  stickersByCanonicalCode,
  collection,
  onConfirm,
  onMarkElsewhere,
  onUndo,
  canUndo,
  onBackToManual,
  onToggleReceive,
  onToggleGive,
}) {
  const hasSelection = selectedReceive.size > 0 || selectedGive.size > 0
  const receiveCodes = Array.from(selectedReceive)
  const giveCodes = Array.from(selectedGive)
  const isManual = mode === 'manual'

  return (
    <section className="camera-result-block exchange-confirm-card">
      <p className="camera-kicker">{isManual ? 'Revisión manual' : 'Confirmación QR'}</p>
      <h2>{isManual ? 'Revisar intercambio' : 'Intercambiar seleccionadas'}</h2>
      <p>{isManual ? 'Él/Ella me puede dar' : 'Vas a recibir'}: <strong>{selectedReceive.size} figuritas</strong></p>
      <p>{isManual ? 'Yo puedo dar' : 'Vas a entregar'}: <strong>{selectedGive.size} figuritas</strong></p>
      {hasSelection && selectedReceive.size !== selectedGive.size ? <p className="camera-warning">{UNEVEN_WARNING}</p> : null}
      <div className="exchange-review-columns">
        <ReviewSelectedCards
          title={isManual ? 'Él/Ella me puede dar' : 'Recibes'}
          helper={isManual ? 'Estas faltantes saldrán de tus faltantes al confirmar. Toca una carta para desmarcarla.' : 'Estas cartas se marcarán como obtenidas al confirmar. Toca una carta para desmarcarla.'}
          codes={receiveCodes}
          selectedCodes={selectedReceive}
          stickersByCanonicalCode={stickersByCanonicalCode}
          collection={collection}
          context="missing"
          onToggle={onToggleReceive}
        />
        <ReviewSelectedCards
          title={isManual ? 'Yo puedo dar' : 'Entregas'}
          helper={isManual ? 'Estas repetidas bajarán en 1 al confirmar. Toca una carta para desmarcarla.' : 'Estas repetidas bajarán en 1 al confirmar. Toca una carta para desmarcarla.'}
          codes={giveCodes}
          selectedCodes={selectedGive}
          stickersByCanonicalCode={stickersByCanonicalCode}
          collection={collection}
          context="duplicates"
          onToggle={onToggleGive}
        />
      </div>
      <div className="camera-actions">
        <button type="button" onClick={onConfirm} disabled={!hasSelection}>{isManual ? 'Intercambiar' : 'Intercambiar seleccionadas'}</button>
        {isManual ? <button type="button" className="secondary-button" onClick={onBackToManual}>Volver a seleccionar</button> : null}
        {!isManual ? <button type="button" className="secondary-button" onClick={onMarkElsewhere} disabled={!selectedReceive.size}>Obtenidas por otro método</button> : null}
        <button type="button" className="secondary-button" onClick={onUndo} disabled={!canUndo}>Deshacer último intercambio</button>
      </div>
    </section>
  )
}

export default function CameraAddPage({
  stickers,
  teams,
  collection,
  onApplyQrExchange,
  onApplyManualExchange,
  onMarkQrObtainedElsewhere,
  onUndoQrExchange,
  canUndoQrExchange,
}) {
  const fileInputRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const scanLoopRef = useRef(0)
  const [mode, setMode] = useState('qr')
  const [manualStep, setManualStep] = useState('select')
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

  const manualSections = useMemo(() => {
    const sections = buildSections(stickers, teams)
    return {
      give: sections
        .map((section) => ({
          ...section,
          stickers: section.stickers.filter((sticker) => (collection[sticker.code]?.duplicates ?? 0) > 0),
        }))
        .filter((section) => section.stickers.length),
      receive: sections
        .map((section) => ({
          ...section,
          stickers: section.stickers.filter((sticker) => !collection[sticker.code]?.owned),
        }))
        .filter((section) => section.stickers.length),
    }
  }, [stickers, teams, collection])

  const stopCamera = () => {
    window.cancelAnimationFrame(scanLoopRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setIsScanning(false)
  }

  useEffect(() => () => stopCamera(), [])

  const handleModeChange = (nextMode) => {
    stopCamera()
    setMode(nextMode)
    setManualStep('select')
    setError('')
    setExchangeMessage('')
  }

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

  const confirmWithWarning = (receiveCodes, giveCodes) => {
    return receiveCodes.length === giveCodes.length || window.confirm(UNEVEN_WARNING)
  }

  const handleConfirmExchange = () => {
    const receiveCodes = Array.from(selectedReceive)
    const giveCodes = Array.from(selectedGive)

    if (!receiveCodes.length && !giveCodes.length) {
      setError('Selecciona al menos una figurita para intercambiar.')
      return
    }

    if (!confirmWithWarning(receiveCodes, giveCodes)) {
      return
    }

    const applied = mode === 'manual'
      ? onApplyManualExchange(receiveCodes, giveCodes)
      : onApplyQrExchange(receiveCodes, giveCodes)
    setLastApplied({ receiveCodes, giveCodes, appliedAt: Date.now(), mode })
    setSelectedReceive(new Set())
    setSelectedGive(new Set())
    setManualStep('select')
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

  const hasManualSelection = selectedReceive.size > 0 || selectedGive.size > 0

  return (
    <section className="camera-page exchange-page">
      <header className="camera-header-card">
        <p className="camera-kicker">Intercambio</p>
        <h1>Intercambio de figuritas</h1>
        <p className="camera-warning">El inventario solo cambia cuando confirmas un intercambio.</p>
        <div className="exchange-mode-tabs" role="tablist" aria-label="Modos de intercambio">
          <button type="button" className={mode === 'qr' ? 'is-active' : ''} onClick={() => handleModeChange('qr')}>QR</button>
          <button type="button" className={mode === 'manual' ? 'is-active' : ''} onClick={() => handleModeChange('manual')}>Manual</button>
        </div>
      </header>

      {error ? <p className="camera-error">{error}</p> : null}
      {exchangeMessage ? <p className="exchange-success">{exchangeMessage}</p> : null}

      {mode === 'qr' ? (
        <>
          <div className="camera-input-card">
            <p className="camera-empty">Modo QR: escanea, sube una imagen o genera tu propio QR compatible.</p>
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

              <div className={`exchange-columns ${lastApplied?.mode === 'qr' ? 'is-exchange-applied' : ''}`}>
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

              <ReviewExchange
                mode="qr"
                selectedReceive={selectedReceive}
                selectedGive={selectedGive}
                stickersByCanonicalCode={stickersByCanonicalCode}
                collection={collection}
                onConfirm={handleConfirmExchange}
                onMarkElsewhere={handleMarkElsewhere}
                onUndo={onUndoQrExchange}
                canUndo={canUndoQrExchange}
                onToggleReceive={(code) => toggleSetCode(setSelectedReceive, code)}
                onToggleGive={(code) => toggleSetCode(setSelectedGive, code)}
              />
            </>
          ) : null}
        </>
      ) : (
        <>
          <section className="camera-result-block manual-exchange-intro">
            <p className="camera-kicker">Manual</p>
            <h2>Intercambio sin QR</h2>
            <p>Usa el intercambio manual cuando la otra persona no tenga QR. Selecciona manualmente lo que puedes dar y lo que te pueden dar. El inventario solo se actualiza al confirmar el intercambio.</p>
            <div className="camera-actions">
              <button type="button" onClick={() => setManualStep('select')}>Seleccionar cartas</button>
              <button type="button" className="secondary-button" onClick={() => setManualStep('review')} disabled={!hasManualSelection}>Revisar intercambio</button>
            </div>
          </section>

          {manualStep === 'select' ? (
            <div className="exchange-columns manual-exchange-columns">
              <ManualAccordionList
                title="Mis repetidas"
                helper="Estas son las figuritas que yo puedo darle a la otra persona. Seleccionarlas no cambia tu inventario todavía."
                sections={manualSections.give}
                selectedCodes={selectedGive}
                stickersByCanonicalCode={stickersByCanonicalCode}
                collection={collection}
                context="duplicates"
                onToggle={(code) => toggleSetCode(setSelectedGive, code)}
              />
              <ManualAccordionList
                title="Mis faltantes"
                helper="Estas son las figuritas que la otra persona puede darme. Seleccionarlas no las marca como conseguidas todavía."
                sections={manualSections.receive}
                selectedCodes={selectedReceive}
                stickersByCanonicalCode={stickersByCanonicalCode}
                collection={collection}
                context="missing"
                onToggle={(code) => toggleSetCode(setSelectedReceive, code)}
              />
            </div>
          ) : null}

          <ReviewExchange
            mode="manual"
            selectedReceive={selectedReceive}
            selectedGive={selectedGive}
            stickersByCanonicalCode={stickersByCanonicalCode}
            collection={collection}
            onConfirm={handleConfirmExchange}
            onUndo={onUndoQrExchange}
            canUndo={canUndoQrExchange}
            onBackToManual={() => setManualStep('select')}
            onToggleReceive={(code) => toggleSetCode(setSelectedReceive, code)}
            onToggleGive={(code) => toggleSetCode(setSelectedGive, code)}
          />
        </>
      )}
    </section>
  )
}
