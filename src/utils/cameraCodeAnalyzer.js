import { classifyZoneReadings, detectCodeLabelRegions } from './ocrStickerCodes'

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

  const validPrefixes = Array.from(
    new Set(
      Array.from(validCodes)
        .map(code => code.match(/^([A-Z]{3})\d+$/)?.[1])
        .filter(Boolean)
    )
  )

  return {
    validCodes,
    validPrefixes,
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractValidCodesFromText(rawText, validStickerData) {
  const { validCodes, validPrefixes } = validStickerData
  const normalizedText = String(rawText || '').toUpperCase()

  if (!validPrefixes.length) return []

  const prefixes = validPrefixes.map(escapeRegExp).join('|')

  const sources = [
    normalizedText.replace(/[^A-Z0-9]+/g, ' '),
    normalizeRaw(normalizedText),
  ]

  const extractedCodes = []

  for (const source of sources) {
    // Busca el prefijo (sin otra letra delante), un posible espacio, y el número,
    // asegurándose de que el número no esté inmediatamente seguido por otro posible dígito.
    const prefixRegex = new RegExp(
      `(^|[^A-Z])(${prefixes})\\s*([0-9OQDISBLZG]{1,3})(?![0-9OQDISBLZG])`,
      'g'
    )

    let match

    while ((match = prefixRegex.exec(source)) !== null) {
      const prefix = match[2]
      const number = normalizeNumberLike(match[3])

      if (!number) continue

      const code = normalizeStickerCode(`${prefix}${number}`)

      if (!validCodes.size || validCodes.has(code)) {
        extractedCodes.push(code)
      }
    }
  }

  return Array.from(new Set(extractedCodes))
}

function clampZone(bitmap, zone) {
  const x = Math.max(0, Math.floor(zone.x || 0))
  const y = Math.max(0, Math.floor(zone.y || 0))

  const width = Math.max(1, Math.min(Math.floor(zone.width || 1), bitmap.width - x))
  const height = Math.max(1, Math.min(Math.floor(zone.height || 1), bitmap.height - y))

  return { x, y, width, height }
}

function isReadableZone(bitmap, zone) {
  const safeZone = clampZone(bitmap, zone)
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
      Math.round(zone.x || 0),
      Math.round(zone.y || 0),
      Math.round(zone.width || 0),
      Math.round(zone.height || 0),
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

    // Código arriba derecha: caso horizontal un poco más amplio
    relativeZone(safeZone, 0.45, 0.00, 0.55, 0.35),
    relativeZone(safeZone, 0.55, 0.00, 0.45, 0.25),
    relativeZone(safeZone, 0.60, 0.00, 0.40, 0.20),

    // Si la estampa está girada 180 grados
    relativeZone(safeZone, 0.00, 0.65, 0.55, 0.35),
    relativeZone(safeZone, 0.00, 0.75, 0.45, 0.25),

    // Posibles posiciones en estampas verticales o fotos raras
    relativeZone(safeZone, 0.00, 0.00, 0.50, 0.30),
    relativeZone(safeZone, 0.50, 0.70, 0.50, 0.30),
  ])

  return candidates.filter(candidate => isReadableZone(bitmap, candidate))
}

function workerCanvasToUrl(bitmap, zone) {
  const safeZone = clampZone(bitmap, zone)

  const c = document.createElement('canvas')
  c.width = safeZone.width
  c.height = safeZone.height

  const cx = c.getContext('2d')
  cx.drawImage(bitmap, safeZone.x, safeZone.y, safeZone.width, safeZone.height, 0, 0, safeZone.width, safeZone.height)

  return c.toDataURL('image/jpeg', 0.86)
}

function buildOcrCanvas(bitmap, zone, mode = 'contrast', defaultScale = 5) {
  const safeZone = clampZone(bitmap, zone)

  // Escala dinámica (evita que recortes grandes se hagan masivos e indigeribles)
  let scale = defaultScale
  const maxDim = Math.max(safeZone.width, safeZone.height)
  if (maxDim * scale > 1200) {
    scale = Math.max(1, 1200 / maxDim)
  }

  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.floor(safeZone.width * scale))
  c.height = Math.max(1, Math.floor(safeZone.height * scale))

  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  ctx.drawImage(bitmap, safeZone.x, safeZone.y, safeZone.width, safeZone.height, 0, 0, c.width, c.height)

  if (mode === 'original') return c

  const imageData = ctx.getImageData(0, 0, c.width, c.height)
  const data = imageData.data

  let sum = 0
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
    data[i] = gray // Guardo temporalmente el gris en R
    sum += gray
  }

  // Calculamos el gris promedio para hacer contraste y umbrales dinámicos
  const avgGray = sum / Math.max(1, data.length / 4)
  const thresholdValue = Math.max(80, Math.min(200, avgGray * 0.95))

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i]
    let value = gray

    if (mode === 'contrast') {
      value = Math.round((gray - avgGray) * 2.5 + avgGray)
      value = Math.max(0, Math.min(255, value))
    } else if (mode === 'threshold') {
      value = gray > thresholdValue ? 255 : 0
    } else if (mode === 'threshold-invert') {
      value = gray > thresholdValue ? 0 : 255
    }

    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
  }

  ctx.putImageData(imageData, 0, 0)

  return c
}

async function runOcrAttempt(recognize, bitmap, zone, mode, pageSegMode) {
  if (!isReadableZone(bitmap, zone)) return { confidence: 0, text: '' }

  const canvas = buildOcrCanvas(bitmap, zone, mode, 5)

  if (canvas.width < 24 || canvas.height < 12) return { confidence: 0, text: '' }

  const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9)

  try {
    const result = await recognize(imageDataUrl, 'eng', {
      tessedit_pageseg_mode: String(pageSegMode)
    })

    return {
      confidence: Number(result?.data?.confidence ?? 0),
      text: String(result?.data?.text || ''),
    }
  } catch (error) {
    console.warn('OCR attempt failed:', error)
    return { confidence: 0, text: '' }
  }
}

async function recognizeZone(recognize, bitmap, zone, zoneIndex, validStickerData) {
  const candidateZones = buildCodeCandidateZones(bitmap, zone)
  const attempts = []

  for (let i = 0; i < candidateZones.length; i += 1) {
    const candidateZone = candidateZones[i]

    if (i === 0) {
      attempts.push({ zone: candidateZone, mode: 'original', pageSegMode: 11 })
      attempts.push({ zone: candidateZone, mode: 'contrast', pageSegMode: 11 })
    } else {
      attempts.push({ zone: candidateZone, mode: 'original', pageSegMode: 7 })
      attempts.push({ zone: candidateZone, mode: 'contrast', pageSegMode: 7 })
      attempts.push({ zone: candidateZone, mode: 'threshold', pageSegMode: 7 })
      attempts.push({ zone: candidateZone, mode: 'threshold-invert', pageSegMode: 7 })
    }
  }

  let bestInvalidReading = null

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i]
    const result = await runOcrAttempt(recognize, bitmap, attempt.zone, attempt.mode, attempt.pageSegMode)
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

      if (!bestInvalidReading || invalidReading.confidence > bestInvalidReading.confidence) {
        bestInvalidReading = invalidReading
      }
    }
  }

  return bestInvalidReading ? [bestInvalidReading] : []
}

function buildFallbackRegions(bitmap) {
  const { width, height } = bitmap

  return uniqueZones([
    { x: 0, y: 0, width, height },

    // Centro de la imagen
    {
      x: Math.floor(width * 0.08),
      y: Math.floor(height * 0.22),
      width: Math.floor(width * 0.84),
      height: Math.floor(height * 0.56),
    },

    // Zona superior derecha generalizada (para fotos tomadas de frente)
    {
      x: Math.floor(width * 0.4),
      y: Math.floor(height * 0.05),
      width: Math.floor(width * 0.55),
      height: Math.floor(height * 0.50),
    },
  ]).filter(region => isReadableZone(bitmap, region))
}

async function recognizeFullImageFallback(recognize, bitmap, validStickerData) {
  const fullZone = { x: 0, y: 0, width: bitmap.width, height: bitmap.height }
  
  const attempts = [
    { zone: fullZone, mode: 'original', pageSegMode: 11 },
    { zone: fullZone, mode: 'contrast', pageSegMode: 11 },
    { zone: fullZone, mode: 'threshold', pageSegMode: 11 },
  ]

  let bestText = ''
  let bestConfidence = 0

  for (let i = 0; i < attempts.length; i += 1) {
    const attempt = attempts[i]
    const result = await runOcrAttempt(recognize, bitmap, attempt.zone, attempt.mode, attempt.pageSegMode)
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
  const primaryRegions = detectCodeLabelRegions(bitmap)
  const fallbackRegions = buildFallbackRegions(bitmap)

  const allRegions = uniqueZones([
    ...primaryRegions,
    ...fallbackRegions,
  ]).filter(region => isReadableZone(bitmap, region))

  const zoneReadings = []

  for (let i = 0; i < allRegions.length; i += 1) {
    const zoneResults = await recognizeZone(recognize, bitmap, allRegions[i], i, validStickerData)
    zoneReadings.push(...zoneResults)
  }

  const grouped = classifyZoneReadings(zoneReadings, stickers)
  const hasAnyUseful = grouped.good.length || grouped.review.length

  if (hasAnyUseful) {
    return {
      grouped,
      regions: primaryRegions,
    }
  }

  const finalReadings = await recognizeFullImageFallback(recognize, bitmap, validStickerData)

  return {
    grouped: classifyZoneReadings(finalReadings, stickers),
    regions: primaryRegions,
  }
}
