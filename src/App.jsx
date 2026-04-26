import { useEffect, useMemo, useRef, useState } from 'react'
import BottomNav from './components/BottomNav'
import AlbumPage from './pages/AlbumPage'
import DuplicatesPage from './pages/DuplicatesPage'
import HomePage from './pages/HomePage'
import MissingPage from './pages/MissingPage'
import SettingsPage from './pages/SettingsPage'
import {
  exportCollectionBackup,
  importCollectionBackup,
  loadCollectionState,
  resetCollectionState,
  saveCollectionState,
} from './storage/localCollection'
import { buildCollectionStats } from './utils/collectionStats'
import { playStickerSound } from './utils/sounds'
import './styles.css'

const CHECKLIST_PATH = '/data/checklist_mundial_2026_base_980_template.json'
const TARGET_HIGHLIGHT_MS = 880
const SOUND_ENABLED_KEY = 'sticker-tracker-2026-sound-enabled'
const ALBUM_FILTER_KEY = 'sticker-tracker-album-filter'

const tabs = [
  { id: 'home', label: 'Inicio' },
  { id: 'album', label: 'Mi álbum' },
  { id: 'missing', label: 'Faltantes' },
  { id: 'duplicates', label: 'Repetidas' },
  { id: 'settings', label: 'Ajustes' },
]

const infoPages = {
  '/como-usar': {
    label: 'Guía',
    title: 'Cómo usar Mi Álbum 2026',
    body: [
      'Mi Álbum 2026 sirve para controlar estampitas desde el celular de forma simple y no oficial.',
      'Puedes marcar las que tienes, ver faltantes, registrar repetidas, marcar pegadas, compartir listas y guardar un respaldo privado de tu progreso.',
    ],
    links: [
      { href: '/checklist-album-mundial-2026', text: 'Ver checklist' },
      { href: '/faltantes-estampitas-mundial-2026', text: 'Organizar faltantes' },
    ],
  },
  '/checklist-album-mundial-2026': {
    label: 'Checklist',
    title: 'Checklist no oficial para tu álbum 2026',
    body: [
      'Mi Álbum 2026 funciona como checklist digital no oficial para llevar control de la colección.',
      'La app te ayuda a revisar tenidas, faltantes, repetidas, pegadas y progreso general sin usar logos oficiales ni material protegido.',
    ],
    links: [
      { href: '/como-usar', text: 'Cómo usar' },
      { href: '/album-mundial-2026-pdf', text: 'Checklist PDF' },
    ],
  },
  '/faltantes-estampitas-mundial-2026': {
    label: 'Faltantes',
    title: 'Cómo organizar tus faltantes',
    body: [
      'La app permite ver las estampitas que faltan, organizarlas por sección y consultar el progreso de cada parte del álbum.',
      'También puedes copiar o compartir tu lista de faltantes por WhatsApp para coordinar intercambios con otros coleccionistas.',
    ],
    links: [
      { href: '/repetidas-estampitas-mundial-2026', text: 'Ver repetidas' },
      { href: '/checklist-album-mundial-2026', text: 'Checklist' },
    ],
  },
  '/repetidas-estampitas-mundial-2026': {
    label: 'Repetidas',
    title: 'Cómo controlar tus repetidas',
    body: [
      'Mi Álbum 2026 permite registrar repetidas, ver qué estampitas sobran y preparar intercambios con otros coleccionistas.',
      'Desde cada carta puedes sumar o quitar copias, y luego compartir una lista compacta de intercambio.',
    ],
    links: [
      { href: '/faltantes-estampitas-mundial-2026', text: 'Ver faltantes' },
      { href: '/como-usar', text: 'Cómo usar' },
    ],
  },
  '/album-mundial-2026-pdf': {
    label: 'PDF no oficial',
    title: 'Checklist PDF no oficial para tu álbum 2026',
    body: [
      'Descarga un checklist PDF no oficial para anotar tus estampitas, faltantes, repetidas y pegadas.',
      'Este archivo no es un álbum oficial ni contiene material protegido; es una herramienta de organización para coleccionistas.',
      'Mi Álbum 2026 también es una alternativa digital no oficial para organizar la colección desde el celular.',
    ],
    download: {
      href: '/downloads/mi-album-2026-checklist-no-oficial.pdf',
      text: 'Descargar checklist PDF',
    },
    links: [
      { href: '/como-usar', text: 'Cómo usar' },
      { href: '/checklist-album-mundial-2026', text: 'Checklist digital' },
    ],
  },
}

function normalizePathname(pathname) {
  if (!pathname || pathname === '/') {
    return '/'
  }

  return pathname.replace(/\/+$/, '')
}

function InfoPage({ page }) {
  return (
    <main className="info-page-shell">
      <article className="info-page-card">
        <p className="page-label">{page.label}</p>
        <h1>{page.title}</h1>
        <div className="info-page-copy">
          {page.body.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
        <p className="info-page-notice">
          Mi Álbum 2026 es una herramienta no oficial. No está afiliada,
          patrocinada ni respaldada por FIFA, Panini ni ninguna entidad oficial.
          Las marcas mencionadas pertenecen a sus respectivos propietarios.
        </p>
        <div className="info-page-actions">
          {page.download ? (
            <a className="info-page-button" href={page.download.href} download>
              {page.download.text}
            </a>
          ) : null}
          <a className="info-page-button" href="/">
            Volver a la app
          </a>
        </div>
        <nav className="info-page-links" aria-label="Páginas relacionadas">
          {page.links.map((link) => (
            <a key={link.href} href={link.href}>
              {link.text}
            </a>
          ))}
        </nav>
      </article>
    </main>
  )
}

function pruneCollectionEntry(currentCollection, code, nextState) {
  const normalizedNextState = {
    ...nextState,
    pasted: nextState.owned ? Boolean(nextState.pasted) : false,
  }

  if (!normalizedNextState.owned && normalizedNextState.duplicates === 0) {
    const nextCollection = { ...currentCollection }
    delete nextCollection[code]
    return nextCollection
  }

  return {
    ...currentCollection,
    [code]: normalizedNextState,
  }
}

function App() {
  const headerRef = useRef(null)
  const mainRef = useRef(null)
  const navRef = useRef(null)
  const highlightedTabTimeoutRef = useRef(null)
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('sticker-tracker-tab') || 'home')
  const [selectedSectionId, setSelectedSectionId] = useState(() => localStorage.getItem('sticker-tracker-section') || '')
  const [albumFilter, setAlbumFilter] = useState(() => localStorage.getItem(ALBUM_FILTER_KEY) || 'all')
  const [targetStickerCode, setTargetStickerCode] = useState('')
  const [targetStickerTransition, setTargetStickerTransition] = useState(null)
  const [highlightedTabId, setHighlightedTabId] = useState('')
  const [isSoundEnabled, setIsSoundEnabled] = useState(
    () => localStorage.getItem(SOUND_ENABLED_KEY) !== 'false',
  )
  const isRestoringHistoryRef = useRef(false)
  const [checklist, setChecklist] = useState(null)
  const [collection, setCollection] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [layoutMetrics, setLayoutMetrics] = useState({
    headerHeight: 0,
    navHeight: 0,
    homeAvailableHeight: 0,
  })

  useEffect(() => {
    let isMounted = true

    const loadChecklist = async () => {
      try {
        setIsLoading(true)
        setError('')

        const response = await fetch(CHECKLIST_PATH)

        if (!response.ok) {
          throw new Error(`No se pudo cargar el checklist (${response.status}).`)
        }

        const payload = await response.json()
        const baseStickers = Array.isArray(payload.stickers)
          ? payload.stickers.filter(
            (sticker) => sticker.isAlbumBase && !sticker.isExtraOrParallel,
          )
          : []

        const savedCollection = loadCollectionState()

        if (!isMounted) {
          return
        }

        setChecklist({
          ...payload,
          stickers: baseStickers,
        })
        setCollection(savedCollection)
      } catch (loadError) {
        if (isMounted) {
          setError(loadError.message || 'Ocurrió un error al cargar la app.')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadChecklist()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!checklist) {
      return
    }

    saveCollectionState(collection)
  }, [checklist, collection])

  useEffect(() => {
    localStorage.setItem('sticker-tracker-tab', activeTab)
  }, [activeTab])

  useEffect(() => {
    localStorage.setItem(ALBUM_FILTER_KEY, albumFilter)
  }, [albumFilter])

  useEffect(() => {
    localStorage.setItem(SOUND_ENABLED_KEY, isSoundEnabled ? 'true' : 'false')
  }, [isSoundEnabled])

  useEffect(() => {
    if (selectedSectionId) {
      localStorage.setItem('sticker-tracker-section', selectedSectionId)
    } else {
      localStorage.removeItem('sticker-tracker-section')
    }
  }, [selectedSectionId])

  useEffect(() => {
    if (!toast) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setToast('')
    }, 400)

    return () => window.clearTimeout(timeoutId)
  }, [toast])

  useEffect(() => {
    return () => {
      if (highlightedTabTimeoutRef.current) {
        window.clearTimeout(highlightedTabTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const updateLayoutMetrics = () => {
      const nextHeaderHeight = headerRef.current?.offsetHeight ?? 0
      const nextNavHeight = navRef.current?.offsetHeight ?? 0
      const nextHomeAvailableHeight =
        activeTab === 'home' &&
          mainRef.current &&
          navRef.current
          ? Math.max(
            0,
            Math.floor(
              navRef.current.getBoundingClientRect().top -
              mainRef.current.getBoundingClientRect().top,
            ),
          )
          : 0

      setLayoutMetrics((currentMetrics) => {
        if (
          currentMetrics.headerHeight === nextHeaderHeight &&
          currentMetrics.navHeight === nextNavHeight &&
          currentMetrics.homeAvailableHeight === nextHomeAvailableHeight
        ) {
          return currentMetrics
        }

        return {
          headerHeight: nextHeaderHeight,
          navHeight: nextNavHeight,
          homeAvailableHeight: nextHomeAvailableHeight,
        }
      })
    }

    updateLayoutMetrics()

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => updateLayoutMetrics())
        : null

    if (headerRef.current && resizeObserver) {
      resizeObserver.observe(headerRef.current)
    }

    if (navRef.current && resizeObserver) {
      resizeObserver.observe(navRef.current)
    }

    if (mainRef.current && resizeObserver) {
      resizeObserver.observe(mainRef.current)
    }

    window.addEventListener('resize', updateLayoutMetrics)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateLayoutMetrics)
    }
  }, [activeTab])

  useEffect(() => {
    const handlePopState = (event) => {
      isRestoringHistoryRef.current = true
      setSelectedSectionId(event.state?.sectionId || '')
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (isRestoringHistoryRef.current) {
      isRestoringHistoryRef.current = false
      return
    }
    if (!selectedSectionId) return
    if (window.history.state?.sectionId === selectedSectionId) return

    if (window.history.state?.sectionId) {
      window.history.replaceState(
        { ...(window.history.state ?? {}), sectionId: selectedSectionId },
        '',
        window.location.href
      )
    } else {
      window.history.pushState(
        { ...(window.history.state ?? {}), sectionId: selectedSectionId },
        '',
        window.location.href
      )
    }
  }, [selectedSectionId])

  const handleSelectSection = (sectionId) => {
    setSelectedSectionId(sectionId)
    window.scrollTo(0, 0)
  }

  const pulseTab = (tabId) => {
    if (highlightedTabTimeoutRef.current) {
      window.clearTimeout(highlightedTabTimeoutRef.current)
    }

    setHighlightedTabId(tabId)
    highlightedTabTimeoutRef.current = window.setTimeout(() => {
      setHighlightedTabId('')
      highlightedTabTimeoutRef.current = null
    }, TARGET_HIGHLIGHT_MS)
  }

  const playAppSound = (type) => {
    if (isSoundEnabled) {
      playStickerSound(type)
    }
  }

  const handleOpenStickerInAlbum = (sticker) => {
    const sectionId = sticker.teamCode
      ? `team-${sticker.teamCode}`
      : `section-${sticker.section || 'general'}`

    playAppSound('add')
    setCollection((currentCollection) => {
      const currentStickerState = currentCollection[sticker.code] ?? {
        owned: false,
        duplicates: 0,
      }

      return pruneCollectionEntry(currentCollection, sticker.code, {
        ...currentStickerState,
        owned: true,
      })
    })
    setSelectedSectionId(sectionId)
    setTargetStickerCode(sticker.code)
    setTargetStickerTransition(null)
    pulseTab('album')
    setActiveTab('album')
  }

  const handleOpenDuplicateInAlbum = (sticker) => {
    const sectionId = sticker.teamCode
      ? `team-${sticker.teamCode}`
      : `section-${sticker.section || 'general'}`
    const currentDuplicates = collection[sticker.code]?.duplicates ?? 0
    const fromCount = currentDuplicates + 1
    const toCount = Math.max(0, currentDuplicates - 1) + 1

    playAppSound('duplicate')
    setCollection((currentCollection) => {
      const currentStickerState = currentCollection[sticker.code]

      if (!currentStickerState) {
        return currentCollection
      }

      return pruneCollectionEntry(currentCollection, sticker.code, {
        owned: currentStickerState.owned,
        duplicates: Math.max(0, currentStickerState.duplicates - 1),
        pasted: currentStickerState.pasted,
      })
    })
    setSelectedSectionId(sectionId)
    setTargetStickerCode(sticker.code)
    setTargetStickerTransition({
      code: sticker.code,
      fromCount,
      toCount,
    })
    pulseTab('album')
    setActiveTab('album')
  }

  const handleCloseSection = () => {
    if (window.history.state?.sectionId) {
      window.history.back()
      return
    }
    setSelectedSectionId('')
  }

  const scrollPageToTop = () => {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
      mainRef.current?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' })
    })
  }

  const handleTabChange = (nextTab) => {
    const shouldScrollToTop =
      ['album', 'missing', 'duplicates'].includes(nextTab) &&
      !selectedSectionId

    if (albumFilter === 'missing' || albumFilter === 'duplicates') {
      setAlbumFilter('all')
    }

    if (nextTab === 'home') {
      setSelectedSectionId('')
      setTargetStickerCode('')
      setTargetStickerTransition(null)
    }

    if (activeTab === 'home' && nextTab === 'album') {
      playAppSound('page')
      setSelectedSectionId('')
      setTargetStickerCode('')
      setTargetStickerTransition(null)
    }

    setActiveTab(nextTab)

    if (shouldScrollToTop) {
      scrollPageToTop()
    }
  }

  const stickers = useMemo(() => checklist?.stickers ?? [], [checklist])
  const teams = useMemo(() => checklist?.teams ?? [], [checklist])

  const stats = useMemo(
    () => buildCollectionStats(stickers, collection),
    [stickers, collection],
  )

  const handleToggleOwned = (code) => {
    const isCurrentlyOwned = collection[code]?.owned
    const isCurrentlyPasted = collection[code]?.pasted

    if (isCurrentlyOwned && isCurrentlyPasted) {
      return
    }

    if (isCurrentlyOwned) {
      playAppSound('close')
    } else {
      playAppSound('add')
    }

    setCollection((currentCollection) => {
      const currentStickerState = currentCollection[code] ?? {
        owned: false,
        duplicates: 0,
      }
      const nextOwned = !currentStickerState.owned

      return pruneCollectionEntry(currentCollection, code, {
        ...currentStickerState,
        owned: nextOwned,
        duplicates: nextOwned ? currentStickerState.duplicates : 0,
        pasted: nextOwned ? currentStickerState.pasted : false,
      })
    })
  }

  const handleIncrementDuplicates = (code) => {
    playAppSound('duplicate')
    pulseTab('duplicates')

    setCollection((currentCollection) => {
      const currentStickerState = currentCollection[code] ?? {
        owned: false,
        duplicates: 0,
      }

      return pruneCollectionEntry(currentCollection, code, {
        owned: true,
        duplicates: currentStickerState.duplicates + 1,
        pasted: currentStickerState.pasted,
      })
    })
  }

  const handleDecrementDuplicates = (code) => {
    const currentDuplicates = collection[code]?.duplicates ?? 0

    if (currentDuplicates > 0) {
      playAppSound('duplicate')
    }

    setCollection((currentCollection) => {
      const currentStickerState = currentCollection[code]

      if (!currentStickerState) {
        return currentCollection
      }

      const nextDuplicates = Math.max(0, currentStickerState.duplicates - 1)

      return pruneCollectionEntry(currentCollection, code, {
        owned: currentStickerState.owned,
        duplicates: nextDuplicates,
        pasted: currentStickerState.pasted,
      })
    })
  }

  const handleTogglePasted = (code) => {
    const isCurrentlyPasted = collection[code]?.pasted

    if (!isCurrentlyPasted) {
      playAppSound('paste')
    }

    setCollection((currentCollection) => {
      const currentStickerState = currentCollection[code]

      if (!currentStickerState?.owned) {
        return currentCollection
      }

      return pruneCollectionEntry(currentCollection, code, {
        ...currentStickerState,
        pasted: !currentStickerState.pasted,
      })
    })
  }

  const handleCopyText = async (text, successMessage) => {
    try {
      await navigator.clipboard.writeText(text)
      setToast(successMessage)
    } catch {
      setToast('No se pudo copiar el texto.')
    }
  }

  const handleShareWhatsApp = (text) => {
    const shareUrl = `https://wa.me/?text=${encodeURIComponent(text)}`
    window.open(shareUrl, '_blank', 'noopener,noreferrer')
  }

  const handleExportBackup = () => {
    const backupContent = exportCollectionBackup(collection, { isSoundEnabled })
    const blob = new Blob([backupContent], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)

    link.href = url
    link.download = `sticker-tracker-2026-respaldo-${stamp}.albu`
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setToast('Respaldo guardado.')
  }

  const handleImportBackup = async (file) => {
    if (!file) {
      return
    }

    try {
      const importedText = await file.text()
      const importedBackup = importCollectionBackup(importedText)
      setCollection(importedBackup.collection)

      if (typeof importedBackup.isSoundEnabled === 'boolean') {
        setIsSoundEnabled(importedBackup.isSoundEnabled)
      }

      setToast('Respaldo subido correctamente.')
    } catch (importError) {
      setToast(importError.message || 'No se pudo importar el respaldo.')
    }
  }

  const handleResetCollection = () => {
    const wasConfirmed = window.confirm(
      'Se borrará tu progreso guardado. ¿Quieres reiniciar la colección?',
    )

    if (!wasConfirmed) {
      return
    }

    resetCollectionState()
    setCollection({})
    setToast('Colección reiniciada.')
  }

  const pageProps = {
    stickers,
    teams,
    collection,
    stats,
    selectedSectionId,
    activeFilter: albumFilter,
    targetStickerCode,
    targetStickerTransition,
    onFilterChange: setAlbumFilter,
    onSelectSection: handleSelectSection,
    onCloseSection: handleCloseSection,
    onOpenStickerInAlbum: handleOpenStickerInAlbum,
    onOpenDuplicateInAlbum: handleOpenDuplicateInAlbum,
    onTargetStickerHandled: () => {
      setTargetStickerCode('')
      setTargetStickerTransition(null)
    },
    onToggleOwned: handleToggleOwned,
    onTogglePasted: handleTogglePasted,
    onIncrementDuplicates: handleIncrementDuplicates,
    onDecrementDuplicates: handleDecrementDuplicates,
    onCopyText: handleCopyText,
    onShareWhatsApp: handleShareWhatsApp,
    onNavigate: handleTabChange,
    onPageTurnSound: () => playAppSound('page'),
  }

  const currentInfoPage = infoPages[normalizePathname(window.location.pathname)]

  if (currentInfoPage) {
    return <InfoPage page={currentInfoPage} />
  }

  const activePage = (() => {
    if (isLoading) {
      return (
        <section className="state-panel">
          <p className="state-kicker">Sticker Tracker 2026</p>
          <h1>Cargando checklist base...</h1>
          <p>Preparando tu control personal de colección.</p>
        </section>
      )
    }

    if (error) {
      return (
        <section className="state-panel">
          <p className="state-kicker">Error de carga</p>
          <h1>No pudimos abrir el checklist.</h1>
          <p>{error}</p>
        </section>
      )
    }

    switch (activeTab) {
      case 'album':
        return <AlbumPage {...pageProps} />
      case 'missing':
        return <MissingPage {...pageProps} />
      case 'duplicates':
        return <DuplicatesPage {...pageProps} />
      case 'settings':
        return (
          <SettingsPage
            collection={collection}
            onExportBackup={handleExportBackup}
            onImportBackup={handleImportBackup}
            onResetCollection={handleResetCollection}
            isSoundEnabled={isSoundEnabled}
            onToggleSound={() => setIsSoundEnabled((currentValue) => !currentValue)}
          />
        )
      case 'home':
      default:
        return <HomePage {...pageProps} />
    }
  })()

  return (
    <div
      className={`app-shell ${activeTab === 'home' ? 'is-home' : ''}`}
      style={{
        '--measured-header-height': layoutMetrics.headerHeight
          ? `${layoutMetrics.headerHeight}px`
          : undefined,
        '--measured-nav-height': layoutMetrics.navHeight
          ? `${layoutMetrics.navHeight}px`
          : undefined,
        '--home-available-height': layoutMetrics.homeAvailableHeight
          ? `${layoutMetrics.homeAvailableHeight}px`
          : undefined,
      }}
    >
      <main
        ref={mainRef}
        className={`app-main ${activeTab === 'home' ? 'is-home' : ''}`}
      >
        {activePage}
      </main>

      <BottomNav
        ref={navRef}
        tabs={tabs}
        activeTab={activeTab}
        highlightedTabId={highlightedTabId}
        onChange={handleTabChange}
      />

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}

export default App
