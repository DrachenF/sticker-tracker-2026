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

  if (!validPrefixes.length) {
    return []
  }

  const prefixes = validPrefixes.map(escapeRegExp).join('|')

  const sources = [
    normalizedText.replace(/[^A-Z0-9]+/g, ' '),
    normalizeRaw(normalizedText),
  ]

  const extractedCodes = []

  for (const source of sources) {
    const prefixRegex = new RegExp(
      `\\b(${prefixes})\\s*([0-9OQDISBLZG]{1,3})\\b`,
      'g'
    )

    let match

    while ((match = prefixRegex.exec(source)) !== null) {
      const prefix = match[1]
      const number = normalizeNumberLike(match[2])

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

  const width = Math.max(
    1,
    Math.min(Math.floor(zone.width || 1), bitmap.width - x)
  )

  const height = Math.max(
    1,
    Math.min(Math.floor(zone.height || 1), bitmap.height - y)
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

    // Código arriba derecha: caso horizontal como FWC 2
    relativeZone(safeZone, 0.52, 0.00, 0.46, 0.28),
    relativeZone(safeZone, 0.58, 0.00, 0.40, 0.24),
    relativeZone(safeZone, 0.62, 0.00, 0.34, 0.20),
    relativeZone(safeZone, 0.64, 0.02, 0.30, 0.16),

    // Si la estampa está girada 180 grados
    relativeZone(safeZone, 0.02, 0.72, 0.46, 0.28),
    relativeZone(safeZone, 0.04, 0.78, 0.40, 0.20),

    // Posibles posiciones en estampas verticales o fotos raras
    relativeZone(safeZone, 0.00, 0.00, 0.45, 0.25),
    relativeZone(safeZone, 0.55, 0.75, 0.45, 0.25),
    relativeZone(safeZone, 0.25, 0.00, 0.50, 0.22),
    relativeZone(safeZone, 0.25, 0.78, 0.50, 0.22),
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

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    const gray = Math.round((r * 0.299) + (g * 0.587) + (b * 0.114))

    let value = gray

    if (mode === 'contrast') {
      value = Math.round((gray - 128) * 2.4 + 128)
      value = Math.max(0, Math.min(255, value))
    }

    if (mode === 'threshold') {
      // Texto gris/oscuro sobre fondo claro
      value = gray > 165 ? 255 : 0
    }

    if (mode === 'threshold-invert') {
      // Texto blanco sobre fondo gris/oscuro
      value = gray > 165 ? 0 : 255
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

  if (canvas.width < 24 || canvas.height < 12) {
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
    }
  } catch (error) {
    console.warn('OCR attempt failed:', error)

    return {
      confidence: 0,
      text: '',
    }
  }
}

async function recognizeZone(recognize, bitmap, zone, zoneIndex, validStickerData) {
  const candidateZones = buildCodeCandidateZones(bitmap, zone)
  const attempts = []

  for (let i = 0; i < candidateZones.length; i += 1) {
    const candidateZone = candidateZones[i]

    if (i === 0) {
      attempts.push({
        zone: candidateZone,
        mode: 'contrast',
        pageSegMode: 11,
      })
    } else {
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
    }
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

    // Centro de la imagen: normalmente ahí está la estampa completa
    {
      x: Math.floor(width * 0.08),
      y: Math.floor(height * 0.22),
      width: Math.floor(width * 0.84),
      height: Math.floor(height * 0.56),
    },

    // Zona media-superior
    {
      x: Math.floor(width * 0.15),
      y: Math.floor(height * 0.25),
      width: Math.floor(width * 0.75),
      height: Math.floor(height * 0.35),
    },

    // Zona derecha donde suele estar el código
    {
      x: Math.floor(width * 0.48),
      y: Math.floor(height * 0.20),
      width: Math.floor(width * 0.42),
      height: Math.floor(height * 0.32),
    },

    // Zona superior derecha más específica
    {
      x: Math.floor(width * 0.56),
      y: Math.floor(height * 0.25),
      width: Math.floor(width * 0.34),
      height: Math.floor(height * 0.18),
    },
  ]).filter(region => isReadableZone(bitmap, region))
}

async function recognizeFullImageFallback(recognize, bitmap, validStickerData) {
  const attempts = [
    {
      zone: {
        x: 0,
        y: 0,
        width: bitmap.width,
        height: bitmap.height,
      },
      mode: 'original',
      pageSegMode: 11,
    },
    {
      zone: {
        x: 0,
        y: 0,
        width: bitmap.width,
        height: bitmap.height,
      },
      mode: 'contrast',
      pageSegMode: 11,
    },
    {
      zone: {
        x: 0,
        y: 0,
        width: bitmap.width,
        height: bitmap.height,
      },
      mode: 'threshold',
      pageSegMode: 11,
    },
    {
      zone: {
        x: 0,
        y: 0,
        width: bitmap.width,
        height: bitmap.height,
      },
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
      region: {
        x: 0,
        y: 0,
        width: bitmap.width,
        height: bitmap.height,
      },
      thumbUrl: workerCanvasToUrl(bitmap, {
        x: 0,
        y: 0,
        width: bitmap.width,
        height: bitmap.height,
      }),
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

  const grouped = classifyZoneReadings(zoneReadings, stickers)
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
    grouped: classifyZoneReadings(finalReadings, stickers),
    regions: primaryRegions,
  }
}
