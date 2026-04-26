import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import SearchBar from '../components/SearchBar'
import StickerCard from '../components/StickerCard'
import { buildSections, stickerMatchesFilter, stickerMatchesSearch } from '../utils/collectionStats'
import { getAccentColorForTeam } from '../utils/teamAccents'
import { getVisibleProgressWidth } from '../utils/progressDisplay'
import { useSwipe } from '../hooks/useSwipe'

const TARGET_HIGHLIGHT_MS = 880

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

function AlbumPage({
  stickers,
  teams,
  collection,
  stats,
  selectedSectionId,
  activeFilter,
  targetStickerCode,
  targetStickerTransition,
  onFilterChange,
  onSelectSection,
  onCloseSection,
  onTargetStickerHandled,
  onToggleOwned,
  onTogglePasted,
  onIncrementDuplicates,
  onDecrementDuplicates,
  onNavigate,
  onPageTurnSound,
}) {
  const [searchValue, setSearchValue] = useState('')
  const [searchSectionId, setSearchSectionId] = useState('')
  const [slideDir, setSlideDir] = useState('')
  const [highlightedStickerCode, setHighlightedStickerCode] = useState('')
  const highlightTimeoutRef = useRef(null)
  const onTargetStickerHandledRef = useRef(onTargetStickerHandled)
  const deferredSearch = useDeferredValue(searchValue.trim().toLowerCase())

  useEffect(() => {
    onTargetStickerHandledRef.current = onTargetStickerHandled
  }, [onTargetStickerHandled])

  const allSections = useMemo(
    () => buildSections(stickers, teams),
    [stickers, teams],
  )

  const filteredSections = useMemo(() => {
    const matchingStickers = stickers.filter(
      (sticker) =>
        stickerMatchesSearch(sticker, deferredSearch) &&
        stickerMatchesFilter(sticker, collection[sticker.code], activeFilter),
    )

    return buildSections(matchingStickers, teams)
  }, [activeFilter, collection, deferredSearch, stickers, teams])

  const selectedSection = useMemo(
    () => {
      const filteredSection = filteredSections.find(
        (section) => section.id === selectedSectionId,
      )
      const baseSection = allSections.find(
        (section) => section.id === selectedSectionId,
      )

      if (filteredSection || activeFilter === 'all') {
        return filteredSection ?? baseSection
      }

      return baseSection ? { ...baseSection, stickers: [] } : undefined
    },
    [activeFilter, allSections, filteredSections, selectedSectionId],
  )
  const shouldShowSearchResults = deferredSearch.length >= 3
  const searchResultStickers = useMemo(
    () =>
      filteredSections
        .filter((section) => !searchSectionId || section.id === searchSectionId)
        .flatMap((section) => section.stickers),
    [filteredSections, searchSectionId],
  )
  useEffect(() => {
    if (!shouldShowSearchResults) {
      setSearchSectionId('')
      return
    }

    if (
      searchSectionId &&
      !filteredSections.some((section) => section.id === searchSectionId)
    ) {
      setSearchSectionId('')
    }
  }, [filteredSections, searchSectionId, shouldShowSearchResults])

  const navigableSections = useMemo(() => {
    if (activeFilter === 'all') {
      return allSections
    }

    return allSections.filter((section) =>
      section.stickers.some((sticker) =>
        stickerMatchesFilter(sticker, collection[sticker.code], activeFilter),
      ),
    )
  }, [activeFilter, allSections, collection])

  const selectedSectionIndex = selectedSection
    ? navigableSections.findIndex((section) => section.id === selectedSectionId)
    : -1
  const currentAllSectionIndex = allSections.findIndex(
    (section) => section.id === selectedSectionId,
  )
  const prevSection = selectedSectionIndex > 0
    ? navigableSections[selectedSectionIndex - 1]
    : selectedSectionIndex === -1 && currentAllSectionIndex > -1
      ? [...navigableSections]
          .reverse()
          .find(
            (section) =>
              allSections.findIndex((item) => item.id === section.id) <
              currentAllSectionIndex,
          ) ?? null
      : null
  const nextSection = selectedSectionIndex !== -1
    ? selectedSectionIndex < navigableSections.length - 1
      ? navigableSections[selectedSectionIndex + 1]
      : null
    : currentAllSectionIndex > -1
      ? navigableSections.find(
          (section) =>
            allSections.findIndex((item) => item.id === section.id) >
            currentAllSectionIndex,
        ) ?? null
      : null

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

  useEffect(() => {
    if (!targetStickerCode) {
      return undefined
    }

    const targetCode = targetStickerCode
    let attempts = 0

    setHighlightedStickerCode(targetCode)
    window.clearTimeout(highlightTimeoutRef.current)
    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedStickerCode('')
      onTargetStickerHandledRef.current()
    }, TARGET_HIGHLIGHT_MS)

    const scrollToTarget = () => {
      const targetElement = document.querySelector(
        `[data-sticker-code="${CSS.escape(targetCode)}"]`,
      )

      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'center',
        })
        return
      }

      attempts += 1

      if (attempts < 8) {
        window.setTimeout(scrollToTarget, 50)
      }
    }

    const scrollTimeout = window.setTimeout(scrollToTarget, 80)

    return () => {
      window.clearTimeout(scrollTimeout)
    }
  }, [targetStickerCode])

  useEffect(
    () => () => {
      window.clearTimeout(highlightTimeoutRef.current)
    },
    [],
  )

  if (selectedSection) {
    const accentColor = getAccentColorForTeam(selectedSection.teamCode)
    const ownedCount = selectedSection.stickers.filter(
      (sticker) => collection[sticker.code]?.owned,
    ).length
    const percentage = selectedSection.stickers.length
      ? Math.round((ownedCount / selectedSection.stickers.length) * 100)
      : 0

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
            <strong>{ownedCount}</strong> / {selectedSection.stickers.length}
          </div>
          <button
            type="button"
            className="album-close-button"
            onClick={onCloseSection}
            aria-label="Cerrar sección"
          >
            X
          </button>

          <div className="album-country-progress">
            <span>{percentage}% completo</span>
            <div className="progress-track" aria-hidden="true">
              <div
                className="progress-bar"
                style={{ width: getVisibleProgressWidth(percentage) }}
              />
            </div>
          </div>
        </section>

        <div className={`album-sticker-grid ${slideDir}`} key={selectedSection.id}>
          {selectedSection.stickers.map((sticker) => (
            <StickerCard
              key={sticker.code}
              sticker={sticker}
              stickerState={collection[sticker.code]}
              accentColor={accentColor}
              onToggleOwned={onToggleOwned}
              onTogglePasted={onTogglePasted}
              onIncrementDuplicates={onIncrementDuplicates}
              onDecrementDuplicates={onDecrementDuplicates}
              isHighlighted={highlightedStickerCode === sticker.code}
              highlightLabel={
                highlightedStickerCode === sticker.code &&
                targetStickerTransition?.code === sticker.code
                  ? `x${targetStickerTransition.fromCount} -> x${targetStickerTransition.toCount}`
                  : ''
              }
              variant="album-grid"
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="page-stack album-page">
      <SearchBar
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
      />

      <section className="album-browser">
        <div className="album-progress-card">
          <div className="album-progress-top">
            <div>
              <p className="page-label">Tu álbum base</p>
              <h2>
                {stats.owned} / {stats.total} registradas
              </h2>
            </div>
            <span>{stats.percentage}% completo</span>
          </div>
          <div className="progress-track" aria-hidden="true">
            <div
              className="progress-bar"
              style={{ width: getVisibleProgressWidth(stats.percentage) }}
            />
          </div>
        </div>

        <div className="album-index-title">
          <strong>Índice del álbum</strong>
          <em>{filteredSections.length} secciones</em>
        </div>

        <div className="album-tree" role="list">
          {filteredSections.length ? (
            filteredSections.map((section) => {
              const accentColor = getAccentColorForTeam(section.teamCode)
              const ownedCount = section.stickers.filter(
                (sticker) => collection[sticker.code]?.owned,
              ).length
              const percentage = section.stickers.length
                ? Math.round((ownedCount / section.stickers.length) * 100)
                : 0

              return (
                <button
                  key={section.id}
                  type="button"
                  className="album-tree-row"
                  style={{ '--team-accent': accentColor }}
                  onClick={() => {
                    if (shouldShowSearchResults) {
                      setSearchSectionId(section.id)
                      return
                    }

                    if (activeFilter === 'missing') {
                      onSelectSection(section.id)
                      onNavigate('missing')
                      return
                    }

                    if (activeFilter === 'duplicates') {
                      onSelectSection(section.id)
                      onNavigate('duplicates')
                      return
                    }

                    onSelectSection(section.id)
                  }}
                >
                  <AlbumFlag section={section} />
                  <span className="album-tree-code">{section.shortLabel}</span>
                  <span className="album-tree-count">
                    {ownedCount}/{section.stickers.length}
                  </span>
                  <span className="album-tree-progress" aria-hidden="true">
                    <span style={{ width: getVisibleProgressWidth(percentage) }} />
                  </span>
                </button>
              )
            })
          ) : (
            <section className="empty-state">
              <h3>No encontramos secciones con ese filtro.</h3>
              <p>Prueba con otro código, nombre, equipo o tipo.</p>
            </section>
          )}
        </div>

        {shouldShowSearchResults ? (
          <section className="album-results-section">
            <div className="album-index-title">
              <strong>Resultados</strong>
              <em>
                {searchResultStickers.length} opciones
                {searchSectionId ? ' filtradas' : ''}
              </em>
            </div>

            {searchResultStickers.length ? (
              <div className="album-sticker-grid">
                {searchResultStickers.map((sticker) => (
                  <StickerCard
                    key={sticker.code}
                    sticker={sticker}
                    stickerState={collection[sticker.code]}
                    accentColor={getAccentColorForTeam(sticker.teamCode)}
                    onToggleOwned={onToggleOwned}
                    onTogglePasted={onTogglePasted}
                    onIncrementDuplicates={onIncrementDuplicates}
                    onDecrementDuplicates={onDecrementDuplicates}
                    variant="album-grid"
                  />
                ))}
              </div>
            ) : (
              <section className="empty-state">
                <h3>No encontramos estampitas.</h3>
                <p>Prueba con otro código, nombre, equipo o tipo.</p>
              </section>
            )}
          </section>
        ) : null}
      </section>
    </div>
  )
}

export default AlbumPage
