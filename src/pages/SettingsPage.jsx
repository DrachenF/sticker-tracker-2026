function SettingsPage({
  collection,
  onExportBackup,
  onImportBackup,
  onResetCollection,
  isSoundEnabled,
  onToggleSound,
}) {
  const touchedCount = Object.keys(collection).length

  return (
    <div className="settings-stack">
      <div className="settings-hero">
        <div className="settings-hero-icon" aria-hidden="true">
          <span />
        </div>
        <div>
          <p className="page-label">Ajustes</p>
          <h2>Tu album, a salvo</h2>
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
              ? 'Los sonidos suaves estan activados.'
              : 'La app esta en silencio.'}
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
          El archivo .albu incluye estampitas, repetidas, pegadas, color del album
          y posicion de banderas.
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
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <span className="settings-card-icon is-reset" aria-hidden="true" />
          <div>
            <p className="page-label">Coleccion</p>
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
            Reiniciar coleccion
          </button>
        </div>
      </section>

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
