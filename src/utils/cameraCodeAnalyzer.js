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
  const validCodes = new Set(
    stickers
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

function workerCanvasToUrl(bitmap, zone) {
  const c = document.createElement('canvas')
  c.width = zone.width
  c.height = zone.height

  const cx = c.getContext('2d')
  cx.drawImage(
    bitmap,
    zone.x,
    zone.y,
    zone.width,
    zone.height,
    0,
    0,
    zone.width,
    zone.height
  )

  return c.toDataURL('image/jpeg', 0.86)
}

async function recognizeZone(recognize, bitmap, zone, zoneIndex) {
  const workerCanvas = document.createElement('canvas')
  workerCanvas.width = zone.width * 2
  workerCanvas.height = zone.height * 2

  const ctx = workerCanvas.getContext('2d')
  ctx.drawImage(
    bitmap,
    zone.x,
    zone.y,
    zone.width,
    zone.height,
    0,
    0,
    workerCanvas.width,
    workerCanvas.height
  )

  const imageDataUrl = workerCanvas.toDataURL('image/jpeg', 1.0)

  const result = await recognize(imageDataUrl, 'eng', {
    rotateAuto: true,
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
    tessedit_pageseg_mode: '11',
  })

  return {
    id: `zone-${zoneIndex}`,
    confidence: Number(result?.data?.confidence ?? 0),
    rawText: String(result?.data?.text || ''),
    region: zone,
    thumbUrl: workerCanvasToUrl(bitmap, zone),
    manualCode: '',
  }
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
    x: Math.floor(width * 0.45),
    y: 0,
    width: Math.floor(width * 0.55),
    height: Math.floor(height * 0.35),
  })

  regions.push({
    x: Math.floor(width * 0.35),
    y: 0,
    width: Math.floor(width * 0.65),
    height: Math.floor(height * 0.5),
  })

  return regions
}

function extractValidCodesFromText(rawText, stickers) {
  const { validCodes, validPrefixes } = buildValidStickerData(stickers)

  if (!validCodes.size || !validPrefixes.length) {
    return []
  }

  const searchableText = String(rawText || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')

  const prefixRegex = new RegExp(
    `\\b(${validPrefixes.join('|')})\\s*0*(\\d{1,3})\\b`,
    'g'
  )

  const extractedCodes = []
  let match

  while ((match = prefixRegex.exec(searchableText)) !== null) {
    const code = normalizeStickerCode(`${match[1]}${match[2]}`)

    if (validCodes.has(code)) {
      extractedCodes.push(code)
    }
  }

  return Array.from(new Set(extractedCodes))
}

export async function analyzeStickerCodesFromImage(recognize, bitmap, stickers) {
  const primaryRegions = detectCodeLabelRegions(bitmap)
  const allRegions = [...primaryRegions, ...buildFallbackRegions(bitmap)]
  const zoneReadings = []

  for (let i = 0; i < allRegions.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const zoneResult = await recognizeZone(recognize, bitmap, allRegions[i], i)
    zoneReadings.push(zoneResult)
  }

  const grouped = classifyZoneReadings(zoneReadings, stickers)
  const hasAnyUseful = grouped.good.length || grouped.review.length

  if (hasAnyUseful) {
    return {
      grouped,
      regions: primaryRegions,
    }
  }

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
  })

  const rawFullText = fullResult?.data?.text || ''
  const extractedCodes = extractValidCodesFromText(rawFullText, stickers)

  let finalReadings = []

  if (extractedCodes.length > 0) {
    finalReadings = extractedCodes.map((code, index) => ({
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
  } else {
    finalReadings = [
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

  return {
    grouped: classifyZoneReadings(finalReadings, stickers),
    regions: primaryRegions,
  }
}
