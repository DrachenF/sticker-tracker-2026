import { useEffect, useMemo, useRef, useState } from 'react'
import StickerCard from '../components/StickerCard'
import { buildDuplicateText } from '../utils/exportText'
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

function DuplicatesPage({
  stickers,
  teams,
  collection,
  selectedSectionId,
  onSelectSection,
  onCloseSection,
  onOpenDuplicateInAlbum,
  onToggleOwned,
  onIncrementDuplicates,
  onDecrementDuplicates,
  onCopyText,
  onShareWhatsApp,
  onPageTurnSound,
}) {
  const [slideDir, setSlideDir] = useState('')

  const duplicateStickers = useMemo(
    () => stickers.filter((sticker) => (collection[sticker.code]?.duplicates ?? 0) > 0),
    [stickers, collection]
  )

  const duplicateSections = useMemo(
    () => buildSections(duplicateStickers, teams),
    [duplicateStickers, teams]
  )

  const duplicateText = useMemo(
    () => buildDuplicateText(duplicateStickers, collection),
    [duplicateStickers, collection]
  )

  const allSections = useMemo(
    () => buildSections(stickers, teams),
    [stickers, teams]
  )

  const selectedSection = useMemo(() => {
    if (!selectedSectionId) return null
    const found = duplicateSections.find((s) => s.id === selectedSectionId)
    if (found) return found
    const fallback = allSections.find((s) => s.id === selectedSectionId)
    return fallback ? { ...fallback, stickers: [] } : null
  }, [duplicateSections, allSections, selectedSectionId])

  const selectedSectionIndex = selectedSection
    ? allSections.findIndex((section) => section.id === selectedSectionId)
    : -1
  const duplicateSectionPositions = useMemo(
    () =>
      duplicateSections
        .map((section) => ({
          section,
          index: allSections.findIndex(
            (albumSection) => albumSection.id === section.id,
          ),
        }))
        .filter(({ index }) => index !== -1),
    [allSections, duplicateSections],
  )
  const prevSection =
    selectedSectionIndex === -1
      ? null
      : [...duplicateSectionPositions]
          .reverse()
          .find(({ index }) => index < selectedSectionIndex)?.section ?? null
  const nextSection =
    selectedSectionIndex === -1
      ? null
      : duplicateSectionPositions.find(({ index }) => index > selectedSectionIndex)
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
    
    // Count how many total duplicate copies exist in this section
    const totalDuplicateCopies = selectedSection.stickers.reduce((acc, sticker) => {
      return acc + (collection[sticker.code]?.duplicates || 0)
    }, 0)

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
          <div className="album-country-count" style={{ color: 'var(--orange)' }}>
            <strong>{totalDuplicateCopies}</strong> repetidas
          </div>
          <button
            type="button"
            className="album-close-button"
            onClick={onCloseSection}
            aria-label="Cerrar seccion"
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
                onClick={() => onCopyText(buildDuplicateText(selectedSection.stickers, collection), `Repetidas de ${selectedSection.title} copiadas.`)}
              >
                Copiar {selectedSection.shortLabel}
              </button>
              <button
                type="button"
                className="action-button"
                style={{ padding: '10px 0', fontSize: '0.85rem' }}
                onClick={() => onShareWhatsApp(buildDuplicateText(selectedSection.stickers, collection))}
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
                  onToggleOwned={() => onOpenDuplicateInAlbum(sticker)}
                  onIncrementDuplicates={onIncrementDuplicates}
                  onDecrementDuplicates={onDecrementDuplicates}
                  context="duplicates"
                  variant="album-grid"
                />
              ))}
            </div>
          </>
        ) : (
          <section className={`empty-state ${slideDir}`} key={selectedSection.id} style={{ marginTop: '40px', padding: '24px' }}>
            <h3 style={{ color: 'var(--text-main)' }}>Sin repetidas ❌</h3>
            <p>No tienes estampitas extras de {selectedSection.title} para intercambiar.</p>
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
            <h3>{duplicateStickers.length} estampitas con repetidas</h3>
          </div>
        </div>

        <div className="share-actions">
          <button
            type="button"
            className="action-button is-secondary"
            onClick={() => onCopyText(duplicateText, 'Lista de repetidas copiada.')}
          >
            Copiar lista
          </button>
          <button
            type="button"
            className="action-button"
            onClick={() => onShareWhatsApp(duplicateText)}
          >
            Compartir por WhatsApp
          </button>
        </div>
      </section>

      <section className="album-browser">
        <div className="album-tree" role="list">
          {duplicateSections.length ? (
            duplicateSections.map((section) => {
              const accentColor = getAccentColorForTeam(section.teamCode)
              
              const copies = section.stickers.reduce((acc, sticker) => {
                return acc + (collection[sticker.code]?.duplicates || 0)
              }, 0)

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
                  <span className="album-tree-count" style={{ color: 'var(--orange)' }}>
                    x{copies}
                  </span>
                  <span className="album-tree-progress" aria-hidden="true">
                    <span style={{ width: '100%' }} />
                  </span>
                </button>
              )
            })
          ) : (
            <section className="empty-state">
              <h3>Aun no registras repetidas.</h3>
              <p>Usa el album para sumar copias extra de cada estampita.</p>
            </section>
          )}
        </div>
      </section>
    </div>
  )
}

export default DuplicatesPage
