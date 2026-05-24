function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function normalizeCodeText(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function extractStrictCodeCandidates(value) {
  const normalized = normalizeCodeText(value)
  return normalized.match(/[A-Z]{3}\d{1,2}/g) || []
}

function buildValidCodeSet(stickers) {
  return new Set(stickers.map((item) => String(item.code || '').toUpperCase()))
}

export function detectCodeLabelRegions(imageBitmap) {
  const width = imageBitmap.width
  const height = imageBitmap.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(imageBitmap, 0, 0)

  const regions = []
  const stickerSamplesX = 7
  const stickerSamplesY = 7
  const stickerScale = [0.2, 0.27, 0.34]

  const evaluateZone = (x, y, w, h) => {
    const imgData = ctx.getImageData(x, y, w, h).data
    let minLum = 255
    let maxLum = 0
    let sumLum = 0
    let brightCount = 0
    let darkCount = 0
    let transitions = 0
    let prevLum = -1

    for (let i = 0; i < imgData.length; i += 4) {
      const lum = (imgData[i] * 0.299) + (imgData[i + 1] * 0.587) + (imgData[i + 2] * 0.114)
      minLum = Math.min(minLum, lum)
      maxLum = Math.max(maxLum, lum)
      sumLum += lum
      if (lum > 188) brightCount += 1
      if (lum < 118) darkCount += 1
      if (prevLum >= 0 && Math.abs(lum - prevLum) > 42) transitions += 1
      prevLum = lum
    }

    const totalPixels = w * h
    const contrast = maxLum - minLum
    const brightRatio = brightCount / totalPixels
    const darkRatio = darkCount / totalPixels
    const transitionRatio = transitions / totalPixels
    const meanLum = sumLum / totalPixels

    // El codigo real suele verse como capsula clara sobre fondo gris:
    // contraste medio-alto, mezcla de claros y oscuros, y no excesivo ruido.
    if (contrast < 52) return null
    if (brightRatio < 0.18 || brightRatio > 0.82) return null
    if (darkRatio < 0.08 || darkRatio > 0.66) return null
    if (transitionRatio < 0.03 || transitionRatio > 0.24) return null
    if (meanLum < 92 || meanLum > 205) return null

    const score = (contrast * 1.25) + (brightRatio * 65) + (darkRatio * 45) - (transitionRatio * 140)
    return { contrast, score }
  }

  for (let gy = 0; gy < stickerSamplesY; gy += 1) {
    for (let gx = 0; gx < stickerSamplesX; gx += 1) {
      for (const scale of stickerScale) {
        const stickerW = Math.floor(width * scale)
        const stickerH = Math.floor(stickerW * 0.68)
        if (stickerW < 120 || stickerH < 70) continue

        const anchorX = Math.floor((gx / stickerSamplesX) * width)
        const anchorY = Math.floor((gy / stickerSamplesY) * height)
        const stickerX = clamp(anchorX - Math.floor(stickerW * 0.55), 0, Math.max(0, width - stickerW))
        const stickerY = clamp(anchorY - Math.floor(stickerH * 0.5), 0, Math.max(0, height - stickerH))

        const zoneW = Math.floor(stickerW * 0.38)
        const zoneH = Math.floor(stickerH * 0.22)
        const zoneX = clamp(stickerX + Math.floor(stickerW * 0.58), 0, Math.max(0, width - zoneW))
        const zoneY = clamp(stickerY + Math.floor(stickerH * 0.03), 0, Math.max(0, height - zoneH))

        const analysis = evaluateZone(zoneX, zoneY, zoneW, zoneH)
        if (!analysis) continue

        regions.push({
          x: zoneX,
          y: zoneY,
          width: zoneW,
          height: zoneH,
          contrast: analysis.contrast,
          score: analysis.score,
        })
      }
    }
  }

  return regions.sort((a, b) => b.score - a.score).slice(0, 20)
}

function overlaps(a, b) {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  return x2 > x1 && y2 > y1
}

export function dedupeByZoneAndCode(entries) {
  const picked = []
  entries.forEach((item) => {
    const existing = picked.find((current) => current.code === item.code && overlaps(current.region, item.region))
    if (!existing) {
      picked.push(item)
      return
    }
    if (item.confidence > existing.confidence) {
      const idx = picked.indexOf(existing)
      picked[idx] = item
    }
  })
  return picked
}

export function classifyZoneReadings(zoneReadings, stickers) {
  const validCodeSet = buildValidCodeSet(stickers)
  const prefixSet = new Set(stickers.map((item) => String(item.code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)).filter((item) => item.length === 3))
  const good = []
  const review = []
  const invalid = []

  zoneReadings.forEach((zoneItem) => {
    const matches = extractStrictCodeCandidates(zoneItem.rawText)
    const bestCandidate = matches[0] || ''

    if (!bestCandidate) {
      invalid.push({ ...zoneItem, code: '', reason: 'No leído' })
      return
    }

    const code = normalizeCodeText(bestCandidate)
    if (validCodeSet.has(code) && zoneItem.confidence >= 62) {
      good.push({ ...zoneItem, code, status: 'Reconocido' })
      return
    }

    if (validCodeSet.has(code)) {
      review.push({ ...zoneItem, code, reason: 'Confianza baja', status: 'Revisar' })
      return
    }

    const prefix = code.slice(0, 3)
    if (prefixSet.has(prefix) && zoneItem.confidence >= 56) {
      review.push({ ...zoneItem, code, reason: 'Coincidencia parcial', status: 'Revisar' })
      return
    }

    invalid.push({ ...zoneItem, code, reason: 'Código inválido' })
  })

  return {
    good: dedupeByZoneAndCode(good),
    review: dedupeByZoneAndCode(review),
    invalid: invalid.slice(0, 24),
  }
}
