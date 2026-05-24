import { classifyZoneReadings } from './ocrStickerCodes'

const DEBUG_OCR = false

const OCR_SCALE = 9
const OCR_MIN_WIDTH = 22
const OCR_MIN_HEIGHT = 8

const MAX_OCR_CANDIDATES = 28
const OCR_TIME_LIMIT_MS = 18000

const COMMON_FALLBACK_PREFIXES = [
  'FWC', 'CAN', 'MEX', 'USA', 'ARG', 'BOL', 'BRA', 'CHI', 'COL', 'ECU',
  'PAR', 'PER', 'URU', 'VEN', 'AUT', 'BEL', 'CRO', 'CZE', 'DEN', 'ENG',
  'ESP', 'FRA', 'GER', 'HUN', 'ITA', 'NED', 'POL', 'POR', 'ROU', 'SCO',
  'SRB', 'SUI', 'SVK', 'TUR', 'UKR', 'CRC', 'GUA', 'HON', 'JAM', 'PAN',
  'SLV', 'ALG', 'BFA', 'CMR', 'CIV', 'EGY', 'GHA', 'MAR', 'MLI', 'NGA',
  'SEN', 'TUN', 'AUS', 'IRN', 'IRQ', 'JPN', 'KOR', 'KSA', 'QAT', 'UAE',
  'UZB', 'NZL', 'RSA', 'BIH', 'HAI',
]

function normalizeRaw(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function normalizeStickerCode(value) {
  const raw = normalizeRaw(value)
  const match = raw.match(/^([A-Z]{3})0*(\d{1,3})$/)

  if (!match) return raw

  return `${match[1]}${Number(match[2])}`
}

function normalizeNumberLike(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[OQD]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/G/g, '6')
    .replace(/[^0-9]/g, '')
}

function getStickerCode(sticker) {
  if (typeof sticker === 'string') return sticker
  if (typeof sticker === 'number') return String(sticker)

  return (
    sticker?.code ||
    sticker?.codigo ||
    sticker?.id ||
    sticker?.label ||
    sticker?.number ||
    ''
  )
}

function collectStickerCodes(input, output = []) {
  if (!input) return output

  if (typeof input === 'string' || typeof input === 'number') {
    output.push(String(input))
    return output
  }

  if (Array.isArray(input)) {
    input.forEach(item => collectStickerCodes(item, output))
    return output
  }

  if (typeof input === 'object') {
    const directCode = getStickerCode(input)

    if (directCode) {
      output.push(String(directCode))
    }

    Object.entries(input).forEach(([key, value]) => {
      output.push(String(key))
      collectStickerCodes(value, output)
    })
  }

  return output
}

function buildValidStickerData(stickers) {
  const stickerCodes = collectStickerCodes(stickers)

  const validCodes = new Set(
    stickerCodes
      .map(normalizeStickerCode)
      .filter(code => /^[A-Z]{3}\d{1,3}$/.test(code))
  )

  const detectedPrefixes = Array.from(
    new Set(
      Array.from(validCodes)
        .map(code => code.match(/^([A-Z]{3})\d+$/)?.[1])
        .filter(Boolean)
    )
  )

  const validPrefixes = validCodes.size
    ? detectedPrefixes
    : COMMON_FALLBACK_PREFIXES

  return {
    validCodes,
    validPrefixes,
    hasCatalog: validCodes.size > 0,
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizeText(text) {
  const stopWords = [
    'FIFA',
    'WORLD',
    'CUP',
    '2026',
    'OFFICIAL',
    'LICENSED',
    'PRODUCT',
    'PANINI',
    'BRASIL',
    'BRAZIL',
    'MADE',
    'WWW',
    'COM',
    'MANUFACTURED',
    'UNDER',
    'LICENCE',
    'LICENSE',
    'TRADEMARKS',
    'COPYRIGHTS',
    'TOURNAMENTS',
    'EVENTS',
    'LOGOS',
    'BRAND',
    'ELEMENTS',
    'DESIGNS',
    'NAMES',
    'PARTE',
    'INTEGRANTE',
    'CROMO',
    'LIVRO',
    'ILUSTRADO',
    'COLECIONAR',
    'PUNTOS',
    'VENTA',
  ]

  let clean = String(text || '')
    .toUpperCase()
    .replace(/[|()[\]{}<>]/g, ' ')
    .replace(/[“”"'`´]/g, ' ')
    .replace(/[.,;:]/g, ' ')
    .replace(/\s+/g, ' ')

  stopWords.forEach(word => {
    clean = clean.replace(new RegExp(`\\b${word}\\b`, 'g'), ' ')
  })

  return clean.replace(/\s+/g, ' ').trim()
}

function buildTextCandidates(rawText) {
  const text = sanitizeText(rawText)
  const candidates = []

  text
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .forEach(line => {
      const spaced = line.replace(/[^A-Z0-9]+/g, ' ').trim()
      const compact = normalizeRaw(line)

      if (spaced && spaced.length <= 32) {
        candidates.push(spaced)
      }

      if (compact && compact.length <= 32) {
        candidates.push(compact)
      }
    })

  const compactFull = normalizeRaw(text)

  if (compactFull && compactFull.length <= 36) {
    candidates.push(compactFull)
  }

  return Array.from(new Set(candidates))
}

function extractValidCodesFromText(rawText, validStickerData) {
  const {
    validCodes,
    validPrefixes,
    hasCatalog,
  } = validStickerData

  if (!validPrefixes.length) return []

  const prefixes = validPrefixes.map(escapeRegExp).join('|')
  const candidates = buildTextCandidates(rawText)
  const extractedCodes = []

  candidates.forEach(source => {
    const normalRegex = new RegExp(
      `(^|\\b)(${prefixes})\\s*([0-9OQDISBLZG]{1,3})($|\\b)`,
      'g'
    )

    const compactExactRegex = new RegExp(
      `^(${prefixes})([0-9OQDISBLZG]{1,3})$`
    )

    const compactStartRegex = new RegExp(
      `^(${prefixes})([0-9OQDISBLZG]{1,3})`
    )

    let match

    while ((match = normalRegex.exec(source)) !== null) {
      const prefix = match[2]
      const number = normalizeNumberLike(match[3])

      if (!number) continue

      const code = normalizeStickerCode(`${prefix}${number}`)

      if (!hasCatalog || validCodes.has(code)) {
        extractedCodes.push(code)
      }
    }

    const compact = normalizeRaw(source)
    const compactMatch = compact.match(compactExactRegex) || compact.match(compactStartRegex)

    if (compactMatch) {
      const prefix = compactMatch[1]
      const number = normalizeNumberLike(compactMatch[2])

      if (number) {
        const code = normalizeStickerCode(`${prefix}${number}`)

        if (!hasCatalog || validCodes.has(code)) {
          extractedCodes.push(code)
        }
      }
    }
  })

  return Array.from(new Set(extractedCodes))
}

function clampZone(bitmap, zone) {
  const rawX = Math.floor(zone?.x || 0)
  const rawY = Math.floor(zone?.y || 0)

  const x = Math.max(0, Math.min(rawX, bitmap.width - 1))
  const y = Math.max(0, Math.min(rawY, bitmap.height - 1))

  const width = Math.max(
    1,
    Math.min(Math.floor(zone?.width || 1), bitmap.width - x)
  )

  const height = Math.max(
    1,
    Math.min(Math.floor(zone?.height || 1), bitmap.height - y)
  )

  return {
    x,
    y,
    width,
    height,
  }
}

function isReadableZone(bitmap, zone) {
  const safeZone = clampZone(bitmap, zone)

  return (
    safeZone.width >= OCR_MIN_WIDTH &&
    safeZone.height >= OCR_MIN_HEIGHT
  )
}

function expandZone(bitmap, zone, amountX = 0.12, amountY = 0.18) {
  const safeZone = clampZone(bitmap, zone)

  const extraX = Math.floor(safeZone.width * amountX)
  const extraY = Math.floor(safeZone.height * amountY)

  return clampZone(bitmap, {
    x: safeZone.x - extraX,
    y: safeZone.y - extraY,
    width: safeZone.width + extraX * 2,
    height: safeZone.height + extraY * 2,
  })
}

function uniqueZones(zones) {
  const seen = new Set()

  return zones.filter(zone => {
    const key = [
      Math.round(zone?.x || 0),
      Math.round(zone?.y || 0),
      Math.round(zone?.width || 0),
      Math.round(zone?.height || 0),
      zone?.kind || '',
    ].join('|')

    if (seen.has(key)) return false

    seen.add(key)
    return true
  })
}

function regionIoU(a, b) {
  const ax1 = a.x
  const ay1 = a.y
  const ax2 = a.x + a.width
  const ay2 = a.y + a.height

  const bx1 = b.x
  const by1 = b.y
  const bx2 = b.x + b.width
  const by2 = b.y + b.height

  const ix1 = Math.max(ax1, bx1)
  const iy1 = Math.max(ay1, by1)
  const ix2 = Math.min(ax2, bx2)
  const iy2 = Math.min(ay2, by2)

  const iw = Math.max(0, ix2 - ix1)
  const ih = Math.max(0, iy2 - iy1)

  const intersection = iw * ih
  const union = (a.width * a.height) + (b.width * b.height) - intersection

  if (!union) return 0

  return intersection / union
}

function removeOverlappingRegions(regions) {
  const sorted = [...regions].sort((a, b) => b.score - a.score)
  const kept = []

  sorted.forEach(region => {
    const overlaps = kept.some(existing => regionIoU(existing, region) > 0.42)

    if (!overlaps) {
      kept.push(region)
    }
  })

  return kept
}

function workerCanvasToUrl(bitmap, zone) {
  const safeZone = clampZone(bitmap, zone)

  const c = document.createElement('canvas')
  c.width = safeZone.width
  c.height = safeZone.height

  const cx = c.getContext('2d')

  cx.drawImage(
    bitmap,
    safeZone.x,
    safeZone.y,
    safeZone.width,
    safeZone.height,
    0,
    0,
    safeZone.width,
    safeZone.height
  )

  return c.toDataURL('image/jpeg', 0.86)
}

function buildOcrCanvas(bitmap, zone, mode = 'light-box', scale = OCR_SCALE) {
  const safeZone = clampZone(bitmap, zone)

  if (!isReadableZone(bitmap, safeZone)) return null

  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.floor(safeZone.width * scale))
  c.height = Math.max(1, Math.floor(safeZone.height * scale))

  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  ctx.drawImage(
    bitmap,
    safeZone.x,
    safeZone.y,
    safeZone.width,
    safeZone.height,
    0,
    0,
    c.width,
    c.height
  )

  if (mode === 'original') {
    return c
  }

  const imageData = ctx.getImageData(0, 0, c.width, c.height)
  const data = imageData.data

  let sum = 0

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round((data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114))

    data[i] = gray
    data[i + 1] = gray
    data[i + 2] = gray

    sum += gray
  }

  const pixelCount = Math.max(1, data.length / 4)
  const avgGray = sum / pixelCount

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i]
    let value = gray

    if (mode === 'light-box') {
      // Fondo blanco/gris claro + letras grises/oscuras.
      value = gray >= 158 ? 255 : 0
    }

    if (mode === 'light-soft') {
      value = gray >= 138 ? 255 : 0
    }

    if (mode === 'dark-box') {
      // Fondo gris oscuro + letras claras.
      value = gray >= 125 ? 0 : 255
    }

    if (mode === 'dark-soft') {
      value = gray >= 105 ? 0 : 255
    }

    if (mode === 'contrast') {
      value = ((gray - avgGray) * 3.2) + avgGray
      value = Math.max(0, Math.min(255, value))
    }

    if (mode === 'avg-light') {
      value = gray > avgGray - 8 ? 255 : 0
    }

    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
  }

  ctx.putImageData(imageData, 0, 0)

  return c
}

async function runOcrAttempt(recognize, bitmap, candidate, mode, pageSegMode = 7) {
  const canvas = buildOcrCanvas(bitmap, candidate, mode, OCR_SCALE)

  if (!canvas || canvas.width < OCR_MIN_WIDTH || canvas.height < OCR_MIN_HEIGHT) {
    return {
      confidence: 0,
      text: '',
    }
  }

  const imageDataUrl = canvas.toDataURL('image/png')

  try {
    const result = await recognize(imageDataUrl, 'eng', {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
      tessedit_pageseg_mode: String(pageSegMode),
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    })

    return {
      confidence: Number(result?.data?.confidence ?? 0),
      text: String(result?.data?.text || ''),
    }
  } catch (error) {
    console.warn('OCR attempt failed:', error)

    return {
      confidence: 0,
      text: '',
    }
  }
}

function getPixelInfo(data, index) {
  const i = index * 4
  const r = data[i]
  const g = data[i + 1]
  const b = data[i + 2]

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const gray = Math.round((r * 0.299) + (g * 0.587) + (b * 0.114))
  const chroma = max - min

  return {
    gray,
    chroma,
  }
}

function createMaskClassifier(kind) {
  if (kind === 'light-box') {
    return ({ gray, chroma }) => (
      gray >= 120 &&
      gray <= 255 &&
      chroma <= 85
    )
  }

  if (kind === 'dark-box') {
    return ({ gray, chroma }) => (
      gray >= 30 &&
      gray <= 175 &&
      chroma <= 70
    )
  }

  if (kind === 'sticker-body') {
    return ({ gray, chroma }) => (
      gray >= 95 &&
      gray <= 255 &&
      chroma <= 100
    )
  }

  return () => false
}

function componentToBoxCandidate(bitmap, component, scale, kind, imageArea) {
  const boxW = component.maxX - component.minX + 1
  const boxH = component.maxY - component.minY + 1
  const area = boxW * boxH
  const fillRatio = component.count / Math.max(1, area)
  const ratio = boxW / Math.max(1, boxH)

  const originalX = Math.floor(component.minX / scale)
  const originalY = Math.floor(component.minY / scale)
  const originalW = Math.floor(boxW / scale)
  const originalH = Math.floor(boxH / scale)

  if (originalW < 22 || originalH < 8) return null
  if (originalW > bitmap.width * 0.42) return null
  if (originalH > bitmap.height * 0.16) return null

  if (ratio < 1.0 || ratio > 8.5) return null
  if (fillRatio < 0.22) return null

  const originalArea = originalW * originalH
  const imageAreaRatio = originalArea / Math.max(1, imageArea)

  if (imageAreaRatio < 0.00012 || imageAreaRatio > 0.04) return null

  let score = 100

  score -= Math.abs(ratio - 3.8) * 3
  score += Math.min(20, fillRatio * 20)

  if (kind === 'light-box') score += 16
  if (kind === 'dark-box') score += 20

  if (originalH >= 9 && originalH <= 65) score += 16
  if (originalW >= 30 && originalW <= 230) score += 16

  const baseZone = {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  }

  const expanded = kind === 'light-box'
    ? expandZone(bitmap, baseZone, 0.08, 0.14)
    : expandZone(bitmap, baseZone, 0.10, 0.16)

  return {
    ...expanded,
    kind,
    score,
  }
}

function componentToStickerBodyCodeCandidates(bitmap, component, scale, imageArea) {
  const boxW = component.maxX - component.minX + 1
  const boxH = component.maxY - component.minY + 1
  const area = boxW * boxH
  const fillRatio = component.count / Math.max(1, area)

  const originalX = Math.floor(component.minX / scale)
  const originalY = Math.floor(component.minY / scale)
  const originalW = Math.floor(boxW / scale)
  const originalH = Math.floor(boxH / scale)

  const ratio = originalW / Math.max(1, originalH)
  const imageAreaRatio = (originalW * originalH) / Math.max(1, imageArea)

  if (originalW < bitmap.width * 0.16) return []
  if (originalH < bitmap.height * 0.10) return []
  if (originalW > bitmap.width * 0.96) return []
  if (originalH > bitmap.height * 0.96) return []
  if (ratio < 0.40 || ratio > 3.2) return []
  if (fillRatio < 0.18) return []
  if (imageAreaRatio < 0.025 || imageAreaRatio > 0.70) return []

  const sticker = {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  }

  const candidates = []

  // Código arriba derecha: funciona para ARG17, FWC2, PAR1 y similares.
  candidates.push({
    ...expandZone(bitmap, {
      x: Math.floor(sticker.x + sticker.width * 0.56),
      y: Math.floor(sticker.y + sticker.height * 0.025),
      width: Math.floor(sticker.width * 0.40),
      height: Math.floor(sticker.height * 0.135),
    }, 0.04, 0.10),
    kind: 'dark-box',
    score: 275,
  })

  candidates.push({
    ...expandZone(bitmap, {
      x: Math.floor(sticker.x + sticker.width * 0.60),
      y: Math.floor(sticker.y + sticker.height * 0.035),
      width: Math.floor(sticker.width * 0.33),
      height: Math.floor(sticker.height * 0.105),
    }, 0.05, 0.12),
    kind: 'dark-box',
    score: 265,
  })

  candidates.push({
    ...expandZone(bitmap, {
      x: Math.floor(sticker.x + sticker.width * 0.56),
      y: Math.floor(sticker.y + sticker.height * 0.025),
      width: Math.floor(sticker.width * 0.40),
      height: Math.floor(sticker.height * 0.135),
    }, 0.04, 0.10),
    kind: 'light-box',
    score: 250,
  })

  candidates.push({
    ...expandZone(bitmap, {
      x: Math.floor(sticker.x + sticker.width * 0.62),
      y: Math.floor(sticker.y + sticker.height * 0.040),
      width: Math.floor(sticker.width * 0.29),
      height: Math.floor(sticker.height * 0.090),
    }, 0.05, 0.14),
    kind: 'light-box',
    score: 245,
  })

  return candidates.filter(candidate => isReadableZone(bitmap, candidate))
}

function detectComponents(bitmap, kind) {
  const maxW = 760
  const scale = Math.min(1, maxW / bitmap.width)

  const w = Math.max(1, Math.floor(bitmap.width * scale))
  const h = Math.max(1, Math.floor(bitmap.height * scale))

  const c = document.createElement('canvas')
  c.width = w
  c.height = h

  const ctx = c.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, w, h)

  const imageData = ctx.getImageData(0, 0, w, h)
  const data = imageData.data
  const visited = new Uint8Array(w * h)

  const isTargetPixel = createMaskClassifier(kind)
  const candidates = []
  const imageArea = bitmap.width * bitmap.height

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const start = y * w + x

      if (visited[start]) continue

      const info = getPixelInfo(data, start)

      if (!isTargetPixel(info)) {
        visited[start] = 1
        continue
      }

      const stack = [start]
      visited[start] = 1

      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      let count = 0

      while (stack.length) {
        const current = stack.pop()
        const cx = current % w
        const cy = Math.floor(current / w)

        count += 1

        minX = Math.min(minX, cx)
        maxX = Math.max(maxX, cx)
        minY = Math.min(minY, cy)
        maxY = Math.max(maxY, cy)

        const neighbors = [
          current - 1,
          current + 1,
          current - w,
          current + w,
        ]

        neighbors.forEach(next => {
          if (next < 0 || next >= visited.length) return

          const nx = next % w
          const ny = Math.floor(next / w)

          if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) return
          if (visited[next]) return

          const nextInfo = getPixelInfo(data, next)

          if (!isTargetPixel(nextInfo)) {
            visited[next] = 1
            return
          }

          visited[next] = 1
          stack.push(next)
        })
      }

      const component = {
        minX,
        maxX,
        minY,
        maxY,
        count,
      }

      if (kind === 'light-box' || kind === 'dark-box') {
        const candidate = componentToBoxCandidate(bitmap, component, scale, kind, imageArea)

        if (candidate && isReadableZone(bitmap, candidate)) {
          candidates.push(candidate)
        }
      }

      if (kind === 'sticker-body') {
        const bodyCandidates = componentToStickerBodyCodeCandidates(bitmap, component, scale, imageArea)

        bodyCandidates.forEach(candidate => {
          if (candidate && isReadableZone(bitmap, candidate)) {
            candidates.push(candidate)
          }
        })
      }
    }
  }

  return candidates
}

function addBackupRegions(bitmap) {
  const { width, height } = bitmap

  return [
    // FWC2 foto horizontal: cajita blanca arriba derecha.
    {
      x: Math.floor(width * 0.615),
      y: Math.floor(height * 0.315),
      width: Math.floor(width * 0.255),
      height: Math.floor(height * 0.065),
      kind: 'light-box',
      score: 270,
    },
    {
      x: Math.floor(width * 0.595),
      y: Math.floor(height * 0.300),
      width: Math.floor(width * 0.315),
      height: Math.floor(height * 0.095),
      kind: 'light-box',
      score: 255,
    },

    // ARG17 foto vertical: etiqueta gris arriba derecha.
    {
      x: Math.floor(width * 0.590),
      y: Math.floor(height * 0.125),
      width: Math.floor(width * 0.255),
      height: Math.floor(height * 0.085),
      kind: 'dark-box',
      score: 285,
    },
    {
      x: Math.floor(width * 0.555),
      y: Math.floor(height * 0.110),
      width: Math.floor(width * 0.330),
      height: Math.floor(height * 0.115),
      kind: 'dark-box',
      score: 265,
    },

    // Respaldo superior derecho general.
    {
      x: Math.floor(width * 0.520),
      y: Math.floor(height * 0.080),
      width: Math.floor(width * 0.400),
      height: Math.floor(height * 0.170),
      kind: 'dark-box',
      score: 190,
    },
    {
      x: Math.floor(width * 0.520),
      y: Math.floor(height * 0.080),
      width: Math.floor(width * 0.400),
      height: Math.floor(height * 0.170),
      kind: 'light-box',
      score: 180,
    },
  ].filter(region => isReadableZone(bitmap, region))
}

function detectCodeLabelCandidates(bitmap) {
  const backupCandidates = addBackupRegions(bitmap)

  const stickerBodyCandidates = detectComponents(bitmap, 'sticker-body')
  const lightBoxCandidates = detectComponents(bitmap, 'light-box')
  const darkBoxCandidates = detectComponents(bitmap, 'dark-box')

  const candidates = uniqueZones([
    ...backupCandidates,
    ...stickerBodyCandidates,
    ...darkBoxCandidates,
    ...lightBoxCandidates,
  ])
    .filter(candidate => isReadableZone(bitmap, candidate))

  const cleaned = removeOverlappingRegions(candidates)

  return cleaned
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_OCR_CANDIDATES)
}

function dedupeReadings(readings) {
  const seen = new Set()
  const result = []

  readings.forEach(reading => {
    const rawText = normalizeStickerCode(reading.rawText)

    if (!/^[A-Z]{3}\d{1,3}$/.test(rawText)) return

    const safeRegion = reading.region || {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }

    // Mantiene duplicados reales si están en zonas diferentes.
    const cx = Math.round((safeRegion.x + safeRegion.width / 2) / 40)
    const cy = Math.round((safeRegion.y + safeRegion.height / 2) / 40)
    const key = `${rawText}-${cx}-${cy}`

    if (seen.has(key)) return

    seen.add(key)

    result.push({
      ...reading,
      rawText,
    })
  })

  return result
}

function pickBestCandidateReadings(readings) {
  const grouped = new Map()

  readings.forEach(reading => {
    const code = normalizeStickerCode(reading.rawText)

    if (!/^[A-Z]{3}\d{1,3}$/.test(code)) return

    const region = reading.region || {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }

    const cx = Math.round((region.x + region.width / 2) / 40)
    const cy = Math.round((region.y + region.height / 2) / 40)
    const key = `${code}-${cx}-${cy}`

    const current = grouped.get(key)

    const score = (
      Number(reading.confidence || 0) +
      Number(reading.candidateScore || 0) +
      Number(reading.repeatedScore || 0)
    )

    if (!current || score > current.score) {
      grouped.set(key, {
        score,
        reading: {
          ...reading,
          rawText: code,
        },
      })
    }
  })

  return Array.from(grouped.values())
    .sort((a, b) => b.score - a.score)
    .map(item => item.reading)
}

async function recognizeCandidate(recognize, bitmap, candidate, candidateIndex, validStickerData, startedAt) {
  const modes = candidate.kind === 'dark-box'
    ? [
        { mode: 'dark-box', pageSegMode: 7 },
        { mode: 'dark-box', pageSegMode: 8 },
        { mode: 'dark-soft', pageSegMode: 7 },
        { mode: 'contrast', pageSegMode: 7 },
        { mode: 'original', pageSegMode: 7 },
      ]
    : [
        { mode: 'light-box', pageSegMode: 7 },
        { mode: 'light-box', pageSegMode: 8 },
        { mode: 'light-soft', pageSegMode: 7 },
        { mode: 'contrast', pageSegMode: 7 },
        { mode: 'original', pageSegMode: 7 },
      ]

  const readings = []
  const localHits = new Map()

  for (let i = 0; i < modes.length; i += 1) {
    if (Date.now() - startedAt > OCR_TIME_LIMIT_MS) break

    const attempt = modes[i]

    // eslint-disable-next-line no-await-in-loop
    const result = await runOcrAttempt(
      recognize,
      bitmap,
      candidate,
      attempt.mode,
      attempt.pageSegMode
    )

    if (DEBUG_OCR) {
      console.log(
        `OCR candidato ${candidateIndex} ${candidate.kind} modo ${attempt.mode} psm ${attempt.pageSegMode}:`,
        result.text.replace(/\n+/g, ' ')
      )
    }

    const extractedCodes = extractValidCodesFromText(result.text, validStickerData)

    extractedCodes.forEach(code => {
      localHits.set(code, (localHits.get(code) || 0) + 1)

      readings.push({
        id: `candidate-${candidateIndex}-${i}-${code}`,
        confidence: Number(result.confidence || 0),
        candidateScore: Number(candidate.score || 0),
        repeatedScore: (localHits.get(code) || 1) * 20,
        rawText: code,
        region: candidate,
        thumbUrl: workerCanvasToUrl(bitmap, candidate),
        manualCode: '',
      })
    })
  }

  return readings
}

export async function analyzeStickerCodesFromImage(recognize, bitmap, stickers) {
  const startedAt = Date.now()
  const validStickerData = buildValidStickerData(stickers)

  const candidates = detectCodeLabelCandidates(bitmap)

  if (DEBUG_OCR) {
    console.log('OCR validCodes:', Array.from(validStickerData.validCodes))
    console.log('OCR validPrefixes:', validStickerData.validPrefixes)
    console.log('OCR hasCatalog:', validStickerData.hasCatalog)
    console.log('OCR candidates:', candidates)
  }

  const allReadings = []

  for (let i = 0; i < candidates.length; i += 1) {
    if (Date.now() - startedAt > OCR_TIME_LIMIT_MS) break

    // eslint-disable-next-line no-await-in-loop
    const candidateReadings = await recognizeCandidate(
      recognize,
      bitmap,
      candidates[i],
      i,
      validStickerData,
      startedAt
    )

    allReadings.push(...candidateReadings)
  }

  const bestReadings = pickBestCandidateReadings(
    dedupeReadings(allReadings)
  )

  return {
    grouped: classifyZoneReadings(bestReadings, stickers),
    regions: candidates.map(candidate => ({
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
    })),
  }
}
