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
  const samplesX = 8
  const samplesY = 10

  for (let gy = 0; gy < samplesY; gy += 1) {
    for (let gx = 0; gx < samplesX; gx += 1) {
      const cellX = Math.floor((gx / samplesX) * width)
      const cellY = Math.floor((gy / samplesY) * height)
      const w = Math.floor(width * 0.2)
      const h = Math.floor(height * 0.075)
      const x = clamp(cellX, 0, Math.max(0, width - w))
      const y = clamp(cellY, 0, Math.max(0, height - h))

      if (w < 34 || h < 10) continue
      if (w > width * 0.38 || h > height * 0.15) continue
      const ratio = w / h
      if (ratio < 2 || ratio > 9) continue

      const imgData = ctx.getImageData(x, y, w, h).data
      let minLum = 255
      let maxLum = 0
      for (let i = 0; i < imgData.length; i += 4) {
        const lum = (imgData[i] * 0.299) + (imgData[i + 1] * 0.587) + (imgData[i + 2] * 0.114)
        minLum = Math.min(minLum, lum)
        maxLum = Math.max(maxLum, lum)
      }
      const contrast = maxLum - minLum
      if (contrast < 48) continue

      regions.push({ x, y, width: w, height: h, contrast })
    }
  }

  return regions.sort((a, b) => b.contrast - a.contrast).slice(0, 40)
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

    review.push({ ...zoneItem, code, reason: 'Código no exacto', status: 'Revisar' })
  })

  return {
    good: dedupeByZoneAndCode(good),
    review: dedupeByZoneAndCode(review),
    invalid: invalid.slice(0, 24),
  }
}
