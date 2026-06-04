import { useEffect, useMemo, useRef, useState } from 'react'
import BottomNav from './components/BottomNav'
import AlbumPage from './pages/AlbumPage'
import DuplicatesPage from './pages/DuplicatesPage'
import HomePage from './pages/HomePage'
import MissingPage from './pages/MissingPage'
import SettingsPage from './pages/SettingsPage'
import CameraAddPage from './pages/CameraAddPage'
import {
  exportCollectionBackup,
  importCollectionBackup,
  loadCollectionState,
  resetCollectionState,
  saveCollectionState,
} from './storage/localCollection'
import { buildCollectionStats } from './utils/collectionStats'
import { canonicalIdToAppCode } from './utils/qrExchangeCodec'
import { playStickerSound } from './utils/sounds'
import './styles.css'

const CHECKLIST_PATH = '/data/checklist_mundial_2026_base_980_template.json'
const TARGET_HIGHLIGHT_MS = 880
const SOUND_ENABLED_KEY = 'sticker-tracker-2026-sound-enabled'
const ALBUM_FILTER_KEY = 'sticker-tracker-album-filter'
const ACTION_HISTORY_KEY = 'sticker-tracker-2026-action-history-v2'
const SITE_URL = 'https://mi-album-2026-guatemala.vercel.app'
const HISTORY_MAX = 50

function buildStickerHistoryLabel(sticker) {
  if (!sticker) {
    return ''
  }

  const teamOrSection = sticker.teamNameEs || sticker.teamName || sticker.section || 'Sección'
  const numberOrCode = sticker.localNumber || sticker.code || ''
  const stickerName = sticker.name ? ` · ${sticker.name}` : ''

  return `${teamOrSection} ${numberOrCode}${stickerName}`.trim()
}

function normalizeAddedHistoryEntry(entry) {
  if (typeof entry === 'string') {
    return { code: entry, kind: 'owned' }
  }

  if (!entry || typeof entry !== 'object' || !entry.code) {
    return null
  }

  return {
    code: String(entry.code),
    kind: entry.kind === 'duplicate' ? 'duplicate' : 'owned',
  }
}

const tabs = [
  { id: 'home', label: 'Inicio' },
  { id: 'album', label: 'Mi álbum' },
  { id: 'missing', label: 'Faltantes' },
  { id: 'duplicates', label: 'Repetidas' },
  { id: 'camera', label: 'Intercambio' },
  { id: 'settings', label: 'Ajustes' },
]

const navTabs = tabs
const mainTabIds = new Set(tabs.map((tab) => tab.id))

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
  '/precio-album-mundial-2026-guatemala': {
    label: 'Precios Guatemala',
    title: 'Precio del álbum Mundial 2026 en Guatemala',
    seoTitle: 'Precio álbum Mundial 2026 Guatemala | Sobres y cajas',
    description:
      'Consulta precios publicados en nuestra página: sobre individual Q9.50, caja de 104 sobres Q950, álbum pasta suave Q30 y pasta dura Q150. Venta en Guatemala por WhatsApp.',
    body: [
      'Consulta precios publicados en nuestra página para álbumes, sobres y cajas del Mundial 2026 en Guatemala.',
      'Vendemos producto físico original para coleccionistas. Los precios están sujetos a disponibilidad.',
    ],
    priceCards: [
      { label: 'Sobre individual', value: 'Q9.50' },
      { label: 'Caja de 104 sobres', value: 'Q950', note: 'Precio de oferta' },
      { label: 'Álbum pasta suave', value: 'Q30' },
      { label: 'Álbum pasta dura', value: 'Q150' },
    ],
    highlight:
      'La caja incluye 104 sobres. Comprando 104 sobres individuales pagarías Q988; con la oferta de caja pagas Q950 y ahorras Q38.',
    whatsapp: {
      href: 'https://wa.me/50258714824?text=Hola%2C%20quiero%20consultar%20precios%20del%20album%2C%20sobres%20y%20caja%20del%20Mundial%202026%20en%20Guatemala.',
      text: 'Consultar precios por WhatsApp',
    },
    legalNotice:
      'Mi Álbum 2026 es una herramienta y página de venta no afiliada ni patrocinada por FIFA, Panini ni ninguna entidad oficial. Las marcas mencionadas pertenecen a sus respectivos propietarios.',
    links: [
      { href: '/sobres-mundial-2026-guatemala', text: 'Ver sobres y cajas' },
      { href: '/album-mundial-2026-guatemala', text: 'Álbum en Guatemala' },
    ],
  },
  '/album-mundial-2026-guatemala': {
    label: 'Venta Guatemala',
    title: 'Álbum Mundial 2026 en Guatemala',
    seoTitle: 'Álbum Mundial 2026 Guatemala | Compra álbum y sobres',
    description:
      'Compra álbum Mundial 2026 en Guatemala. Álbum pasta suave Q30, pasta dura Q150, sobre Q9.50 y caja de 104 sobres Q950. Consulta disponibilidad por WhatsApp.',
    body: [
      'Compra álbumes, sobres y cajas del Mundial 2026 en Guatemala.',
      'Consulta disponibilidad por WhatsApp. También puedes usar Mi Álbum 2026 como herramienta digital no oficial para controlar tus estampitas, faltantes, repetidas y pegadas.',
    ],
    priceCards: [
      { label: 'Sobre', value: 'Q9.50' },
      { label: 'Caja de 104 sobres', value: 'Q950' },
      { label: 'Álbum pasta suave', value: 'Q30' },
      { label: 'Álbum pasta dura', value: 'Q150' },
    ],
    whatsapp: {
      href: 'https://wa.me/50258714824?text=Hola%2C%20quiero%20comprar%20album%2C%20sobres%20o%20caja%20del%20Mundial%202026%20en%20Guatemala.',
      text: 'Comprar por WhatsApp',
    },
    legalNotice:
      'Mi Álbum 2026 es una herramienta y página de venta no afiliada ni patrocinada por FIFA, Panini ni ninguna entidad oficial. Las marcas mencionadas pertenecen a sus respectivos propietarios.',
    links: [
      { href: '/precio-album-mundial-2026-guatemala', text: 'Ver precios' },
      { href: '/sobres-mundial-2026-guatemala', text: 'Comprar sobres' },
    ],
  },
  '/sobres-mundial-2026-guatemala': {
    label: 'Sobres Guatemala',
    title: 'Sobres del Mundial 2026 en Guatemala',
    seoTitle: 'Sobres Mundial 2026 Guatemala | Caja de 104 sobres',
    description:
      'Compra sobres del Mundial 2026 en Guatemala. Sobre individual Q9.50 y caja de 104 sobres Q950 en oferta. Consulta disponibilidad por WhatsApp.',
    body: [
      'Consulta disponibilidad de sobres y cajas del Mundial 2026 en Guatemala.',
    ],
    priceCards: [
      { label: 'Sobre individual', value: 'Q9.50' },
      { label: 'Caja de 104 sobres', value: 'Q950', note: 'Oferta' },
      { label: 'Precio efectivo aproximado por sobre en caja', value: 'Q9.13' },
      { label: 'Ahorro aproximado vs 104 sobres individuales', value: 'Q38' },
    ],
    whatsapp: {
      href: 'https://wa.me/50258714824?text=Hola%2C%20quiero%20consultar%20sobres%20y%20cajas%20del%20Mundial%202026%20en%20Guatemala.',
      text: 'Consultar sobres por WhatsApp',
    },
    legalNotice:
      'Mi Álbum 2026 es una herramienta y página de venta no afiliada ni patrocinada por FIFA, Panini ni ninguna entidad oficial. Las marcas mencionadas pertenecen a sus respectivos propietarios.',
    links: [
      { href: '/precio-album-mundial-2026-guatemala', text: 'Ver precios' },
      { href: '/album-mundial-2026-guatemala', text: 'Álbum en Guatemala' },
    ],
  },
  '/todos-los-cromos-mundial-2026': {
    label: 'Cromos 2026',
    title: 'Todos los cromos del Mundial 2026',
    seoTitle: 'Todos los cromos del Mundial 2026 | Checklist no oficial',
    description:
      'Checklist digital no oficial para controlar cromos, figuritas, estampitas y stickers del Mundial 2026. Marca las que tienes, repetidas, pegadas y revisa tu progreso.',
    body: [
      'Mi Álbum 2026 es una herramienta no oficial para controlar tu colección del Mundial 2026. Puedes usarla para marcar las estampitas que ya tienes, ver tus faltantes, registrar repetidas, marcar pegadas y llevar el progreso de tu álbum desde el celular.',
      'En algunos países se les llama cromos, en otros figuritas, estampitas, láminas o stickers. La app funciona como checklist digital para organizar tu colección sin importar cómo les llames.',
      'No ofrecemos material oficial ni imágenes protegidas. Esta es una herramienta de organización para coleccionistas.',
    ],
    download: {
      href: '/downloads/mi-album-2026-checklist-no-oficial.pdf',
      text: 'Descargar checklist PDF',
    },
    links: [
      { href: '/', text: 'Usar checklist digital' },
      { href: '/album-mundial-2026-guatemala', text: 'Comprar en Guatemala' },
      { href: '/lista-estampitas-mundial-2026', text: 'Lista de estampitas' },
      { href: '/figuritas-mundial-2026', text: 'Figuritas' },
      { href: '/stickers-mundial-2026', text: 'Stickers' },
    ],
  },
  '/lista-estampitas-mundial-2026': {
    label: 'Estampitas',
    title: 'Lista de estampitas del Mundial 2026',
    seoTitle: 'Lista de estampitas Mundial 2026 | Checklist digital',
    description:
      'Usa Mi Álbum 2026 como lista digital no oficial para controlar estampitas del Mundial 2026: tenidas, repetidas, pegadas y progreso de colección.',
    body: [
      'Usa Mi Álbum 2026 como lista digital no oficial para controlar tus estampitas, faltantes, repetidas y pegadas. Esta herramienta está pensada para coleccionistas que quieren organizar su álbum desde el celular.',
    ],
    links: [
      { href: '/todos-los-cromos-mundial-2026', text: 'Todos los cromos' },
      { href: '/', text: 'Usar checklist digital' },
    ],
  },
  '/figuritas-mundial-2026': {
    label: 'Figuritas',
    title: 'Figuritas del Mundial 2026',
    seoTitle: 'Figuritas del Mundial 2026 | Checklist digital no oficial',
    body: [
      'Si en tu país les llamas figuritas, puedes usar Mi Álbum 2026 para llevar un control digital no oficial de tu colección: figuritas que tienes, faltantes, repetidas y pegadas.',
    ],
    links: [
      { href: '/todos-los-cromos-mundial-2026', text: 'Todos los cromos' },
      { href: '/', text: 'Usar checklist digital' },
    ],
    description: 'Control de figuritas del Mundial 2026 con herramienta digital no oficial.',
  },
  '/stickers-mundial-2026': {
    label: 'Stickers',
    title: 'Stickers del Mundial 2026',
    seoTitle: 'Stickers del Mundial 2026 | Checklist digital no oficial',
    body: [
      'Controla tus stickers del Mundial 2026 con una herramienta digital no oficial. Marca los que tienes, revisa faltantes, registra repetidas y guarda tu progreso.',
    ],
    links: [
      { href: '/todos-los-cromos-mundial-2026', text: 'Todos los cromos' },
      { href: '/', text: 'Usar checklist digital' },
    ],
    description: 'Checklist digital no oficial para stickers del Mundial 2026.',
  },
}

function setOrCreateMeta(selector, setAttributes) {
  let element = document.querySelector(selector)
  const existed = Boolean(element)

  if (!element) {
    element = document.createElement('meta')
    document.head.appendChild(element)
  }

  Object.entries(setAttributes).forEach(([key, value]) => {
    element.setAttribute(key, value)
  })

  return { element, existed }
}

function setOrCreateCanonical(href) {
  let element = document.querySelector('link[rel="canonical"]')
  const existed = Boolean(element)

  if (!element) {
    element = document.createElement('link')
    element.setAttribute('rel', 'canonical')
    document.head.appendChild(element)
  }

  element.setAttribute('href', href)
  return { element, existed }
}

function normalizePathname(pathname) {
  if (!pathname || pathname === '/') {
    return '/'
  }

  return pathname.replace(/\/+$/, '')
}

function InfoPage({ page }) {
  useEffect(() => {
    const pathname = normalizePathname(window.location.pathname)
    const canonicalHref = `${SITE_URL}${pathname === '/' ? '' : pathname}`
    const titleValue = page.seoTitle || `${page.title} | Mi Álbum 2026`
    const descriptionValue =
      page.description ||
      page.body?.[0] ||
      'Mi Álbum 2026, herramienta no oficial para coleccionistas.'
    const previousTitle = document.title
    const trackedNodes = []

    const captureNode = (node, existed) => {
      trackedNodes.push({
        node,
        existed,
        attrs: node.getAttributeNames().reduce((acc, name) => {
          acc[name] = node.getAttribute(name)
          return acc
        }, {}),
      })
    }

    const descriptionMeta = setOrCreateMeta('meta[name="description"]', {
      name: 'description',
      content: descriptionValue,
    })
    const ogTitleMeta = setOrCreateMeta('meta[property="og:title"]', {
      property: 'og:title',
      content: titleValue,
    })
    const ogDescriptionMeta = setOrCreateMeta('meta[property="og:description"]', {
      property: 'og:description',
      content: descriptionValue,
    })
    const ogUrlMeta = setOrCreateMeta('meta[property="og:url"]', {
      property: 'og:url',
      content: canonicalHref,
    })
    const twitterTitleMeta = setOrCreateMeta('meta[name="twitter:title"]', {
      name: 'twitter:title',
      content: titleValue,
    })
    const twitterDescriptionMeta = setOrCreateMeta('meta[name="twitter:description"]', {
      name: 'twitter:description',
      content: descriptionValue,
    })
    const canonicalLink = setOrCreateCanonical(canonicalHref)

    ;[
      descriptionMeta,
      ogTitleMeta,
      ogDescriptionMeta,
      ogUrlMeta,
      twitterTitleMeta,
      twitterDescriptionMeta,
      canonicalLink,
    ].forEach(({ element, existed }) => captureNode(element, existed))

    document.title = titleValue

    return () => {
      document.title = previousTitle

      trackedNodes.forEach(({ node, existed, attrs }) => {
        if (!existed) {
          node.remove()
          return
        }

        node.getAttributeNames().forEach((attrName) => {
          if (!(attrName in attrs)) {
            node.removeAttribute(attrName)
          }
        })

        Object.entries(attrs).forEach(([name, value]) => {
          if (value === null || typeof value === 'undefined') {
            node.removeAttribute(name)
          } else {
            node.setAttribute(name, value)
          }
        })
      })
    }
  }, [page])

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
        {Array.isArray(page.priceCards) && page.priceCards.length ? (
          <section className="info-price-grid" aria-label="Resumen de precios">
            {page.priceCards.map((item) => (
              <article key={`${item.label}-${item.value}`} className="info-price-card">
                <p>{item.label}</p>
                <strong>{item.value}</strong>
                {item.note ? <span>{item.note}</span> : null}
              </article>
            ))}
          </section>
        ) : null}
        {page.highlight ? (
          <p className="info-price-highlight">{page.highlight}</p>
        ) : null}
        <p className="info-page-notice">
          {page.legalNotice ||
            'Mi Álbum 2026 es una herramienta no oficial. No está afiliada, patrocinada ni respaldada por FIFA, Panini ni ninguna entidad oficial. Las marcas mencionadas pertenecen a sus respectivos propietarios.'}
        </p>
        <div className="info-page-actions">
          {page.whatsapp ? (
            <a
              className="info-page-button"
              href={page.whatsapp.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {page.whatsapp.text}
            </a>
          ) : null}
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
  const albumIndexScrollRef = useRef(0)
  const [activeTab, setActiveTab] = useState(() => {
    const storedTab = localStorage.getItem('sticker-tracker-tab') || 'home'
    return mainTabIds.has(storedTab) ? storedTab : 'home'
  })
  const [selectedSectionId, setSelectedSectionId] = useState(() => localStorage.getItem('sticker-tracker-section') || '')
  const [albumFilter, setAlbumFilter] = useState(() => localStorage.getItem(ALBUM_FILTER_KEY) || 'all')
  const [targetStickerCode, setTargetStickerCode] = useState('')
  const [targetStickerTransition, setTargetStickerTransition] = useState(null)
  const [lastMissingAction, setLastMissingAction] = useState(null)
  const [lastDuplicateAction, setLastDuplicateAction] = useState(null)
  const [highlightedTabId, setHighlightedTabId] = useState('')
  const [isSoundEnabled, setIsSoundEnabled] = useState(
    () => localStorage.getItem(SOUND_ENABLED_KEY) !== 'false',
  )
  const isRestoringHistoryRef = useRef(false)
  const [checklist, setChecklist] = useState(null)
  const [collection, setCollection] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)
  const [lastQrExchangeSnapshot, setLastQrExchangeSnapshot] = useState(null)
  const [actionHistory, setActionHistory] = useState(() => {
    localStorage.removeItem('sticker-tracker-2026-movement-history')
    localStorage.removeItem('sticker-tracker-2026-added-history')
    try {
      const raw = localStorage.getItem(ACTION_HISTORY_KEY)
      const parsed = raw ? JSON.parse(raw) : null
      if (!parsed || typeof parsed !== 'object') return {
        addedOwned: [], removedOwned: [], addedDuplicates: [], removedDuplicates: [], missingAdded: [], missingResolved: [],
      }
      return {
        addedOwned: Array.isArray(parsed.addedOwned) ? parsed.addedOwned.slice(0, HISTORY_MAX) : [],
        removedOwned: Array.isArray(parsed.removedOwned) ? parsed.removedOwned.slice(0, HISTORY_MAX) : [],
        addedDuplicates: Array.isArray(parsed.addedDuplicates) ? parsed.addedDuplicates.slice(0, HISTORY_MAX) : [],
        removedDuplicates: Array.isArray(parsed.removedDuplicates) ? parsed.removedDuplicates.slice(0, HISTORY_MAX) : [],
        missingAdded: Array.isArray(parsed.missingAdded) ? parsed.missingAdded.slice(0, HISTORY_MAX) : [],
        missingResolved: Array.isArray(parsed.missingResolved) ? parsed.missingResolved.slice(0, HISTORY_MAX) : [],
      }
    } catch {
      return { addedOwned: [], removedOwned: [], addedDuplicates: [], removedDuplicates: [], missingAdded: [], missingResolved: [] }
    }
  })
  const [undoPast, setUndoPast] = useState([])
  const [undoFuture, setUndoFuture] = useState([])
  const handleUndo = () => {}
  const handleRedo = () => {}
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
    localStorage.setItem(ACTION_HISTORY_KEY, JSON.stringify(actionHistory))
  }, [actionHistory])

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
      setToast(null)
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
    albumIndexScrollRef.current = window.scrollY || mainRef.current?.scrollTop || 0
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
    playAppSound('add')
    setCollection((currentCollection) => {
      const currentStickerState = currentCollection[sticker.code] ?? {
        owned: false,
        duplicates: 0,
        pasted: false,
      }
      setLastMissingAction({ code: sticker.code, previousState: currentStickerState })
      return pruneCollectionEntry(currentCollection, sticker.code, {
        ...currentStickerState,
        owned: true,
      })
    })
    setTargetStickerCode('')
    setTargetStickerTransition(null)
    const stickerLabel = stickerLabelByCode[sticker.code] || sticker.code
    setActionHistory((current) => ({
      ...current,
      addedOwned: [`Agrego ${stickerLabel}`, ...current.addedOwned].slice(0, HISTORY_MAX),
      missingResolved: [`Corrección: ${stickerLabel}`, ...current.missingResolved].slice(0, HISTORY_MAX),
    }))
    setToast({
      text: `Quitaste ${sticker.code} de tus faltantes`,
      actionLabel: 'Revertir',
      onAction: handleRevertMissingQuickAction,
    })
  }

  const handleOpenDuplicateInAlbum = (sticker) => {
    playAppSound('duplicate')
    setCollection((currentCollection) => {
      const currentStickerState = currentCollection[sticker.code]

      if (!currentStickerState) {
        return currentCollection
      }

      setLastDuplicateAction({ code: sticker.code, previousState: currentStickerState })
      return pruneCollectionEntry(currentCollection, sticker.code, {
        owned: currentStickerState.owned,
        duplicates: Math.max(0, currentStickerState.duplicates - 1),
        pasted: currentStickerState.pasted,
      })
    })
    setTargetStickerCode('')
    setTargetStickerTransition(null)
    setToast({
      text: `Quitaste ${sticker.code} de tus repetidas`,
      actionLabel: 'Revertir',
      onAction: handleRevertDuplicateQuickAction,
    })
  }

  const handleCloseSection = () => {
    setSelectedSectionId('')
    window.requestAnimationFrame(() => {
      const targetTop = Math.max(0, albumIndexScrollRef.current || 0)
      window.scrollTo({ top: targetTop, left: 0, behavior: 'auto' })
      mainRef.current?.scrollTo?.({ top: targetTop, left: 0, behavior: 'auto' })
    })
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
  const stickerLabelByCode = useMemo(() => {
    return stickers.reduce((acc, sticker) => {
      acc[sticker.code] = buildStickerHistoryLabel(sticker)
      return acc
    }, {})
  }, [stickers])

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

    const prevState = collection
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
    const stickerLabel = stickerLabelByCode[code] || code
    setActionHistory((current) => isCurrentlyOwned
      ? { ...current, removedOwned: [`Quito ${stickerLabel}`, ...current.removedOwned].slice(0, HISTORY_MAX), missingAdded: [`Faltante agregada: ${stickerLabel}`, ...current.missingAdded].slice(0, HISTORY_MAX) }
      : { ...current, addedOwned: [`Agrego ${stickerLabel}`, ...current.addedOwned].slice(0, HISTORY_MAX), missingResolved: [`Corrección: ${stickerLabel}`, ...current.missingResolved].slice(0, HISTORY_MAX) })
  }

  const handleIncrementDuplicates = (code) => {
    playAppSound('duplicate')
    pulseTab('duplicates')

    const prevState = collection
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

    const stickerLabel = stickerLabelByCode[code] || code
    setActionHistory((current) => ({ ...current, addedDuplicates: [`Agrego repetida ${stickerLabel}`, ...current.addedDuplicates].slice(0, HISTORY_MAX) }))
  }

  const handleDecrementDuplicates = (code) => {
    const currentDuplicates = collection[code]?.duplicates ?? 0

    if (currentDuplicates > 0) {
      playAppSound('duplicate')
    }

    const prevState = collection
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

    if (currentDuplicates > 0) {
      const stickerLabel = stickerLabelByCode[code] || code
      setActionHistory((current) => ({ ...current, removedDuplicates: [`Quito repetida ${stickerLabel}`, ...current.removedDuplicates].slice(0, HISTORY_MAX) }))
    }
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



  const applyExchangeCollectionChanges = (receiveCodes, giveCodes, exchangeOrigin) => {
    const previousCollection = collection

    setCollection((currentCollection) => {
      let nextCollection = currentCollection

      receiveCodes.forEach((canonicalCode) => {
        const code = canonicalIdToAppCode(canonicalCode)
        const currentStickerState = nextCollection[code] ?? {
          owned: false,
          duplicates: 0,
          pasted: false,
        }

        nextCollection = pruneCollectionEntry(nextCollection, code, {
          ...currentStickerState,
          owned: true,
          origin: exchangeOrigin,
        })
      })

      giveCodes.forEach((canonicalCode) => {
        const code = canonicalIdToAppCode(canonicalCode)
        const currentStickerState = nextCollection[code]

        if (!currentStickerState) {
          return
        }

        nextCollection = pruneCollectionEntry(nextCollection, code, {
          ...currentStickerState,
          owned: true,
          duplicates: Math.max(0, (currentStickerState.duplicates ?? 0) - 1),
          lastOutput: exchangeOrigin,
        })
      })

      return nextCollection
    })

    setLastQrExchangeSnapshot({ collection: previousCollection, label: exchangeOrigin, createdAt: Date.now() })
  }

  const handleApplyQrExchange = (receiveCodes, giveCodes) => {
    applyExchangeCollectionChanges(receiveCodes, giveCodes, 'intercambio_qr')
    playAppSound('duplicate')
    setToast({ text: 'Intercambio aplicado correctamente.' })
    return { message: 'Intercambio aplicado correctamente' }
  }

  const handleMarkQrObtainedElsewhere = (receiveCodes) => {
    applyExchangeCollectionChanges(receiveCodes, [], 'obtenidas_por_otro_metodo')
    playAppSound('add')
    setToast({ text: 'Figuritas marcadas como obtenidas por otro método.' })
  }

  const handleApplyManualExchange = (receiveCodes, giveCodes) => {
    applyExchangeCollectionChanges(receiveCodes, giveCodes, 'intercambio_manual')
    playAppSound('duplicate')
    setToast({ text: 'Intercambio manual aplicado correctamente.' })
    return { message: 'Intercambio manual aplicado correctamente' }
  }

  const handleUndoQrExchange = () => {
    if (!lastQrExchangeSnapshot) {
      return
    }

    setCollection(lastQrExchangeSnapshot.collection)
    setLastQrExchangeSnapshot(null)
    setToast({ text: 'Se deshizo el último intercambio.' })
  }

  const handleCopyText = async (text, successMessage) => {
    try {
      await navigator.clipboard.writeText(text)
      setToast({ text: successMessage })
    } catch {
      setToast({ text: 'No se pudo copiar el texto.' })
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
    setToast({ text: 'Respaldo guardado.' })
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

      setToast({ text: 'Respaldo subido correctamente.' })
    } catch (importError) {
      setToast({ text: importError.message || 'No se pudo importar el respaldo.' })
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
    setActionHistory({ addedOwned: [], removedOwned: [], addedDuplicates: [], removedDuplicates: [], missingAdded: [], missingResolved: [] })
    setToast({ text: 'Colección reiniciada.' })
  }


  const handleRevertMissingQuickAction = () => {
    if (!lastMissingAction) return
    setCollection((currentCollection) => pruneCollectionEntry(currentCollection, lastMissingAction.code, lastMissingAction.previousState))
    setLastMissingAction(null)
    setToast({ text: 'Se revirtió el último cambio en faltantes.' })
  }

  const handleRevertDuplicateQuickAction = () => {
    if (!lastDuplicateAction) return
    setCollection((currentCollection) => pruneCollectionEntry(currentCollection, lastDuplicateAction.code, lastDuplicateAction.previousState))
    setLastDuplicateAction(null)
    setToast({ text: 'Se revirtió el último cambio en repetidas.' })
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
    onRevertLastMissingAction: handleRevertMissingQuickAction,
    onRevertLastDuplicateAction: handleRevertDuplicateQuickAction,
    canRevertMissingAction: Boolean(lastMissingAction),
    canRevertDuplicateAction: Boolean(lastDuplicateAction),
  }

  const currentInfoPage = infoPages[normalizePathname(window.location.pathname)]

  useEffect(() => {
    const pathname = normalizePathname(window.location.pathname)

    if (currentInfoPage || pathname !== '/') {
      return
    }

    const titleValue = 'Mi Álbum 2026 | Controla tus estampitas'
    const descriptionValue =
      'Controla tus estampitas del álbum 2026: marca las que tienes, faltantes, repetidas y pegadas. Herramienta no oficial para coleccionistas.'
    const canonicalHref = `${SITE_URL}/`

    document.title = titleValue
    setOrCreateMeta('meta[name="description"]', {
      name: 'description',
      content: descriptionValue,
    })
    setOrCreateMeta('meta[property="og:title"]', {
      property: 'og:title',
      content: titleValue,
    })
    setOrCreateMeta('meta[property="og:description"]', {
      property: 'og:description',
      content: descriptionValue,
    })
    setOrCreateMeta('meta[property="og:url"]', {
      property: 'og:url',
      content: canonicalHref,
    })
    setOrCreateMeta('meta[name="twitter:title"]', {
      name: 'twitter:title',
      content: titleValue,
    })
    setOrCreateMeta('meta[name="twitter:description"]', {
      name: 'twitter:description',
      content: descriptionValue,
    })
    setOrCreateCanonical(canonicalHref)
  }, [currentInfoPage])

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
      case 'camera':
        return (
          <CameraAddPage
            stickers={stickers}
            collection={collection}
            teams={teams}
            onApplyQrExchange={handleApplyQrExchange}
            onApplyManualExchange={handleApplyManualExchange}
            onMarkQrObtainedElsewhere={handleMarkQrObtainedElsewhere}
            onUndoQrExchange={handleUndoQrExchange}
            canUndoQrExchange={Boolean(lastQrExchangeSnapshot)}
          />
        )
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
            actionHistory={actionHistory}
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
        tabs={navTabs}
        activeTab={activeTab}
        highlightedTabId={highlightedTabId}
        onChange={handleTabChange}
      />

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.text}</span>
          {toast.actionLabel && toast.onAction ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.onAction()
                setToast(null)
              }}
            >
              {toast.actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default App
