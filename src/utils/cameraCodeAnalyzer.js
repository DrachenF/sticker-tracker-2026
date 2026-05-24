import { classifyZoneReadings, detectCodeLabelRegions } from './ocrStickerCodes'

function normalizeRaw(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function workerCanvasToUrl(bitmap, zone) {
  const c = document.createElement('canvas')
  c.width = zone.width
  c.height = zone.height
  const cx = c.getContext('2d')
  cx.drawImage(bitmap, zone.x, zone.y, zone.width, zone.height, 0, 0, zone.width, zone.height)
  return c.toDataURL('image/jpeg', 0.86)
}

async function recognizeZone(recognize, bitmap, zone, zoneIndex) {
  const workerCanvas = document.createElement('canvas')
  workerCanvas.width = zone.width * 2
  workerCanvas.height = zone.height * 2
  const ctx = workerCanvas.getContext('2d')
  ctx.drawImage(bitmap, zone.x, zone.y, zone.width, zone.height, 0, 0, workerCanvas.width, workerCanvas.height)

  const result = await recognize(workerCanvas, 'eng', {
    rotateAuto: true,
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
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
  regions.push({ x: 0, y: 0, width, height })
  regions.push({ x: Math.floor(width * 0.45), y: 0, width: Math.floor(width * 0.55), height: Math.floor(height * 0.35) })
  regions.push({ x: Math.floor(width * 0.35), y: 0, width: Math.floor(width * 0.65), height: Math.floor(height * 0.5) })
  return regions
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
    return { grouped, regions: primaryRegions }
  }

  // OCR de texto completo como red de seguridad en fotos simples (1 estampa).
  const fullResult = await recognize(bitmap, 'eng', {
    rotateAuto: true,
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  })
  const fullTextReading = {
    id: 'fallback-full',
    confidence: Number(fullResult?.data?.confidence ?? 0),
    rawText: normalizeRaw(fullResult?.data?.text || ''),
    region: { x: 0, y: 0, width: bitmap.width, height: bitmap.height },
    thumbUrl: workerCanvasToUrl(bitmap, { x: 0, y: 0, width: bitmap.width, height: bitmap.height }),
    manualCode: '',
  }

  return {
    grouped: classifyZoneReadings([fullTextReading], stickers),
    regions: primaryRegions,
  }
}
