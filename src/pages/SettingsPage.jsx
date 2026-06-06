import { useEffect, useRef, useState } from 'react'
import { generateQrImageAssets, schedulePreloadQrTools, readQrFromCanvas, readQrFromImageFile, readQrFromVideo } from '../utils/qrBrowserTools'

function SettingsPage({
  collection,
  actionHistory,
  onExportBackup,
  onImportBackup,
  onGenerateBackupText,
  onImportBackupText,
  onResetCollection,
  isSoundEnabled,
  onToggleSound,
}) {
  const touchedCount = Object.keys(collection).length
  const [expandedKey, setExpandedKey] = useState('')
  const [backupQrText, setBackupQrText] = useState('')
  const [backupQrImage, setBackupQrImage] = useState('')
  const [backupQrError, setBackupQrError] = useState('')
  const [isBackupQrScanning, setIsBackupQrScanning] = useState(false)
  const [isBackupQrReading, setIsBackupQrReading] = useState(false)
  const backupQrFileRef = useRef(null)
  const backupQrVideoRef = useRef(null)
  const backupQrStreamRef = useRef(null)
  const backupQrLoopRef = useRef(0)
  const previewFor = (key) => (expandedKey === key ? (actionHistory[key] || []) : (actionHistory[key] || []).slice(0, 10))

  const stopBackupQrCamera = () => {
    window.clearTimeout(backupQrLoopRef.current)
    backupQrStreamRef.current?.getTracks().forEach((track) => track.stop())
    backupQrStreamRef.current = null
    setIsBackupQrScanning(false)
  }

  useEffect(() => {
    schedulePreloadQrTools()
    return () => stopBackupQrCamera()
  }, [])

  const handleGenerateBackupQr = async () => {
    setBackupQrError('')

    try {
      const text = onGenerateBackupText()
      const { svgDataUrl: image, validationCanvas } = await generateQrImageAssets(text, {
        errorCorrectionLevel: 'M',
        quietModules: 8,
        pngSize: 1200,
      })
      const scannedText = await readQrFromCanvas(validationCanvas)

      if (scannedText !== text) {
        throw new Error('No se pudo validar visualmente el QR de respaldo generado.')
      }

      console.log('Validación QR de respaldo completa:', {
        qrStart: text.slice(0, 24),
        qrLength: text.length,
        copiedTextMatchesVisualScan: true,
      })

      setBackupQrText(text)
      setBackupQrImage(image)
    } catch (error) {
      console.error('Error leyendo QR:', error)
      setBackupQrText('')
      setBackupQrImage('')
      setBackupQrError('No se pudo generar el QR de respaldo en este navegador.')
    }
  }

  const applyBackupQrText = async (rawText) => {
    setIsBackupQrReading(true)
    setBackupQrError('')

    try {
      await onImportBackupText(rawText)
      stopBackupQrCamera()
    } catch (error) {
      console.error('Error leyendo QR:', error)
      setBackupQrError(error.message || 'No se pudo leer este QR de respaldo.')
    } finally {
      setIsBackupQrReading(false)
    }
  }

  const handleScanBackupQr = async () => {
    setBackupQrError('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      backupQrStreamRef.current = stream
      backupQrVideoRef.current.srcObject = stream
      await backupQrVideoRef.current.play()
      setIsBackupQrScanning(true)

      const scan = async () => {
        if (!backupQrStreamRef.current || !backupQrVideoRef.current) {
          return
        }

        try {
          const value = await readQrFromVideo(backupQrVideoRef.current)

          if (value) {
            await applyBackupQrText(value)
            return
          }
        } catch (error) {
          console.error('Error leyendo QR:', error)
          // Keep scanning; individual frames can fail without affecting the flow.
        }

        backupQrLoopRef.current = window.setTimeout(scan, 120)
      }

      backupQrLoopRef.current = window.setTimeout(scan, 120)
    } catch {
      setBackupQrError('No se pudo acceder a la cámara. Puedes subir una imagen del QR.')
    }
  }

  const handleBackupQrImage = async (file) => {
    if (!file) {
      return
    }

    setBackupQrError('')
    setIsBackupQrReading(true)
    try {
      const value = await readQrFromImageFile(file)
      await applyBackupQrText(value)
    } catch (error) {
      console.error('Error leyendo QR:', error)
      setBackupQrError(error.message || 'No se pudo detectar un QR en esta imagen.')
    } finally {
      setIsBackupQrReading(false)
      backupQrFileRef.current.value = ''
    }
  }

  return (
    <div className="settings-stack">
      <div className="settings-hero">
        <div className="settings-hero-icon" aria-hidden="true">
          <span />
        </div>
        <div>
          <p className="page-label">Ajustes</p>
          <h2>Tu álbum, a salvo</h2>
          <p className="page-description">
            Guarda tu progreso, portada y banderas en un respaldo privado de la app.
          </p>
        </div>
      </div>

      <section className="settings-card settings-card-featured">
        <div className="settings-card-header">
          <span className="settings-card-icon is-backup" aria-hidden="true" />
          <div>
            <p className="page-label">Sonido</p>
            <h3>Efectos de sonido</h3>
          </div>
        </div>

        <div className="settings-action-row">
          <div className="settings-note">
            {isSoundEnabled
              ? 'Los sonidos suaves están activados.'
              : 'La app está en silencio.'}
          </div>
          <button
            type="button"
            className={`action-button sound-toggle-button ${
              isSoundEnabled ? '' : 'is-off'
            }`}
            onClick={onToggleSound}
            aria-pressed={isSoundEnabled}
          >
            {isSoundEnabled ? 'Apagar sonidos' : 'Activar sonidos'}
          </button>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-icon is-save" aria-hidden="true" />
          <div>
            <p className="page-label">Respaldo</p>
            <h3>Guardar o subir respaldo</h3>
          </div>
        </div>

        <p className="settings-note settings-note-plain">
          El archivo .albu incluye estampitas, repetidas, pegadas, color del álbum
          y posición de banderas. El QR de respaldo guarda tu colección en un
          formato compacto para que cargue desde el navegador; puedes hacerle
          captura. Si lees un QR de intercambio por error, la app te avisará antes
          de convertirlo en respaldo. No incluye Coca-Cola porque esta app no guarda
          esas estampitas extra.
        </p>

        <div className="settings-actions settings-actions-large">
          <button
            type="button"
            className="action-button"
            onClick={onExportBackup}
          >
            Guardar respaldo
          </button>

          <label className="import-button" htmlFor="backup-import">
            Subir respaldo
          </label>
          <input
            id="backup-import"
            className="file-input"
            type="file"
            accept=".albu,application/octet-stream,.json,application/json"
            onChange={(event) => {
              onImportBackup(event.target.files?.[0] ?? null)
              event.target.value = ''
            }}
          />
        </div>

        <div className="settings-backup-qr-panel">
          <div className="settings-backup-qr-actions">
            <button type="button" className="action-button" onClick={handleGenerateBackupQr}>
              Generar QR de respaldo
            </button>
            <button type="button" className="action-button action-button-ghost" onClick={handleScanBackupQr} disabled={isBackupQrScanning || isBackupQrReading}>
              Leer QR con cámara
            </button>
            <button type="button" className="action-button action-button-ghost" onClick={() => backupQrFileRef.current?.click()} disabled={isBackupQrReading}>
              Leer QR desde imagen
            </button>
          </div>
          <input
            ref={backupQrFileRef}
            className="file-input"
            type="file"
            accept="image/*"
            onChange={(event) => handleBackupQrImage(event.target.files?.[0])}
          />
          <div className={`settings-backup-qr-camera ${isBackupQrScanning ? 'is-active' : ''}`}>
            <video ref={backupQrVideoRef} playsInline muted aria-label="Vista de cámara para leer QR de respaldo" />
            {isBackupQrScanning ? <button type="button" className="action-button action-button-ghost" onClick={stopBackupQrCamera}>Cerrar cámara</button> : null}
          </div>
          {backupQrText ? (
            <div className="settings-backup-qr-output">
              <img src={backupQrImage} alt="QR de respaldo generado" />
              <p className="settings-note">Haz captura de este QR para guardar tu respaldo. Si tu colección está muy grande y el QR no se lee, usa el archivo .albu.</p>
            </div>
          ) : null}
          {backupQrError ? <p className="settings-qr-error">{backupQrError}</p> : null}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-icon is-reset" aria-hidden="true" />
          <div>
            <p className="page-label">Colección</p>
            <h3>Reiniciar progreso guardado</h3>
          </div>
        </div>

        <div className="settings-action-row">
          <div className="settings-note">
            Registros guardados: {touchedCount} stickers tocados.
          </div>
          <button
            type="button"
            className="action-button button-reset"
            onClick={onResetCollection}
          >
            Reiniciar colección
          </button>
        </div>
      </section>

      {[
        ['addedOwned', 'Historial 1', 'Figuritas agregadas por primera vez'],
        ['removedOwned', 'Historial 2', 'Figuritas quitadas del álbum'],
        ['addedDuplicates', 'Historial 3', 'Repetidas agregadas'],
        ['removedDuplicates', 'Historial 4', 'Repetidas quitadas'],
        ['missingAdded', 'Historial 5', 'Faltante agregada'],
        ['missingResolved', 'Historial 6', 'Faltante corregida (agregada y luego quitada)'],
      ].map(([key, label, title]) => (
        <section className="settings-card settings-card-soft" key={key}>
          <div className="settings-card-header">
            <span className="settings-card-icon is-info" aria-hidden="true" />
            <div>
              <p className="page-label">{label}</p>
              <h3>{title}</h3>
            </div>
          </div>
          <ul className="settings-history-list">
            {previewFor(key).map((item, index) => (
              <li key={`${key}-${item}-${index}`}>{item}</li>
            ))}
            {!previewFor(key).length ? <li>No hay registros todavía.</li> : null}
          </ul>
          {(actionHistory[key] || []).length > 10 ? (
            <button type="button" className="action-button action-button-ghost" onClick={() => setExpandedKey((current) => current === key ? '' : key)}>
              {expandedKey === key ? 'Mostrar menos' : 'Ver más'}
            </button>
          ) : null}
        </section>
      ))}

      <section className="settings-card settings-card-soft">
        <div className="settings-card-header">
          <span className="settings-card-icon is-info" aria-hidden="true" />
          <div>
            <p className="page-label">Aviso</p>
            <h3>Uso de la herramienta</h3>
          </div>
        </div>

        <p className="settings-note">
          Mi Álbum 2026 es una herramienta no oficial para control personal de
          colección. No está afiliada, patrocinada ni respaldada por FIFA, Panini
          ni ninguna entidad oficial. Las marcas mencionadas pertenecen a sus
          respectivos propietarios.
        </p>
      </section>
    </div>
  )
}

export default SettingsPage
