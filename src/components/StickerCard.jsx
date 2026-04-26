import { useEffect, useRef } from 'react'

function formatTypeLabel(type) {
  if (!type) {
    return 'Sin tipo'
  }

  const cleanedType = type
    .replaceAll('official_', '')
    .replaceAll('logo', 'intro')

  return cleanedType
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatStickerName(name) {
  if (!name) {
    return 'Sin nombre cargado'
  }

  return name
    .replace(/official\s+/gi, '')
    .replace(/panini logo/gi, 'Intro del album')
}

function PasteIcon({ isPasted }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 7.5V5.8A2.8 2.8 0 0 1 10.8 3h2.4A2.8 2.8 0 0 1 16 5.8v1.7" />
      <path d="M7 7.5h10l1 12.5H6L7 7.5Z" />
      {isPasted ? <path d="m9.2 13.6 1.9 1.9 3.9-4.2" /> : null}
    </svg>
  )
}

function StickerCard({
  sticker,
  stickerState,
  accentColor,
  onToggleOwned,
  onTogglePasted,
  onIncrementDuplicates,
  onDecrementDuplicates,
  isHighlighted = false,
  highlightLabel = '',
  context = '',
  variant = 'default',
}) {
  const tapTimeoutRef = useRef(null)
  const lastTapRef = useRef(0)
  const owned = stickerState?.owned ?? false
  const duplicates = stickerState?.duplicates ?? 0
  const pasted = owned && Boolean(stickerState?.pasted)
  const hasDuplicates = duplicates > 0
  const isDuplicatesContext = context === 'duplicates'
  const duplicateLabel = `Sobra ${duplicates}`
  const gridStateClass = isDuplicatesContext
    ? 'is-duplicate'
    : owned
      ? 'is-owned'
      : hasDuplicates
        ? 'is-duplicate'
        : 'is-missing'

  let statusClassName = 'is-missing'
  let statusLabel = 'Me falta'

  if (hasDuplicates) {
    statusClassName = 'is-duplicate'
    statusLabel = `Repetidas ${duplicates}`
  } else if (owned) {
    statusClassName = 'is-have'
    statusLabel = 'La tengo'
  }

  useEffect(
    () => () => {
      window.clearTimeout(tapTimeoutRef.current)
    },
    [],
  )

  const togglePasted = () => {
    onTogglePasted?.(sticker.code)
  }

  const handleGridMainClick = () => {
    if (isDuplicatesContext) {
      onToggleOwned(sticker.code)
      return
    }

    if (!owned) {
      onToggleOwned(sticker.code)
      return
    }

    const now = Date.now()

    if (now - lastTapRef.current < 280) {
      window.clearTimeout(tapTimeoutRef.current)
      lastTapRef.current = 0
      togglePasted()
      return
    }

    lastTapRef.current = now
    window.clearTimeout(tapTimeoutRef.current)
    tapTimeoutRef.current = window.setTimeout(() => {
      lastTapRef.current = 0

      if (duplicates > 0 || pasted) {
        return
      }

      onToggleOwned(sticker.code)
    }, 220)
  }

  if (variant === 'album-grid') {
    return (
      <article
        className={`sticker-card sticker-card-grid ${gridStateClass} ${
          context === 'missing' ? 'is-missing-context' : ''
        } ${
          isDuplicatesContext ? 'is-duplicates-context' : ''
        } ${isHighlighted ? 'is-highlighted-target' : ''}`}
        data-sticker-code={sticker.code}
        style={{ '--sticker-accent': accentColor }}
      >
        <button
          type="button"
          className="sticker-grid-main"
          onClick={handleGridMainClick}
          aria-label={`${owned ? 'Quitar' : 'Marcar'} ${sticker.code}`}
        >
          <span className="sticker-grid-code">{sticker.code}</span>
          <span className="sticker-grid-number">
            {sticker.localNumber ?? '-'}
          </span>
          <span className="sticker-grid-name">{formatStickerName(sticker.name)}</span>
          {isDuplicatesContext ? null : (
            <span
              className={`sticker-grid-status ${
                owned ? 'is-have' : statusClassName
              } ${
                !owned && context !== 'missing'
                  ? 'is-add-action is-add-icon'
                  : ''
              }`}
            >
              {owned ? '\u2713' : 'Agregar'}
            </span>
          )}
          {owned ? (
            <span
              className={`sticker-grid-repeat-count ${
                duplicates > 0 ? 'has-repeats' : ''
              }`}
            >
              {isDuplicatesContext ? duplicateLabel : `x${duplicates + 1}`}
            </span>
          ) : null}
          {isDuplicatesContext ? (
            <span className="sticker-grid-status is-remove-action">
              Quitar
            </span>
          ) : null}
        </button>

        {owned && !isDuplicatesContext ? (
          <button
            type="button"
            className={`sticker-grid-paste ${pasted ? 'is-pasted' : ''}`}
            onClick={togglePasted}
            aria-label={`${pasted ? 'Despegar' : 'Pegar'} ${sticker.code}`}
            title={pasted ? 'Despegar' : 'Pegar'}
          >
            <PasteIcon isPasted={pasted} />
          </button>
        ) : null}

        {owned && !isDuplicatesContext ? (
          <div className="sticker-grid-tools" aria-label={`Repetidas de ${sticker.code}`}>
            <button
              type="button"
              className="sticker-grid-duplicate"
              onClick={() => {
                if (duplicates) {
                  onDecrementDuplicates(sticker.code)
                  return
                }

                if (pasted) {
                  return
                }

                onToggleOwned(sticker.code)
              }}
              disabled={pasted && duplicates === 0}
              aria-label={
                duplicates
                  ? `Quitar una repetida de ${sticker.code}`
                  : pasted
                    ? `Despega ${sticker.code} antes de marcarla como falta`
                  : `Marcar como falta ${sticker.code}`
              }
            >
              -
            </button>
            <button
              type="button"
              className="sticker-grid-duplicate"
              onClick={() => onIncrementDuplicates(sticker.code)}
              aria-label={`Aumentar repetidas de ${sticker.code}`}
            >
              +
            </button>
          </div>
        ) : null}
        {isHighlighted && highlightLabel ? (
          <span className="sticker-grid-change-badge">{highlightLabel}</span>
        ) : null}
      </article>
    )
  }

  return (
    <article
      className={`sticker-card ${
        hasDuplicates ? 'is-duplicate' : owned ? 'is-owned' : 'is-missing'
      }`}
      style={{ '--sticker-accent': accentColor }}
    >
      <div className="sticker-head">
        <div style={{ width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
            <span className="sticker-code">{sticker.code}</span>
            <span className={`status-pill ${statusClassName}`}>{statusLabel}</span>
          </div>
          <p className="sticker-name">{formatStickerName(sticker.name)}</p>
          <div className="sticker-meta">
            <span className="meta-pill">Tipo: {formatTypeLabel(sticker.type)}</span>
            <span className="meta-pill">
              N local: {sticker.localNumber ?? '-'}
            </span>
          </div>
        </div>
      </div>

      <div className="sticker-actions">
        <button
          type="button"
          className={`toggle-owned ${owned ? '' : 'is-off'}`}
          onClick={() => onToggleOwned(sticker.code)}
        >
          {owned ? 'Ya la tengo' : 'Anadir al album'}
        </button>

        <div className="duplicates-stepper" aria-label={`Repetidas de ${sticker.code}`}>
          <button
            type="button"
            className="duplicate-button"
            onClick={() => onDecrementDuplicates(sticker.code)}
            aria-label={`Disminuir repetidas de ${sticker.code}`}
          >
            -
          </button>
          <div className="duplicate-count">x{duplicates}</div>
          <button
            type="button"
            className="duplicate-button"
            onClick={() => onIncrementDuplicates(sticker.code)}
            aria-label={`Aumentar repetidas de ${sticker.code}`}
          >
            +
          </button>
        </div>
      </div>
    </article>
  )
}

export default StickerCard
