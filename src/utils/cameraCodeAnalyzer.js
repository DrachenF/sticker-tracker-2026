import { classifyZoneReadings, detectCodeLabelRegions } from './ocrStickerCodes'

const DEBUG_OCR = false

const OCR_MIN_WIDTH = 38
const OCR_MIN_HEIGHT = 16
const OCR_SCALE = 6

const COMMON_FALLBACK_PREFIXES = [
  'FWC',
  'MEX',
  'RSA',
  'KOR',
  'CZE',
  'CAN',
  'BIH',
  'QAT',
  'SUI',
  'HAI',
  'SCO',
  'USA',
  'PAR',
  'TUR',
  'BRA',
  'MAR',
  'ARG',
  'URU',
  'COL',
  'ESP',
  'FRA',
  'ENG',
  'GER',
  'POR',
  'ITA',
  'NED',
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
    'PARTE',
    'INTEGRANTE',
    'CROMO',
    'LIVRO',
    'ILUSTRADO',
    'COLECIONAR',
    'PUNTOS',
    'VENTA',
    'OFFICIAL',
    'LICENSED',
    'PRODUCT',
    'LOGOS',
    'BRAND',
    'ELEMENTS',
    'DESIGNS',
    'TRADE',
    'NAMES',
    'TOURNAMENTS',
    'EVENTS',
    'COPYRIGHTS',
    'TRADEMARKS',
    'MANUFACTURED',
    'UNDER',
    'LICENCE',
    'LICENSE',
    'MADE',
    'BRAZIL',
    'PANINI',
    'BRASIL',
    'LTDA',
    'WWW',
    'COM',
  ]

  let clean = String(text || '').toUpperCase()

  stopWords.forEach(word => {
    clean = clean.replace(new RegExp(`\\b${word}\\b`, 'g'), ' ')
  })

  return clean
}

function buildTextCandidates(rawText) {
  const text = String(rawText || '').toUpperCase()
  const cleanText = sanitizeText(text)

  const lines = cleanText
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)

  const candidates = []

  lines.forEach(line => {
    const spaced = line.replace(/[^A-Z0-9]+/g, ' ').trim()
    const compact = normalizeRaw(line)

    if (spaced && spaced.length <= 18) {
      candidates.push(spaced)
    }

    if (compact && compact.length <= 18) {
      candidates.push(compact)
    }
  })

  const firstChunk = cleanText
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .slice(0, 40)

  if (firstChunk) {
    candidates.push(firstChunk)
  }

  return Array.from(new Set(candidates))
}

function extractValidCodesFromText(rawText, validStickerData) {
  const {
    validCodes,
    validPrefixes,
    hasCatalog,
  } = validStickerData

  if (!validPrefixes.length) {
    return []
  }

  const prefixes = validPrefixes.map(escapeRegExp).join('|')
  const candidates = buildTextCandidates(rawText)
  const extractedCodes = []

  const normalRegex = new RegExp(
    `(^|\\b)(${prefixes})\\s*([0-9OQDISBLZG]{1,3})($|\\b)`,
    'g'
  )

  const compactStartRegex = new RegExp(
    `^(${prefixes})([0-9OQDISBLZG]{1,3})`
  )

  candidates.forEach(source => {
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
    const compactMatch = compact.match(compactStartRegex)

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

function relativeZone(parent, rx, ry, rw, rh) {
  return {
    x: Math.floor(parent.x + parent.width * rx),
    y: Math.floor(parent.y + parent.height * ry),
    width: Math.max(1, Math.floor(parent.width * rw)),
    height: Math.max(1, Math.floor(parent.height * rh)),
  }
}

function uniqueZones(zones) {
  const seen = new Set()

  return zones.filter(zone => {
    const key = [
      Math.round(zone?.x || 0),
      Math.round(zone?.y || 0),
      Math.round(zone?.width || 0),
      Math.round(zone?.height || 0),
    ].join('|')

    if (seen.has(key)) return false

    seen.add(key)
    return true
  })
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

function buildOcrCanvas(bitmap, zone, mode = 'contrast', scale = OCR_SCALE, rotate180 = false) {
  const safeZone = clampZone(bitmap, zone)

  if (!isReadableZone(bitmap, safeZone)) {
    return null
  }

  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.floor(safeZone.width * scale))
  c.height = Math.max(1, Math.floor(safeZone.height * scale))

  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  if (rotate180) {
    ctx.translate(c.width, c.height)
    ctx.rotate(Math.PI)
  }

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

    if (mode === 'contrast') {
      value = ((gray - avgGray) * 2.8) + avgGray
      value = Math.max(0, Math.min(255, value))
    }

    if (mode === 'threshold') {
      value = gray > avgGray ? 255 : 0
    }

    if (mode === 'threshold-invert') {
      value = gray > avgGray ? 0 : 255
    }

    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
  }

  ctx.putImageData(imageData, 0, 0)

  return c
}

async function runOcrAttempt(recognize, bitmap, zone, options = {}) {
  const {
    mode = 'contrast',
    pageSegMode = 7,
    rotate180 = false,
  } = options

  if (!isReadableZone(bitmap, zone)) {
    return {
      confidence: 0,
      text: '',
      imageDataUrl: '',
    }
  }

  const canvas = buildOcrCanvas(bitmap, zone, mode, OCR_SCALE, rotate180)

  if (!canvas || canvas.width < OCR_MIN_WIDTH || canvas.height < OCR_MIN_HEIGHT) {
    return {
      confidence: 0,
      text: '',
      imageDataUrl: '',
    }
  }

  const imageDataUrl = canvas.toDataURL('image/png')

  try {
    const result = await recognize(imageDataUrl, 'eng', {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
      tessedit_pageseg_mode: String(pageSegMode),
      preserve_interword_spaces: '1',
    })

    return {
      confidence: Number(result?.data?.confidence ?? 0),
      text: String(result?.data?.text || ''),
      imageDataUrl,
    }
  } catch (error) {
    console.warn('OCR attempt failed:', error)

    return {
      confidence: 0,
      text: '',
      imageDataUrl,
    }
  }
}

function detectLightStickerRegions(bitmap) {
  const maxW = 360
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

  function isStickerPixel(index) {
    const i = index * 4
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const gray = Math.round((r * 0.299) + (g * 0.587) + (b * 0.114))
    const chroma = max - min

    return gray >= 82 && gray <= 245 && chroma <= 58
  }

  const components = []

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const start = y * w + x

      if (visited[start] || !isStickerPixel(start)) continue

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
          if (visited[next] || !isStickerPixel(next)) return

          visited[next] = 1
          stack.push(next)
        })
      }

      const boxW = maxX - minX + 1
      const boxH = maxY - minY + 1
      const area = boxW * boxH
      const ratio = boxW / Math.max(1, boxH)

      if (
        count >= w * h * 0.015 &&
        area >= w * h * 0.035 &&
        ratio >= 0.75 &&
        ratio <= 3.5
      ) {
        const expandX = Math.floor(boxW * 0.06)
        const expandY = Math.floor(boxH * 0.06)

        components.push({
          x: Math.floor((minX - expandX) / scale),
          y: Math.floor((minY - expandY) / scale),
          width: Math.floor((boxW + expandX * 2) / scale),
          height: Math.floor((boxH + expandY * 2) / scale),
        })
      }
    }
  }

  return components
    .map(region => clampZone(bitmap, region))
    .filter(region => isReadableZone(bitmap, region))
    .slice(0, 6)
}

function buildCodeCandidateAttempts(bitmap, zone) {
  const safeZone = clampZone(bitmap, zone)
  const isSmallZone = (
    safeZone.width <= bitmap.width * 0.42 &&
    safeZone.height <= bitmap.height * 0.22
  )

  const attempts = []

  if (isSmallZone) {
    attempts.push({
      zone: safeZone,
      mode: 'original',
      pageSegMode: 7,
      rotate180: false,
    })

    attempts.push({
      zone: safeZone,
      mode: 'contrast',
      pageSegMode: 7,
      rotate180: false,
    })

    attempts.push({
      zone: safeZone,
      mode: 'threshold',
      pageSegMode: 7,
      rotate180: false,
    })

    attempts.push({
      zone: safeZone,
      mode: 'contrast',
      pageSegMode: 8,
      rotate180: false,
    })
  }

  const topRightWide = relativeZone(safeZone, 0.52, 0.00, 0.44, 0.22)
  const topRightLower = relativeZone(safeZone, 0.52, 0.06, 0.44, 0.22)
  const topRightTight = relativeZone(safeZone, 0.60, 0.02, 0.34, 0.16)

  attempts.push({
    zone: topRightWide,
    mode: 'original',
    pageSegMode: 7,
    rotate180: false,
  })

  attempts.push({
    zone: topRightWide,
    mode: 'contrast',
    pageSegMode: 7,
    rotate180: false,
  })

  attempts.push({
    zone: topRightLower,
    mode: 'contrast',
    pageSegMode: 7,
    rotate180: false,
  })

  attempts.push({
    zone: topRightTight,
    mode: 'contrast',
    pageSegMode: 8,
    rotate180: false,
  })

  return attempts.filter(attempt => isReadableZone(bitmap, attempt.zone))
}

async function recognizeZone(recognize, bitmap, zone, zoneIndex, validStickerData) {
  const attempts = buildCodeCandidateAttempts(bitmap, zone)
  const readings = []

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i]

    // eslint-disable-next-line no-await-in-loop
    const result = await runOcrAttempt(
      recognize,
      bitmap,
      attempt.zone,
      {
        mode: attempt.mode,
        pageSegMode: attempt.pageSegMode,
        rotate180: attempt.rotate180,
      }
    )

    if (DEBUG_OCR && result.text) {
      console.log(
        `OCR zona ${zoneIndex} intento ${i} modo ${attempt.mode} psm ${attempt.pageSegMode}:`,
        result.text.replace(/\n+/g, ' ')
      )
    }

    const extractedCodes = extractValidCodesFromText(result.text, validStickerData)

    if (extractedCodes.length > 0) {
      extractedCodes.forEach((code, codeIndex) => {
        readings.push({
          id: `zone-${zoneIndex}-${i}-${codeIndex}`,
          confidence: result.confidence,
          rawText: code,
          region: attempt.zone,
          thumbUrl: workerCanvasToUrl(bitmap, attempt.zone),
          manualCode: '',
        })
      })
    }
  }

  return readings
}

function buildFallbackRegions(bitmap) {
  const { width, height } = bitmap

  const detectedStickerRegions = detectLightStickerRegions(bitmap)

  const manualCodeRegions = [
    // Para fotos como la que mandaste: código arriba derecha de la estampa.
    {
      x: Math.floor(width * 0.58),
      y: Math.floor(height * 0.32),
      width: Math.floor(width * 0.32),
      height: Math.floor(height * 0.13),
    },

    {
      x: Math.floor(width * 0.62),
      y: Math.floor(height * 0.34),
      width: Math.floor(width * 0.26),
      height: Math.floor(height * 0.09),
    },

    {
      x: Math.floor(width * 0.52),
      y: Math.floor(height * 0.29),
      width: Math.floor(width * 0.40),
      height: Math.floor(height * 0.22),
    },
  ]

  return uniqueZones([
    ...manualCodeRegions,
    ...detectedStickerRegions,
  ]).filter(region => isReadableZone(bitmap, region))
}

function dedupeReadings(readings) {
  const seenValid = new Set()
  const result = []

  readings.forEach(reading => {
    const rawText = normalizeStickerCode(reading.rawText)

    if (/^[A-Z]{3}\d{1,3}$/.test(rawText)) {
      if (seenValid.has(rawText)) return

      seenValid.add(rawText)

      result.push({
        ...reading,
        rawText,
      })

      return
    }

    result.push(reading)
  })

  return result
}

function pickBestReadings(readings) {
  const clean = dedupeReadings(
    readings.filter(reading =>
      /^[A-Z]{3}\d{1,3}$/.test(normalizeStickerCode(reading.rawText))
    )
  )

  if (!clean.length) {
    return []
  }

  return clean
    .sort((a, b) => {
      const aConfidence = Number(a.confidence || 0)
      const bConfidence = Number(b.confidence || 0)

      return bConfidence - aConfidence
    })
    .slice(0, 1)
}

export async function analyzeStickerCodesFromImage(recognize, bitmap, stickers) {
  const validStickerData = buildValidStickerData(stickers)

  if (DEBUG_OCR) {
    console.log('OCR validCodes:', Array.from(validStickerData.validCodes))
    console.log('OCR validPrefixes:', validStickerData.validPrefixes)
    console.log('OCR hasCatalog:', validStickerData.hasCatalog)
  }

  const primaryRegions = detectCodeLabelRegions(bitmap) || []
  const fallbackRegions = buildFallbackRegions(bitmap)

  const allRegions = uniqueZones([
    ...fallbackRegions,
    ...primaryRegions,
  ])
    .filter(region => isReadableZone(bitmap, region))
    .slice(0, 6)

  const allReadings = []

  for (let i = 0; i < allRegions.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const zoneResults = await recognizeZone(
      recognize,
      bitmap,
      allRegions[i],
      i,
      validStickerData
    )

    allReadings.push(...zoneResults)

    const bestNow = pickBestReadings(allReadings)

    if (bestNow.length > 0) {
      return {
        grouped: classifyZoneReadings(bestNow, stickers),
        regions: primaryRegions,
      }
    }
  }

  return {
    grouped: classifyZoneReadings([], stickers),
    regions: primaryRegions,
  }
}
