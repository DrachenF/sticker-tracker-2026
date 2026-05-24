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
    ''
  )
}

function buildValidStickerData(stickers) {
  const list = Array.isArray(stickers) ? stickers : []

  const validCodes = new Set(
    list
      .map(getStickerCode)
      .map(normalizeStickerCode)
      .filter(Boolean)
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

  if (!validCodes.size || !validPrefixes.length) {
    return []
  }

  const prefixes = validPrefixes.map(escapeRegExp).join('|')

  const sources = [
    String(rawText || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' '),
    normalizeRaw(rawText),
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

      if (validCodes.has(code)) {
        extractedCodes.push(code)
      }
    }
  }

  return Array.from(new Set(extractedCodes))
}

function clampZone(bitmap, zone) {
  const x = Math.max(0, Math.floor(zone.x))
  const y = Math.max(0, Math.floor(zone.y))

  const width = Math.max(
    1,
    Math.min(Math.floor(zone.width), bitmap.width - x)
  )

  const height = Math.max(
    1,
    Math.min(Math.floor(zone.height), bitmap.height - y)
  )

  return {
    x,
    y,
    width,
    height,
  }
}

function relativeZone(parent, rx, ry, rw, rh) {
  return {
    x: Math.floor(parent.x + parent.width * rx),
    y: Math.floor(parent.y + parent.height * ry),
    width: Math.floor(parent.width * rw),
    height: Math.floor(parent.height * rh),
  }
}

function uniqueZones(zones) {
  const seen = new Set()

  return zones.filter(zone => {
    const key = [
      Math.round(zone.x),
      Math.round(zone.y),
      Math.round(zone.width),
      Math.round(zone.height),
    ].join('|')

    if (seen.has(key)) return false

    seen.add(key)
    return true
  })
}

function buildCodeCandidateZones(zone) {
  return uniqueZones([
    zone,

    // Caso normal de la foto que mandaste:
    // código en la parte superior derecha de la estampa horizontal.
    relativeZone(zone, 0.58, 0.00, 0.40, 0.24),
    relativeZone(zone, 0.63, 0.02, 0.32, 0.14),
    relativeZone(zone, 0.66, 0.04, 0.27, 0.10),

    // Si la imagen viene volteada 180 grados, ese código cae abajo a la izquierda.
    relativeZone(zone, 0.02, 0.76, 0.40, 0.24),
    relativeZone(zone, 0.05, 0.84, 0.32, 0.14),

    // Para estampas verticales o capturas raras.
    relativeZone(zone, 0.00, 0.00, 0.45, 0.25),
    relativeZone(zone, 0.55, 0.75, 0.45, 0.25),
    relativeZone(zone, 0.25, 0.00, 0.50, 0.20),
    relativeZone(zone, 0.25, 0.80, 0.50, 0.20),
  ])
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

function buildOcrCanvas(bitmap, zone, mode = 'contrast', scale = 4) {
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
      // Para texto gris/oscuro sobre fondo blanco.
      value = gray > 165 ? 255 : 0
    }

    if (mode === 'threshold-invert') {
      // Para texto blanco sobre fondo gris/oscuro.
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
  const canvas = buildOcrCanvas(bitmap, zone, mode, 5)
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
  const candidateZones = buildCodeCandidateZones(zone)

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
  const regions = []

  regions.push({
    x: 0,
    y: 0,
    width,
    height,
  })

  regions.push({
    x: Math.floor(width * 0.20),
    y: Math.floor(height * 0.25),
    width: Math.floor(width * 0.60),
    height: Math.floor(height * 0.45),
  })

  regions.push({
    x: Math.floor(width * 0.45),
    y: 0,
    width: Math.floor(width * 0.55),
    height: Math.floor(height * 0.40),
  })

  regions.push({
    x: Math.floor(width * 0.35),
    y: 0,
    width: Math.floor(width * 0.65),
    height: Math.floor(height * 0.55),
  })

  return regions
}

async function recognizeFullImageFallback(recognize, bitmap, stickers, validStickerData) {
  const fallbackCanvas = document.createElement('canvas')
  fallbackCanvas.width = bitmap.width
  fallbackCanvas.height = bitmap.height

  const fallbackCtx = fallbackCanvas.getContext('2d')
  fallbackCtx.drawImage(bitmap, 0, 0)

  const fallbackDataUrl = fallbackCanvas.toDataURL('image/jpeg', 1.0)

  const fullResult = await recognize(fallbackDataUrl, 'eng', {
    rotateAuto: true,
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
    tessedit_pageseg_mode: '11',
    preserve_interword_spaces: '1',
  })

  const rawFullText = fullResult?.data?.text || ''
  const extractedCodes = extractValidCodesFromText(rawFullText, validStickerData)

  if (extractedCodes.length > 0) {
    return extractedCodes.map((code, index) => ({
      id: `fallback-full-${index}`,
      confidence: Number(fullResult?.data?.confidence ?? 0),
      rawText: code,
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
    }))
  }

  return [
    {
      id: 'fallback-full',
      confidence: Number(fullResult?.data?.confidence ?? 0),
      rawText: normalizeRaw(rawFullText),
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
  ])

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
    stickers,
    validStickerData
  )

  return {
    grouped: classifyZoneReadings(finalReadings, stickers),
    regions: primaryRegions,
  }
}
