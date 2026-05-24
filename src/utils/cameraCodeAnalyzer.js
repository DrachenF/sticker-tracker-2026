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

  const imageDataUrl = workerCanvas.toDataURL('image/jpeg', 1.0)

  const result = await recognize(imageDataUrl, 'eng', {
    rotateAuto: true,
    // 1. Añadimos un ESPACIO al final del whitelist
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ', 
    // 2. Modo 11 (Sparse Text): Busca texto disperso en cualquier parte de la región
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

  const fallbackCanvas = document.createElement('canvas')
  fallbackCanvas.width = bitmap.width
  fallbackCanvas.height = bitmap.height
  const fallbackCtx = fallbackCanvas.getContext('2d')
  fallbackCtx.drawImage(bitmap, 0, 0)
  
  const fallbackDataUrl = fallbackCanvas.toDataURL('image/jpeg', 1.0)

  // OCR de texto completo como red de seguridad
  const fullResult = await recognize(fallbackDataUrl, 'eng', {
    rotateAuto: true,
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
    tessedit_pageseg_mode: '11', // Crucial para que lea las múltiples estampas dispersas
  })

  const rawFullText = fullResult?.data?.text || '';
  
  // 3. Extraemos con Regex patrones de "3 letras + espacio opcional + números" (ej: FWC 2, PAR1)
  const extractedCodes = rawFullText.toUpperCase().match(/[A-Z]{3}\s*\d+/g) || [];

  let finalReadings = [];

  if (extractedCodes.length > 0) {
    // Si encontró múltiples códigos en toda la foto, creamos un registro separado para cada uno
    finalReadings = extractedCodes.map((code, index) => ({
      id: `fallback-full-${index}`,
      confidence: Number(fullResult?.data?.confidence ?? 0),
      rawText: code.replace(/\s+/g, ''), // Limpiamos el espacio para que quede 'FWC2'
      region: { x: 0, y: 0, width: bitmap.width, height: bitmap.height },
      thumbUrl: workerCanvasToUrl(bitmap, { x: 0, y: 0, width: bitmap.width, height: bitmap.height }),
      manualCode: '',
    }));
  } else {
    // Comportamiento original si el Regex falla, devolvemos el texto normalizado como último recurso
    finalReadings = [{
      id: 'fallback-full',
      confidence: Number(fullResult?.data?.confidence ?? 0),
      rawText: normalizeRaw(rawFullText),
      region: { x: 0, y: 0, width: bitmap.width, height: bitmap.height },
      thumbUrl: workerCanvasToUrl(bitmap, { x: 0, y: 0, width: bitmap.width, height: bitmap.height }),
      manualCode: '',
    }];
  }

  return {
    grouped: classifyZoneReadings(finalReadings, stickers),
    regions: primaryRegions,
  }
}
