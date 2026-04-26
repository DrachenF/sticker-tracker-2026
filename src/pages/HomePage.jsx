import { useEffect, useMemo, useRef, useState } from 'react'
import ProgressCard from '../components/ProgressCard'
import { buildFlagUrlFromCode } from '../utils/collectionStats'

const bookColorOptions = [
  '#1d4ed8',
  '#2563eb',
  '#0f766e',
  '#15803d',
  '#65a30d',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#be123c',
  '#c026d3',
  '#7c3aed',
  '#4338ca',
  '#0891b2',
  '#475569',
  '#111827',
  '#92400e',
]

const MAX_FLAGS = 7
const BOOK_CUSTOMIZATION_KEY = 'sticker-tracker-2026-book-customization'
const flagPositionPresets = [
  { x: 22, y: 28 },
  { x: 50, y: 24 },
  { x: 78, y: 28 },
  { x: 30, y: 68 },
  { x: 58, y: 64 },
  { x: 82, y: 66 },
]

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function roundLayoutValue(value) {
  return Math.round(value * 10) / 10
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function createBookFlag(code, index = 0) {
  const preset = flagPositionPresets[index % flagPositionPresets.length]

  return {
    id: `${code}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    code,
    x: roundLayoutValue(clamp(preset.x + randomBetween(-6, 6), 10, 90)),
    y: roundLayoutValue(clamp(preset.y + randomBetween(-7, 7), 14, 86)),
    rotation: Math.round(randomBetween(-10, 10)),
  }
}

function normalizeBookFlag(flag, index) {
  if (typeof flag === 'string') {
    return createBookFlag(flag, index)
  }

  if (!flag?.code) {
    return null
  }

  return {
    id: flag.id || `${flag.code}-${index}`,
    code: flag.code,
    x: roundLayoutValue(clamp(Number(flag.x) || 50, 10, 90)),
    y: roundLayoutValue(clamp(Number(flag.y) || 30, 14, 86)),
    rotation: Math.round(clamp(Number(flag.rotation) || 0, -35, 35)),
  }
}

function normalizeBookFlags(flags) {
  if (!Array.isArray(flags)) {
    return []
  }

  return flags
    .map(normalizeBookFlag)
    .filter(Boolean)
    .slice(0, MAX_FLAGS)
}

function loadBookCustomization() {
  try {
    const savedValue = window.localStorage.getItem(BOOK_CUSTOMIZATION_KEY)

    if (!savedValue) {
      return null
    }

    return JSON.parse(savedValue)
  } catch {
    return null
  }
}

function RotateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </svg>
  )
}

function BookFlags({
  flags,
  editable = false,
  selectedFlagId = '',
  onSelectFlag,
  onUpdateFlag,
  onRemoveFlag,
  onFlagClick,
}) {
  const zoneRef = useRef(null)
  const dragStateRef = useRef(null)

  if (!flags || flags.length === 0) return null

  const handlePointerDown = (event, flag) => {
    if (!editable || !zoneRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)

    const rect = zoneRef.current.getBoundingClientRect()
    const pointerX = ((event.clientX - rect.left) / rect.width) * 100
    const pointerY = ((event.clientY - rect.top) / rect.height) * 100

    onSelectFlag?.(flag.id)
    dragStateRef.current = {
      mode: 'move',
      id: flag.id,
      rect,
      offsetX: flag.x - pointerX,
      offsetY: flag.y - pointerY,
    }
  }

  const handleRotatePointerDown = (event, flag) => {
    if (!editable || !zoneRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)

    const rect = zoneRef.current.getBoundingClientRect()
    const centerX = rect.left + (flag.x / 100) * rect.width
    const centerY = rect.top + (flag.y / 100) * rect.height
    const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180 / Math.PI

    onSelectFlag?.(flag.id)
    dragStateRef.current = {
      mode: 'rotate',
      id: flag.id,
      centerX,
      centerY,
      startAngle,
      startRotation: flag.rotation,
    }
  }

  const handlePointerMove = (event) => {
    const dragState = dragStateRef.current

    if (!dragState) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    if (dragState.mode === 'move') {
      const nextX =
        ((event.clientX - dragState.rect.left) / dragState.rect.width) * 100 +
        dragState.offsetX
      const nextY =
        ((event.clientY - dragState.rect.top) / dragState.rect.height) * 100 +
        dragState.offsetY

      onUpdateFlag?.(dragState.id, {
        x: roundLayoutValue(clamp(nextX, 10, 90)),
y: roundLayoutValue(clamp(nextY, 14, 86)),
      })
      return
    }

    const nextAngle = Math.atan2(
      event.clientY - dragState.centerY,
      event.clientX - dragState.centerX,
    ) * 180 / Math.PI

    onUpdateFlag?.(dragState.id, {
      rotation: Math.round(
        clamp(dragState.startRotation + nextAngle - dragState.startAngle, -35, 35),
      ),
    })
  }

  const handlePointerUp = (event) => {
    if (!dragStateRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    dragStateRef.current = null
  }

  return (
    <div
      ref={zoneRef}
      className={`book-flag-zone ${editable ? 'is-editable' : ''} ${
        onFlagClick ? 'is-clickable' : ''
      }`}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {flags.map((flag) => {
        const isSelected = editable && selectedFlagId === flag.id
        const isInteractive = editable || Boolean(onFlagClick)
        const FlagElement = isInteractive ? 'button' : 'span'

        return (
          <FlagElement
            key={flag.id}
            {...(isInteractive
              ? {
                  type: 'button',
                  onPointerDown: (event) => {
                    if (editable) {
                      handlePointerDown(event, flag)
                    }
                  },
                  onClick: (event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (editable) {
                      onSelectFlag?.(flag.id)
                      return
                    }

                    onFlagClick?.(flag)
                  },
                  'aria-label': editable
                    ? `Mover bandera ${flag.code}`
                    : `Editar bandera ${flag.code}`,
                  tabIndex: 0,
                }
              : {
                  'aria-hidden': 'true',
                })}
            className={`book-flag-node ${isSelected ? 'is-selected' : ''}`}
            style={{
              '--flag-x': flag.x,
              '--flag-y': flag.y,
              '--flag-rotation': `${flag.rotation}deg`,
            }}
          >
            <img
              className="book-flag-mini"
              src={buildFlagUrlFromCode(flag.code)}
              alt=""
              aria-hidden="true"
              draggable="false"
            />
            {isSelected ? (
  <>
    <span
      className="book-flag-remove-handle"
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onRemoveFlag?.(flag.id)
      }}
      aria-label={`Quitar bandera ${flag.code}`}
    >
      ×
    </span>

    <span
      className="book-flag-rotate-handle"
      onPointerDown={(event) => handleRotatePointerDown(event, flag)}
    >
      <RotateIcon />
    </span>
  </>
) : null}
          </FlagElement>
        )
      })}
    </div>
  )
}

function CustomizeIcon({ type }) {
  if (type === 'color') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.75a8.25 8.25 0 0 0 0 16.5h1.1a1.85 1.85 0 0 0 1.28-3.18 1.18 1.18 0 0 1 .84-2.01h1.03A4.25 4.25 0 0 0 20.5 10.8C20.5 6.92 16.7 3.75 12 3.75Z" />
        <path d="M7.6 11.15h.02M9.1 7.85h.02M13 7.35h.02M16 9.65h.02" />
      </svg>
    )
  }

  if (type === 'flag') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 20V4" />
        <path d="M6 5.5h10.2l-1.25 3.2 1.25 3.2H6" />
      </svg>
    )
  }

  if (type === 'back') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 12H5" />
        <path d="m12 5-7 7 7 7" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 12a8 8 0 0 1 13.66-5.66" />
      <path d="M18 4v4h-4" />
      <path d="M20 12a8 8 0 0 1-13.66 5.66" />
      <path d="M6 20v-4h4" />
    </svg>
  )
}

function HomePage({ stats, teams, onNavigate }) {
  const [bookColor, setBookColor] = useState(() => {
    const savedCustomization = loadBookCustomization()

    return savedCustomization?.bookColor || bookColorOptions[0]
  })
  const [hasCustomBookColor, setHasCustomBookColor] = useState(() => {
    const savedCustomization = loadBookCustomization()

    return Boolean(
      savedCustomization?.hasCustomBookColor ||
        (savedCustomization?.bookColor &&
          savedCustomization.bookColor !== bookColorOptions[0]),
    )
  })
  const [bookFlags, setBookFlags] = useState(() => {
    const savedCustomization = loadBookCustomization()
    // Migrate from old bookTeamCode or old string-only bookFlags if needed.
    if (savedCustomization?.bookFlags) {
      return normalizeBookFlags(savedCustomization.bookFlags)
    }
    if (savedCustomization?.bookTeamCode) {
      return [createBookFlag(savedCustomization.bookTeamCode)]
    }
    return []
  })
  const [selectedFlagId, setSelectedFlagId] = useState('')
  const [activeCustomizer, setActiveCustomizer] = useState(null) // null, 'color', 'flag'
  const [previousBookColor, setPreviousBookColor] = useState(null)
  const ownedAngle = stats.total ? (stats.owned / stats.total) * 360 : 0
  const touchedTotal = stats.owned + stats.duplicates
  const duplicatePercentage = touchedTotal
    ? Math.round((stats.duplicates / touchedTotal) * 100)
    : 0
  const duplicateAngle = touchedTotal
    ? (stats.duplicates / touchedTotal) * 360
    : 0
  const flagOptions = useMemo(
    () => teams.filter((team) => team.teamCode).slice(0, 48),
    [teams],
  )
  useEffect(() => {
  document.documentElement.style.setProperty(
    '--album-theme-color',
    hasCustomBookColor ? bookColor : '#ffffff',
  )

  window.localStorage.setItem(
    BOOK_CUSTOMIZATION_KEY,
    JSON.stringify({
      bookColor,
      hasCustomBookColor,
      bookFlags,
    }),
  )
}, [bookColor, bookFlags, hasCustomBookColor])

 useEffect(() => {
  if (activeCustomizer !== 'flag' || !selectedFlagId) {
    return
  }

  const handleDocumentPointerDown = (event) => {
    const target = event.target

    if (
      target.closest?.(
        '.book-flag-node, .book-flag-rotate-handle, .book-flag-remove-handle, .selected-flag-chip',
      )
    ) {
      return
    }

    setSelectedFlagId('')
  }

  document.addEventListener('pointerdown', handleDocumentPointerDown)

  return () => {
    document.removeEventListener('pointerdown', handleDocumentPointerDown)
  }
}, [activeCustomizer, selectedFlagId])

  const handleBookColorChange = (color) => {
    if (color === bookColor) {
      return
    }

    setPreviousBookColor({
      bookColor,
      hasCustomBookColor,
    })
    setBookColor(color)
    setHasCustomBookColor(true)
  }

  const addFlag = (code) => {
    setBookFlags((currentFlags) => {
      if (currentFlags.length >= MAX_FLAGS) {
        return currentFlags
      }

      const nextFlag = createBookFlag(code, currentFlags.length)
      setSelectedFlagId(nextFlag.id)
      return [...currentFlags, nextFlag]
    })
  }

  const removeFlag = (id) => {
    setBookFlags((currentFlags) => currentFlags.filter((flag) => flag.id !== id))
    if (selectedFlagId === id) {
      setSelectedFlagId('')
    }
  }

  const updateBookFlag = (id, patch) => {
    setBookFlags((currentFlags) =>
      currentFlags.map((flag) =>
        flag.id === id
          ? {
              ...flag,
              ...patch,
            }
          : flag,
      ),
    )
  }

  const restorePreviousBookColor = () => {
    if (!previousBookColor) {
      return
    }

    setPreviousBookColor({
      bookColor,
      hasCustomBookColor,
    })
    setBookColor(previousBookColor.bookColor)
    setHasCustomBookColor(previousBookColor.hasCustomBookColor)
  }

  const removeLastFlag = () => {
    setBookFlags((currentFlags) => {
      const nextFlags = currentFlags.slice(0, -1)

      if (!nextFlags.some((flag) => flag.id === selectedFlagId)) {
        setSelectedFlagId('')
      }

      return nextFlags
    })
  }

  const openColorCustomizer = () => {
    setActiveCustomizer('color')
  }

  const openFlagCustomizer = (flag) => {
    setSelectedFlagId(flag.id)
    setActiveCustomizer('flag')
  }

  const handleBookCoverKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    openColorCustomizer()
  }

  return (
    <div className="page-stack home-page">
      <ProgressCard
        stats={stats}
      />

      <section className="home-shop-card" aria-label="Disponibilidad en Guatemala">
        <div className="home-shop-copy">
          <p className="quick-label home-shop-country">
            <img src="https://flagcdn.com/gt.svg" alt="" aria-hidden="true" />
            <span>Disponible para Guatemala</span>
          </p>
          <h3>¿Te faltan sobres, álbumes o estampitas?</h3>
          <p>Escríbenos por WhatsApp y consulta disponibilidad.</p>
        </div>
        <a
          className="home-shop-button"
          href="https://wa.me/50258714824?text=Hola%2C%20estoy%20interesado%20en%20conseguir%20album%20y%20estampitas%20en%20Guatemala."
          target="_blank"
          rel="noopener noreferrer"
        >
          Escribir por WhatsApp
        </a>
      </section>

      <section className="home-book-panel">
        <div
          role="button"
          tabIndex={0}
          className="book-cta"
          style={{ '--book-color': bookColor }}
          onClick={openColorCustomizer}
          onKeyDown={handleBookCoverKeyDown}
          aria-label="Editar color del álbum"
        >
          <div className="book-spine" />
          <BookFlags flags={bookFlags} onFlagClick={openFlagCustomizer} />
          <div className="book-content">
            <span className="book-subtitle">Mi álbum</span>
            <span className="book-title">Mundial 2026</span>
            <button
              type="button"
              className="book-action"
              onClick={(event) => {
                event.stopPropagation()
                onNavigate('album')
              }}
            >
              INICIAR
            </button>
          </div>
        </div>

        <div className="book-side-actions">
          <button
            type="button"
            className="customize-book-button"
            onClick={() => setActiveCustomizer('color')}
            aria-label="Personalizar color"
          >
            <CustomizeIcon type="color" />
          </button>
          <button
            type="button"
            className="customize-book-button"
            onClick={() => setActiveCustomizer('flag')}
            aria-label="Personalizar bandera"
          >
            <CustomizeIcon type="flag" />
          </button>
        </div>
      </section>

      {activeCustomizer ? (
        <>
        <div className="modal-backdrop" onClick={() => setActiveCustomizer(null)} />
        <section className="book-customizer" aria-label="Personalizar álbum">
          <div className="book-customizer-head">
            <p className="quick-label">
              {activeCustomizer === 'color' ? 'Color del álbum' : 'Banderas del álbum'}
            </p>
            <button
              type="button"
              className="customizer-close"
              onClick={() => setActiveCustomizer(null)}
              aria-label="Cerrar personalizacion"
            >
              X
            </button>
          </div>

          {activeCustomizer === 'color' ? (
            <div className="customizer-group">
              <div className="customizer-label-row">
                <span>Elegir Color</span>
                <span className="label-hint">Desliza para ver más</span>
              </div>
              <div className="color-picker-grid">
                <label
                  className="custom-color-panel"
                  style={{ '--custom-panel-color': bookColor }}
                  aria-label="Personalizar color"
                >
                  <input
                    type="color"
                    value={bookColor.startsWith('#') ? bookColor.slice(0, 7) : '#1d4ed8'}
                    onChange={(e) => handleBookColorChange(e.target.value)}
                    className="native-color-input"
                  />
                </label>
                {bookColorOptions.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-swatch ${
                      bookColor === color ? 'is-selected' : ''
                    }`}
                    style={{ '--swatch-color': color }}
                    onClick={() => handleBookColorChange(color)}
                    aria-label={`Usar color ${color}`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="customizer-group">

              <div className="customizer-preview-shell">
                <div className="book-cta mini-preview" style={{ '--book-color': bookColor }}>
                  <div className="book-spine" />
                  <BookFlags
  flags={bookFlags}
  editable
  selectedFlagId={selectedFlagId}
  onSelectFlag={setSelectedFlagId}
  onUpdateFlag={updateBookFlag}
  onRemoveFlag={removeFlag}
/>
                  <div className="book-content">
                    <span className="book-subtitle">Mi álbum</span>
                    <span className="book-title">Mundial 2026</span>
                    <span className="book-action">INICIAR</span>
                  </div>
                </div>

                {bookFlags.length > 0 ? (
                  <div className="selected-flags-sidebar">
                    <span className="selected-flags-label">
                      {bookFlags.length}/{MAX_FLAGS}
                    </span>
                    {bookFlags.map((flag) => (
                      <button
                        key={flag.id}
                        type="button"
                        className={`selected-flag-chip ${
                          selectedFlagId === flag.id ? 'is-selected' : ''
                        }`}
                        onClick={() => setSelectedFlagId(flag.id)}
                        aria-label={`Seleccionar ${flag.code}`}
                      >
                        <img
                          src={buildFlagUrlFromCode(flag.code)}
                          alt=""
                          aria-hidden="true"
                        />
                        <strong>{flag.code}</strong>
                        <small
                          onClick={(event) => {
                            event.stopPropagation()
                            removeFlag(flag.id)
                          }}
                          aria-label={`Quitar ${flag.code}`}
                        >
                          X
                        </small>
                        <span>✕</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="customizer-label-row">
                <span>Toca para agregar</span>
                <span className="label-hint">
                  {bookFlags.length < MAX_FLAGS
                    ? `${MAX_FLAGS - bookFlags.length} restantes`
                    : 'Máximo alcanzado'}
                </span>
              </div>
              <div className="carousel-wrapper">
                <button
                  type="button"
                  className="carousel-arrow carousel-arrow-left"
                  onClick={() => {
                    const el = document.querySelector('.flag-carousel')
                    if (el) el.scrollBy({ left: -200, behavior: 'smooth' })
                  }}
                  aria-label="Banderas anteriores"
                >
                  ‹
                </button>
                <div className="flag-carousel">
                  <button
                    type="button"
                    className={`flag-carousel-item ${
                      bookFlags.length === 0 ? 'is-disabled' : ''
                    }`}
                    onClick={removeLastFlag}
                    disabled={bookFlags.length === 0}
                  >
                    <span className="flag-carousel-icon">X</span>
                    <span>
                      {bookFlags.length > 1
                        ? `Quitar ${bookFlags.length}`
                        : 'Ninguna'}
                    </span>
                  </button>
                  {flagOptions.map((team) => (
                    <button
                      key={team.teamCode}
                      type="button"
                      className={`flag-carousel-item ${
                        bookFlags.length >= MAX_FLAGS ? 'is-disabled' : ''
                      }`}
                      onClick={() => addFlag(team.teamCode)}
                      disabled={bookFlags.length >= MAX_FLAGS}
                    >
                      <img
                        src={buildFlagUrlFromCode(team.teamCode)}
                        alt=""
                        aria-hidden="true"
                      />
                      <span>{team.teamCode}</span>
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="carousel-arrow carousel-arrow-right"
                  onClick={() => {
                    const el = document.querySelector('.flag-carousel')
                    if (el) el.scrollBy({ left: 200, behavior: 'smooth' })
                  }}
                  aria-label="Banderas siguientes"
                >
                  ›
                </button>
              </div>
            </div>
          )}
          <div className="customizer-actions">
            {activeCustomizer === 'color' ? (
              <button
                type="button"
                className="customizer-round-action"
                onClick={restorePreviousBookColor}
                disabled={!previousBookColor}
                aria-label="Volver al color anterior"
              >
                <CustomizeIcon type="back" />
              </button>
            ) : null}
            <button
              type="button"
              className="customizer-round-action is-done"
              onClick={() => setActiveCustomizer(null)}
              aria-label="Listo"
            >
              ✓
            </button>
          </div>
        </section>
        </>
      ) : null}

      <section className="home-stat-wheels" aria-label="Resumen visual">
        <article className="home-stat-wheel-card">
          <div
            className="home-stat-wheel wheel-album"
            style={{
              '--first-angle': `${ownedAngle}deg`,
            }}
            aria-hidden="true"
          >
            <div>
              <strong>{stats.percentage}%</strong>
              <span>album</span>
            </div>
          </div>
          <div className="home-stat-wheel-copy">
            <p className="quick-label">Album base</p>
            <h3>{stats.owned} / {stats.total}</h3>
            <div className="wheel-legend">
              <span className="legend-have">Tengo {stats.owned}</span>
              <span className="legend-missing">Faltan {stats.missing}</span>
            </div>
          </div>
        </article>

        <article className="home-stat-wheel-card">
          <div
            className="home-stat-wheel wheel-duplicates"
            style={{
              '--first-angle': `${duplicateAngle}deg`,
            }}
            aria-hidden="true"
          >
            <div>
              <strong>{duplicatePercentage}%</strong>
              <span>rep.</span>
            </div>
          </div>
          <div className="home-stat-wheel-copy">
            <p className="quick-label">Intercambio</p>
            <h3>{stats.duplicates} / {touchedTotal}</h3>
            <div className="wheel-legend">
              <span className="legend-duplicates">Repetidas {stats.duplicates}</span>
              <span className="legend-have">Tengo {stats.owned}</span>
            </div>
          </div>
        </article>
      </section>

      <section className="home-seo-note" aria-label="Informacion de Mi Album 2026">
        <p>
          Mi Álbum 2026 es una herramienta digital no oficial para controlar tu
          colección de estampitas: marca las que tienes, faltantes, repetidas y
          pegadas, comparte listas y guarda un respaldo privado de tu progreso.
        </p>
        <nav className="home-seo-links" aria-label="Guías de la app">
          <a href="/como-usar">Cómo usar</a>
          <a href="/checklist-album-mundial-2026">Checklist</a>
          <a href="/faltantes-estampitas-mundial-2026">Faltantes</a>
          <a href="/repetidas-estampitas-mundial-2026">Repetidas</a>
          <a href="/album-mundial-2026-pdf">PDF</a>
        </nav>
        <p className="home-seo-legal">
          No está afiliada, patrocinada ni respaldada por FIFA, Panini ni ninguna
          entidad oficial.
        </p>
      </section>
    </div>
  )
}

export default HomePage
