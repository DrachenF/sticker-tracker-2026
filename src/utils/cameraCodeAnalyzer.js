import { classifyZoneReadings, detectCodeLabelRegions } from './ocrStickerCodes'

const DEBUG_OCR = false

const COMMON_FALLBACK_PREFIXES = [
  'FWC',
  'MEX', 'RSA', 'KOR', 'CZE', 'CAN', 'BIH', 'QAT', 'SUI', 'HAI', 'SCO',
  'USA', 'PAR', 'TUR', 'BRA', 'MAR', 'ARG', 'URU', 'COL', 'ESP', 'FRA',
  'ENG', 'GER', 'POR', 'ITA', 'NED'
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

  let validPrefixes = Array.from(
    new Set(
      Array.from(validCodes)
        .map(code => code.match(/^([A-Z]{3})\d+$/)?.[1])
        .filter(Boolean)
    )
  )

  // Seguridad extra: si por alguna razón no logró sacar prefijos desde stickers,
  // usa una lista base para que por lo menos pueda detectar FWC2, MEX1, PAR10, etc.
  if (!validPrefixes.length) {
    validPrefixes = COMMON_FALLBACK_PREFIXES
  }

  return {
    validCodes,
    validPrefixes,
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

function extractValidCodesFromText(rawText, validStickerData) {
  const { validCodes, validPrefixes } = validStickerData

  if (!validPrefixes.length) {
    return []
  }

  const prefixes = validPrefixes.map(escapeRegExp).join('|')
  const cleanText = sanitizeText(rawText)

  const sources = [
    cleanText.replace(/[^A-Z0-9]+/g, ' '),
    normalizeRaw(cleanText),
  ]

  const extractedCodes = []

  for (const source of sources) {
    const prefixRegex = new RegExp(
      `(^|\\b)(${prefixes})\\s*([0-9OQDISBLZG]{1,3})($|\\b)`,
      'g'
    )

    let match

    while ((match = prefixRegex.exec(source)) !== null) {
      const prefix = match[2]
      const number = normalizeNumberLike(match[3])

      if (!number) continue

      const code = normalizeStickerCode(`${prefix}${number}`)

      // Si sí tenemos catálogo real, solo acepta códigos existentes.
      // Si no tenemos catálogo, acepta por prefijo como respaldo.
      if (!validCodes.size || validCodes.has(code)) {
        extractedCodes.push(code)
      }
    }
  }

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

  // Evita errores tipo:
  // Image too small to scale!! (1x36)
  return safeZone.width >= 24 && safeZone.height >= 12
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

function buildCodeCandidateZones(bitmap, zone) {
  const safeZone = clampZone(bitmap, zone)

  const candidates = uniqueZones([
    safeZone,

    // Caso más importante: código arriba derecha como en FWC 2.
    relativeZone(safeZone, 0.40, 0.00, 0.60, 0.42),
    relativeZone(safeZone, 0.50, 0.00, 0.48, 0.32),
    relativeZone(safeZone, 0.56, 0.00, 0.40, 0.24),
    relativeZone(safeZone, 0.62, 0.00, 0.32, 0.20),
    relativeZone(safeZone, 0.64, 0.02, 0.30, 0.16),

    // Si la estampa está girada 180 grados.
    relativeZone(safeZone, 0.00, 0.58, 0.60, 0.42),
    relativeZone(safeZone, 0.02, 0.70, 0.46, 0.28),
    relativeZone(safeZone, 0.04, 0.78, 0.40, 0.20),

    // Posibles posiciones en estampas verticales o fotos raras.
    relativeZone(safeZone, 0.00, 0.00, 0.45, 0.28),
    relativeZone(safeZone, 0.55, 0.72, 0.45, 0.28),
    relativeZone(safeZone, 0.25, 0.00, 0.50, 0.24),
    relativeZone(safeZone, 0.25, 0.76, 0.50, 0.24),
  ])

  return candidates.filter(candidate => isReadableZone(bitmap, candidate))
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

function buildOcrCanvas(bitmap, zone, mode = 'contrast', scale = 5) {
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
      value = ((gray - avgGray) * 2.4) + avgGray
      value = Math.max(0, Math.min(255, value))
    }

    if (mode === 'threshold') {
      // Para texto gris/oscuro sobre fondo claro.
      value = gray > avgGray ? 255 : 0
    }

    if (mode === 'threshold-invert') {
      // Para texto blanco sobre fondo gris/oscuro.
      value = gray > avgGray ? 0 : 255
    }

    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
  }

  ctx.putImageData(imageData, 0, 0)

  return c
}

async function runOcrAttempt(recognize, bitmap, zone, mode, pageSegMode) {
  if (!isReadableZone(bitmap, zone)) {
    return {
      confidence: 0,
      text: '',
    }
  }

  const canvas = buildOcrCanvas(bitmap, zone, mode, 5)

  if (!canvas || canvas.width < 24 || canvas.height < 12) {
    return {
      confidence: 0,
      text: '',
    }
  }

  const imageDataUrl = canvas.toDataURL('image/png')

  try {
    const result = await recognize(imageDataUrl, 'eng', {
      rotateAuto: true,
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

async function recognizeZone(recognize, bitmap, zone, zoneIndex, validStickerData) {
  const candidateZones = buildCodeCandidateZones(bitmap, zone)
  const attempts = []

  for (let i = 0; i < candidateZones.length; i += 1) {
    const candidateZone = candidateZones[i]

    // Primer intento: zona grande, texto disperso.
    if (i === 0) {
      attempts.push({
        zone: candidateZone,
        mode: 'contrast',
        pageSegMode: 11,
      })

      attempts.push({
        zone: candidateZone,
        mode: 'original',
        pageSegMode: 11,
      })

      continue
    }

    // Recortes pequeños: probar como línea o palabra.
    attempts.push({
      zone: candidateZone,
      mode: 'original',
      pageSegMode: 7,
    })

    attempts.push({
      zone: candidateZone,
      mode: 'contrast',
      pageSegMode: 7,
    })

    attempts.push({
      zone: candidateZone,
      mode: 'threshold',
      pageSegMode: 7,
    })

    attempts.push({
      zone: candidateZone,
      mode: 'threshold-invert',
      pageSegMode: 7,
    })

    attempts.push({
      zone: candidateZone,
      mode: 'contrast',
      pageSegMode: 8,
    })
  }

  let bestInvalidReading = null

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i]

    // eslint-disable-next-line no-await-in-loop
    const result = await runOcrAttempt(
      recognize,
      bitmap,
      attempt.zone,
      attempt.mode,
      attempt.pageSegMode
    )

    if (DEBUG_OCR && result.text) {
      console.log(
        `OCR zona ${zoneIndex} intento ${i} modo ${attempt.mode} psm ${attempt.pageSegMode}:`,
        result.text.replace(/\n+/g, ' ')
      )
    }

    const extractedCodes = extractValidCodesFromText(result.text, validStickerData)

    if (extractedCodes.length > 0) {
      return extractedCodes.map((code, codeIndex) => ({
        id: `zone-${zoneIndex}-${i}-${codeIndex}`,
        confidence: result.confidence,
        rawText: code,
        region: attempt.zone,
        thumbUrl: workerCanvasToUrl(bitmap, attempt.zone),
        manualCode: '',
      }))
    }

    const normalizedText = normalizeRaw(result.text)

    if (normalizedText) {
      const invalidReading = {
        id: `zone-${zoneIndex}-${i}`,
        confidence: result.confidence,
        rawText: normalizedText,
        region: attempt.zone,
        thumbUrl: workerCanvasToUrl(bitmap, attempt.zone),
        manualCode: '',
      }

      if (
        !bestInvalidReading ||
        invalidReading.confidence > bestInvalidReading.confidence
      ) {
        bestInvalidReading = invalidReading
      }
    }
  }

  return bestInvalidReading ? [bestInvalidReading] : []
}

function buildFallbackRegions(bitmap) {
  const { width, height } = bitmap

  return uniqueZones([
    {
      x: 0,
      y: 0,
      width,
      height,
    },

    // Centro de la imagen: normalmente ahí está la estampa completa.
    {
      x: Math.floor(width * 0.08),
      y: Math.floor(height * 0.20),
      width: Math.floor(width * 0.84),
      height: Math.floor(height * 0.60),
    },

    // Zona media-superior.
    {
      x: Math.floor(width * 0.12),
      y: Math.floor(height * 0.22),
      width: Math.floor(width * 0.78),
      height: Math.floor(height * 0.42),
    },

    // Zona derecha donde suele estar el bloque del código.
    {
      x: Math.floor(width * 0.40),
      y: Math.floor(height * 0.18),
      width: Math.floor(width * 0.55),
      height: Math.floor(height * 0.42),
    },

    // Superior derecha más específica.
    {
      x: Math.floor(width * 0.50),
      y: Math.floor(height * 0.22),
      width: Math.floor(width * 0.42),
      height: Math.floor(height * 0.24),
    },

    // Para foto volteada 180 grados.
    {
      x: Math.floor(width * 0.05),
      y: Math.floor(height * 0.55),
      width: Math.floor(width * 0.55),
      height: Math.floor(height * 0.35),
    },
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

async function recognizeFullImageFallback(recognize, bitmap, validStickerData) {
  const fullZone = {
    x: 0,
    y: 0,
    width: bitmap.width,
    height: bitmap.height,
  }

  const attempts = [
    {
      zone: fullZone,
      mode: 'original',
      pageSegMode: 11,
    },
    {
      zone: fullZone,
      mode: 'contrast',
      pageSegMode: 11,
    },
    {
      zone: fullZone,
      mode: 'threshold',
      pageSegMode: 11,
    },
    {
      zone: fullZone,
      mode: 'threshold-invert',
      pageSegMode: 11,
    },
  ]

  let bestText = ''
  let bestConfidence = 0

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i]

    // eslint-disable-next-line no-await-in-loop
    const result = await runOcrAttempt(
      recognize,
      bitmap,
      attempt.zone,
      attempt.mode,
      attempt.pageSegMode
    )

    if (DEBUG_OCR && result.text) {
      console.log(
        `OCR fallback completo intento ${i} modo ${attempt.mode}:`,
        result.text.replace(/\n+/g, ' ')
      )
    }

    const extractedCodes = extractValidCodesFromText(result.text, validStickerData)

    if (extractedCodes.length > 0) {
      return extractedCodes.map((code, index) => ({
        id: `fallback-full-${i}-${index}`,
        confidence: result.confidence,
        rawText: code,
        region: attempt.zone,
        thumbUrl: workerCanvasToUrl(bitmap, attempt.zone),
        manualCode: '',
      }))
    }

    if (result.text && result.confidence >= bestConfidence) {
      bestText = result.text
      bestConfidence = result.confidence
    }
  }

  return [
    {
      id: 'fallback-full',
      confidence: bestConfidence,
      rawText: normalizeRaw(bestText),
      region: fullZone,
      thumbUrl: workerCanvasToUrl(bitmap, fullZone),
      manualCode: '',
    },
  ]
}

export async function analyzeStickerCodesFromImage(recognize, bitmap, stickers) {
  const validStickerData = buildValidStickerData(stickers)

  if (DEBUG_OCR) {
    console.log('OCR validCodes:', Array.from(validStickerData.validCodes))
    console.log('OCR validPrefixes:', validStickerData.validPrefixes)
  }

  const primaryRegions = detectCodeLabelRegions(bitmap) || []
  const fallbackRegions = buildFallbackRegions(bitmap)

  const allRegions = uniqueZones([
    ...primaryRegions,
    ...fallbackRegions,
  ]).filter(region => isReadableZone(bitmap, region))

  const zoneReadings = []

  for (let i = 0; i < allRegions.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const zoneResults = await recognizeZone(
      recognize,
      bitmap,
      allRegions[i],
      i,
      validStickerData
    )

    zoneReadings.push(...zoneResults)
  }

  const cleanZoneReadings = dedupeReadings(zoneReadings)
  const grouped = classifyZoneReadings(cleanZoneReadings, stickers)
  const hasAnyUseful = grouped.good.length || grouped.review.length

  if (hasAnyUseful) {
    return {
      grouped,
      regions: primaryRegions,
    }
  }

  const finalReadings = await recognizeFullImageFallback(
    recognize,
    bitmap,
    validStickerData
  )

  return {
    grouped: classifyZoneReadings(dedupeReadings(finalReadings), stickers),
    regions: primaryRegions,
  }
}
