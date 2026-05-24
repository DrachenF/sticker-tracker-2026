import { useEffect, useMemo, useRef, useState } from 'react'
import StickerCard from '../components/StickerCard'
import { buildMissingText } from '../utils/exportText'
import { buildSections } from '../utils/collectionStats'
import { getAccentColorForTeam } from '../utils/teamAccents'
import { useSwipe } from '../hooks/useSwipe'

function AlbumFlag({ section }) {
  if (!section.flagUrl) {
    return (
      <span className="album-flag-icon album-flag-base" style={{ fontSize: section.emoji ? '20px' : undefined }} aria-hidden="true">
        {section.emoji || 'Base'}
      </span>
    )
  }
  return (
    <img
      className="album-flag-icon"
      src={section.flagUrl}
      alt=""
      aria-hidden="true"
      loading="lazy"
    />
  )
}

function MissingPage({
  stickers,
  teams,
  collection,
  selectedSectionId,
  onSelectSection,
  onCloseSection,
  onOpenStickerInAlbum,
  onToggleOwned,
  onIncrementDuplicates,
  onDecrementDuplicates,
  onCopyText,
  onShareWhatsApp,
  onPageTurnSound,
  onRevertLastMissingAction,
  canRevertMissingAction,
}) {
  const [slideDir, setSlideDir] = useState('')

  const missingStickers = useMemo(
    () => stickers.filter((sticker) => !collection[sticker.code]?.owned),
    [stickers, collection]
  )
  
  const missingSections = useMemo(
    () => buildSections(missingStickers, teams),
    [missingStickers, teams]
  )

  const missingText = useMemo(
    () => buildMissingText(missingStickers),
    [missingStickers]
  )

  const allSections = useMemo(
    () => buildSections(stickers, teams),
    [stickers, teams]
  )

  const selectedSection = useMemo(() => {
    if (!selectedSectionId) return null
    const found = missingSections.find((s) => s.id === selectedSectionId)
    if (found) return found
    const fallback = allSections.find((s) => s.id === selectedSectionId)
    return fallback ? { ...fallback, stickers: [] } : null
  }, [missingSections, allSections, selectedSectionId])

  const selectedSectionIndex = selectedSection
    ? allSections.findIndex((section) => section.id === selectedSectionId)
    : -1
  const missingSectionPositions = useMemo(
    () =>
      missingSections
        .map((section) => ({
          section,
          index: allSections.findIndex(
            (albumSection) => albumSection.id === section.id,
          ),
        }))
        .filter(({ index }) => index !== -1),
    [allSections, missingSections],
  )
  const prevSection =
    selectedSectionIndex === -1
      ? null
      : [...missingSectionPositions]
          .reverse()
          .find(({ index }) => index < selectedSectionIndex)?.section ?? null
  const nextSection =
    selectedSectionIndex === -1
      ? null
      : missingSectionPositions.find(({ index }) => index > selectedSectionIndex)
          ?.section ?? null

  const handleNext = () => {
    if (nextSection) {
      setSlideDir('slide-in-right')
      onPageTurnSound?.()
      onSelectSection(nextSection.id)
    }
  }

  const handlePrev = () => {
    if (prevSection) {
      setSlideDir('slide-in-left')
      onPageTurnSound?.()
      onSelectSection(prevSection.id)
    }
  }

  const swipeHandlers = useSwipe({ onSwipeLeft: handleNext, onSwipeRight: handlePrev })

  if (selectedSection) {
    const accentColor = getAccentColorForTeam(selectedSection.teamCode)

    return (
      <div className="page-stack album-page album-country-page" {...swipeHandlers}>
        <section
          className="album-country-header"
          style={{ '--team-accent': accentColor }}
        >
          <button
            type="button"
            className="album-nav-button"
            onClick={handlePrev}
            disabled={!prevSection}
            aria-label="País anterior"
          >
            &lsaquo;
          </button>
          <div className="album-country-title">
            <AlbumFlag section={selectedSection} />
            <div>
              <p>{selectedSection.shortLabel}</p>
              <h2>{selectedSection.title}</h2>
            </div>
          </div>
          <button
            type="button"
            className="album-nav-button"
            onClick={handleNext}
            disabled={!nextSection}
            aria-label="País siguiente"
          >
            &rsaquo;
          </button>
          <div className="album-country-count">
            <strong>{selectedSection.stickers.length}</strong> faltantes
          </div>
          <button
            type="button"
            className="album-close-button"
            onClick={onCloseSection}
            aria-label="Cerrar sección"
          >
            X
          </button>
        </section>

        {selectedSection.stickers.length > 0 ? (
          <>
            <div className="share-actions" style={{ gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
              <button
                type="button"
                className="action-button is-secondary"
                style={{ padding: '10px 0', fontSize: '0.85rem' }}
                onClick={() => onCopyText(buildMissingText(selectedSection.stickers), `Faltantes de ${selectedSection.title} copiadas.`)}
              >
                Copiar {selectedSection.shortLabel}
              </button>
              <button
                type="button"
                className="action-button"
                style={{ padding: '10px 0', fontSize: '0.85rem' }}
                onClick={() => onShareWhatsApp(buildMissingText(selectedSection.stickers))}
              >
                WhatsApp
              </button>
            </div>

            <div className={`album-sticker-grid ${slideDir}`} key={selectedSection.id}>
              {selectedSection.stickers.map((sticker) => (
                <StickerCard
                  key={sticker.code}
                  sticker={sticker}
                  stickerState={collection[sticker.code]}
                  accentColor={accentColor}
                  onToggleOwned={() => onOpenStickerInAlbum(sticker)}
                  onIncrementDuplicates={onIncrementDuplicates}
                  onDecrementDuplicates={onDecrementDuplicates}
                  context="missing"
                  variant="album-grid"
                />
              ))}
            </div>
          </>
        ) : (
          <section className={`empty-state ${slideDir}`} key={selectedSection.id} style={{ marginTop: '40px', padding: '24px' }}>
            <h3 style={{ color: 'var(--green)' }}>¡Equipo completo! ✅</h3>
            <p>Ya tienes todas las estampitas de {selectedSection.title}.</p>
          </section>
        )}
      </div>
    )
  }

  return (
    <div className="page-stack">

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="page-label">Resumen</p>
            <h3>{missingStickers.length} estampitas faltantes</h3>
          </div>
        </div>

        <div className="share-actions">
          <button
            type="button"
            className="action-button is-secondary"
            onClick={() => onCopyText(missingText, 'Lista de faltantes copiada.')}
          >
            Copiar lista
          </button>
          <button
            type="button"
            className="action-button"
            onClick={() => onShareWhatsApp(missingText)}
          >
            Compartir por WhatsApp
          </button>
        </div>

        <div className="inline-revert-row">
          <button type="button" className="text-revert-button" onClick={onRevertLastMissingAction} disabled={!canRevertMissingAction}>Revertir último cambio</button>
        </div>
      </section>

      <section className="album-browser">
        <div className="album-tree" role="list">
          {missingSections.length ? (
            missingSections.map((section) => {
              const accentColor = getAccentColorForTeam(section.teamCode)
              
              return (
                <button
                  key={section.id}
                  type="button"
                  className="album-tree-row"
                  style={{ '--team-accent': accentColor }}
                  onClick={() => onSelectSection(section.id)}
                >
                  <AlbumFlag section={section} />
                  <span className="album-tree-code">{section.shortLabel}</span>
                  <span className="album-tree-count" style={{ color: 'var(--red)' }}>
                    {section.stickers.length} faltan
                  </span>
                  <span className="album-tree-progress" aria-hidden="true">
                    <span style={{ width: '0%' }} />
                  </span>
                </button>
              )
            })
          ) : (
            <section className="empty-state">
              <h3>No tienes faltantes.</h3>
              <p>Tu álbum base aparece completo según el progreso guardado.</p>
            </section>
          )}
        </div>
      </section>
    </div>
  )
}

export default MissingPage
