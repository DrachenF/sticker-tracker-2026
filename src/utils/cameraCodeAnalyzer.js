import { classifyZoneReadings } from './ocrStickerCodes'

const DEBUG_DETECTOR = true

const MAX_VISUAL_CANDIDATES = 36
const MAX_OCR_SINGLE = 14
const MAX_OCR_MULTI = 22
const MAX_DEBUG_RESULTS = 28

const VALID_PREFIXES = [
  'FWC',

  'ALG', 'ARG', 'AUS', 'AUT', 'BEL', 'BIH', 'BRA', 'CAN',
  'CPV', 'COL', 'COD', 'CRO', 'CUW', 'CZE', 'ECU', 'EGY',
  'ENG', 'FRA', 'GER', 'GHA', 'HAI', 'IRN', 'IRQ', 'CIV',
  'JPN', 'JOR', 'MEX', 'MAR', 'NED', 'NZL', 'NOR', 'PAN',
  'PAR', 'POR', 'QAT', 'KSA', 'SCO', 'SEN', 'RSA', 'KOR',
  'ESP', 'SWE', 'SUI', 'TUN', 'TUR', 'URU', 'USA', 'UZB',
]

const NON_FWC_PREFIXES = VALID_PREFIXES.filter(prefix => prefix !== 'FWC')

const STOP_WORDS = [
  'FIFA',
  'WORLD',
  'CUP',
  'OFFICIAL',
  'LICENSED',
  'PRODUCT',
  'PANINI',
  'MANUFACTURED',
  'BRASIL',
  'BRAZIL',
  'TRADE',
  'NAMES',
  'EVENTS',
  'DESIGNS',
  'LOGOS',
  'ALBUM',
  'STICKERS',
]

export async function normalizeImageFileToBitmap(file) {
  const sourceBitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  })

  return normalizeBitmapForAnalysis(sourceBitmap)
}

async function normalizeBitmapForAnalysis(bitmap) {
  const maxSide = 1800
  const scale = Math.min(
    1,
    maxSide / Math.max(bitmap.width, bitmap.height)
  )

  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)

  return createImageBitmap(canvas)
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
    ...zone,
    x,
    y,
    width,
    height,
  }
}

function normalizeAngle(angle) {
  let value = Number(angle || 0)

  while (value > 45) value -= 90
  while (value < -45) value += 90

  if (Math.abs(value) < 5) return 0

  return Number(value.toFixed(1))
}

function expandZone(bitmap, zone, amountX = 0.16, amountY = 0.28) {
  const safe = clampZone(bitmap, zone)

  const extraX = Math.floor(safe.width * amountX)
  const extraY = Math.floor(safe.height * amountY)

  return clampZone(bitmap, {
    ...safe,
    x: safe.x - extraX,
    y: safe.y - extraY,
    width: safe.width + extraX * 2,
    height: safe.height + extraY * 2,
  })
}

function getPixelInfo(data, index) {
  const i = index * 4
  const r = data[i]
  const g = data[i + 1]
  const b = data[i + 2]

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)

  return {
    r,
    g,
    b,
    gray: Math.round(r * 0.299 + g * 0.587 + b * 0.114),
    chroma: max - min,
  }
}

function createMaskClassifier(kind) {
  if (kind === 'light-code') {
    return ({ gray, chroma }) => (
      gray >= 132 &&
      gray <= 252 &&
      chroma <= 58
    )
  }

  if (kind === 'dark-code') {
    return ({ gray, chroma }) => (
      gray >= 34 &&
      gray <= 178 &&
      chroma <= 62
    )
  }

  return () => false
}

function getComponentAngle(component) {
  const count = Math.max(1, component.count || 1)

  const meanX = component.sumX / count
  const meanY = component.sumY / count

  const covXX = component.sumXX / count - meanX * meanX
  const covYY = component.sumYY / count - meanY * meanY
  const covXY = component.sumXY / count - meanX * meanY

  if (!Number.isFinite(covXX) || !Number.isFinite(covYY) || !Number.isFinite(covXY)) {
    return 0
  }

  const angleRad = 0.5 * Math.atan2(2 * covXY, covXX - covYY)
  const angleDeg = (angleRad * 180) / Math.PI

  return normalizeAngle(angleDeg)
}

function measureZoneStats(bitmap, zone) {
  const safe = clampZone(bitmap, zone)

  const maxW = 150
  const scale = Math.min(1, maxW / safe.width)

  const w = Math.max(1, Math.floor(safe.width * scale))
  const h = Math.max(1, Math.floor(safe.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h

  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  ctx.drawImage(
    bitmap,
    safe.x,
    safe.y,
    safe.width,
    safe.height,
    0,
    0,
    w,
    h
  )

  const imageData = ctx.getImageData(0, 0, w, h)
  const data = imageData.data

  const grays = []
  let sumGray = 0
  let sumChroma = 0
  let coloredCount = 0
  let brightCount = 0
  let darkCount = 0

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const chroma = max - min
    const gray = Math.round(r * 0.299 + g * 0.587 + b * 0.114)

    grays.push(gray)
    sumGray += gray
    sumChroma += chroma

    if (chroma >= 70) coloredCount += 1
    if (gray >= 165) brightCount += 1
    if (gray <= 95) darkCount += 1
  }

  const count = Math.max(1, grays.length)
  const avgGray = sumGray / count
  const avgChroma = sumChroma / count

  let variance = 0

  grays.forEach(gray => {
    variance += (gray - avgGray) ** 2
  })

  const stdGray = Math.sqrt(variance / count)

  let edgeCount = 0
  let comparisons = 0

  for (let y = 0; y < h; y += 1) {
    for (let x = 1; x < w; x += 1) {
      const current = grays[y * w + x]
      const previous = grays[y * w + x - 1]

      if (Math.abs(current - previous) >= 18) {
        edgeCount += 1
      }

      comparisons += 1
    }
  }

  return {
    avgGray: Number(avgGray.toFixed(1)),
    avgChroma: Number(avgChroma.toFixed(1)),
    stdGray: Number(stdGray.toFixed(1)),
    coloredRatio: Number((coloredCount / count).toFixed(3)),
    brightRatio: Number((brightCount / count).toFixed(3)),
    darkRatio: Number((darkCount / count).toFixed(3)),
    edgeRatio: Number((edgeCount / Math.max(1, comparisons)).toFixed(3)),
  }
}

function scoreCodeCandidate(bitmap, zone, kind, componentMeta = {}) {
  const safe = clampZone(bitmap, zone)
  const stats = measureZoneStats(bitmap, safe)
  const ratio = safe.width / Math.max(1, safe.height)
  const areaRatio = (safe.width * safe.height) / Math.max(1, bitmap.width * bitmap.height)

  let score = 0

  if (ratio >= 1.55 && ratio <= 7.4) score += 80
  if (ratio >= 2.0 && ratio <= 5.8) score += 70
  if (ratio >= 2.5 && ratio <= 4.8) score += 30

  if (areaRatio >= 0.00012 && areaRatio <= 0.018) score += 70
  else score -= 150

  if (stats.coloredRatio <= 0.055) score += 120
  else if (stats.coloredRatio <= 0.10) score += 70
  else if (stats.coloredRatio <= 0.16) score += 15
  else score -= 260

  if (stats.avgChroma <= 34) score += 120
  else if (stats.avgChroma <= 50) score += 70
  else if (stats.avgChroma <= 66) score += 15
  else score -= 260

  if (stats.stdGray >= 8 && stats.stdGray <= 105) score += 70
  if (stats.edgeRatio >= 0.012 && stats.edgeRatio <= 0.58) score += 75

  if (stats.stdGray < 6) score -= 150
  if (stats.edgeRatio < 0.008) score -= 150

  if (kind === 'light-code') {
    if (stats.avgGray >= 130) score += 45
    if (stats.brightRatio >= 0.28) score += 35
    if (stats.darkRatio >= 0.02) score += 15
  }

  if (kind === 'dark-code') {
    if (stats.avgGray >= 42 && stats.avgGray <= 170) score += 45
    if (stats.darkRatio >= 0.18) score += 35
    if (stats.brightRatio >= 0.02) score += 15
  }

  if (componentMeta.fillRatio >= 0.12 && componentMeta.fillRatio <= 0.96) {
    score += 25
  }

  if (stats.coloredRatio >= 0.22) score -= 350
  if (stats.avgChroma >= 82) score -= 350
  if (ratio < 1.25 || ratio > 9.2) score -= 280
  if (areaRatio > 0.030) score -= 280

  return {
    score: Math.round(score),
    stats,
    ratio: Number(ratio.toFixed(2)),
    areaRatio: Number(areaRatio.toFixed(5)),
  }
}

function componentToCodeCandidates(bitmap, component, scale, kind, imageArea) {
  const boxW = component.maxX - component.minX + 1
  const boxH = component.maxY - component.minY + 1
  const area = boxW * boxH
  const fillRatio = component.count / Math.max(1, area)
  const ratio = boxW / Math.max(1, boxH)

  const originalX = Math.floor(component.minX / scale)
  const originalY = Math.floor(component.minY / scale)
  const originalW = Math.floor(boxW / scale)
  const originalH = Math.floor(boxH / scale)

  if (originalW < 18 || originalH < 7) return []
  if (originalW > bitmap.width * 0.34) return []
  if (originalH > bitmap.height * 0.14) return []
  if (ratio < 1.15 || ratio > 9.6) return []
  if (fillRatio < 0.09) return []

  const areaRatio = (originalW * originalH) / Math.max(1, imageArea)

  if (areaRatio < 0.000045 || areaRatio > 0.030) return []

  const base = clampZone(bitmap, {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  })

  const angle = normalizeAngle(getComponentAngle(component))
  const isLight = kind === 'light-code'

  const variants = [
    {
      ...expandZone(bitmap, base, 0.22, 0.35),
      kind: isLight ? 'code-light-tight' : 'code-dark-tight',
      score: isLight ? 1100 : 1080,
      allowedPrefixes: isLight ? ['FWC'] : NON_FWC_PREFIXES,
    },
    {
      ...expandZone(bitmap, base, 0.45, 0.45),
      kind: isLight ? 'code-light-wide' : 'code-dark-wide',
      score: isLight ? 1030 : 1010,
      allowedPrefixes: isLight ? ['FWC'] : NON_FWC_PREFIXES,
    },
  ]

  return variants
    .map(candidate => {
      const visual = scoreCodeCandidate(bitmap, candidate, kind, {
        fillRatio,
      })

      if (visual.score < 70) return null

      return {
        ...candidate,
        angle,
        rotateThumb: false,
        forced: false,
        score: candidate.score + visual.score,
        meta: {
          originalRatio: Number(ratio.toFixed(2)),
          ratio: visual.ratio,
          fillRatio: Number(fillRatio.toFixed(2)),
          componentArea: Number(areaRatio.toFixed(5)),
          areaRatio: visual.areaRatio,
          visual: visual.score,
          angle,
          ...visual.stats,
        },
      }
    })
    .filter(Boolean)
}

function detectComponents(bitmap, kind) {
  const maxW = 980
  const scale = Math.min(1, maxW / bitmap.width)

  const w = Math.max(1, Math.floor(bitmap.width * scale))
  const h = Math.max(1, Math.floor(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, w, h)

  const imageData = ctx.getImageData(0, 0, w, h)
  const data = imageData.data
  const visited = new Uint8Array(w * h)

  const isTargetPixel = createMaskClassifier(kind)
  const imageArea = bitmap.width * bitmap.height
  const results = []

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const start = y * w + x

      if (visited[start]) continue

      const info = getPixelInfo(data, start)

      if (!isTargetPixel(info)) {
        visited[start] = 1
        continue
      }

      const stack = [start]
      visited[start] = 1

      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      let count = 0

      let sumX = 0
      let sumY = 0
      let sumXX = 0
      let sumYY = 0
      let sumXY = 0

      while (stack.length) {
        const current = stack.pop()
        const cx = current % w
        const cy = Math.floor(current / w)

        count += 1

        sumX += cx
        sumY += cy
        sumXX += cx * cx
        sumYY += cy * cy
        sumXY += cx * cy

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
          if (visited[next]) return

          const nextInfo = getPixelInfo(data, next)

          if (!isTargetPixel(nextInfo)) {
            visited[next] = 1
            return
          }

          visited[next] = 1
          stack.push(next)
        })
      }

      const component = {
        minX,
        maxX,
        minY,
        maxY,
        count,
        sumX,
        sumY,
        sumXX,
        sumYY,
        sumXY,
      }

      const candidates = componentToCodeCandidates(bitmap, component, scale, kind, imageArea)

      candidates.forEach(candidate => {
        results.push(candidate)
      })
    }
  }

  return results
}

function regionIoU(a, b) {
  const ax1 = a.x
  const ay1 = a.y
  const ax2 = a.x + a.width
  const ay2 = a.y + a.height

  const bx1 = b.x
  const by1 = b.y
  const bx2 = b.x + b.width
  const by2 = b.y + b.height

  const ix1 = Math.max(ax1, bx1)
  const iy1 = Math.max(ay1, by1)
  const ix2 = Math.min(ax2, bx2)
  const iy2 = Math.min(ay2, by2)

  const iw = Math.max(0, ix2 - ix1)
  const ih = Math.max(0, iy2 - iy1)

  const intersection = iw * ih
  const union = a.width * a.height + b.width * b.height - intersection

  if (!union) return 0

  return intersection / union
}

function removeOverlappingRegions(regions, maxOverlap = 0.52) {
  const sorted = [...regions].sort((a, b) => b.score - a.score)
  const kept = []

  sorted.forEach(region => {
    const overlaps = kept.some(existing => {
      if (existing.rotateThumb !== region.rotateThumb) return false
      return regionIoU(existing, region) > maxOverlap
    })

    if (!overlaps) kept.push(region)
  })

  return kept
}

function uniqueZones(zones) {
  const seen = new Set()

  return zones.filter(zone => {
    const key = [
      Math.round(zone?.x || 0),
      Math.round(zone?.y || 0),
      Math.round(zone?.width || 0),
      Math.round(zone?.height || 0),
      zone?.kind || '',
      zone?.rotateThumb ? 'ROT' : 'NORMAL',
    ].join('|')

    if (seen.has(key)) return false

    seen.add(key)
    return true
  })
}

function shouldAddRotatedCopy(candidate) {
  if (candidate.forced) return false

  const angle = Math.abs(normalizeAngle(candidate.angle || 0))

  return angle >= 8 && angle <= 28
}

function addRotatedCopies(candidates) {
  const copies = []

  candidates.forEach(candidate => {
    if (!shouldAddRotatedCopy(candidate)) return

    copies.push({
      ...candidate,
      kind: `${candidate.kind}-ROT`,
      rotateThumb: true,
      score: candidate.score + 70,
      angle: normalizeAngle(candidate.angle || 0),
    })
  })

  return copies
}

function makeFixedSingleFallbacks(bitmap) {
  const { width, height } = bitmap

  const zones = [
    {
      x: Math.floor(width * 0.555),
      y: Math.floor(height * 0.275),
      width: Math.floor(width * 0.430),
      height: Math.floor(height * 0.155),
      kind: 'fixed-single-fwc-superwide',
      score: 2200,
      allowedPrefixes: ['FWC'],
    },
    {
      x: Math.floor(width * 0.585),
      y: Math.floor(height * 0.292),
      width: Math.floor(width * 0.365),
      height: Math.floor(height * 0.125),
      kind: 'fixed-single-fwc-wide',
      score: 2180,
      allowedPrefixes: ['FWC'],
    },
    {
      x: Math.floor(width * 0.610),
      y: Math.floor(height * 0.302),
      width: Math.floor(width * 0.310),
      height: Math.floor(height * 0.105),
      kind: 'fixed-single-fwc-tight',
      score: 2140,
      allowedPrefixes: ['FWC'],
    },
    {
      x: Math.floor(width * 0.515),
      y: Math.floor(height * 0.115),
      width: Math.floor(width * 0.475),
      height: Math.floor(height * 0.155),
      kind: 'fixed-single-country-superwide',
      score: 2200,
      allowedPrefixes: NON_FWC_PREFIXES,
    },
    {
      x: Math.floor(width * 0.555),
      y: Math.floor(height * 0.132),
      width: Math.floor(width * 0.400),
      height: Math.floor(height * 0.122),
      kind: 'fixed-single-country-wide',
      score: 2180,
      allowedPrefixes: NON_FWC_PREFIXES,
    },
    {
      x: Math.floor(width * 0.600),
      y: Math.floor(height * 0.145),
      width: Math.floor(width * 0.330),
      height: Math.floor(height * 0.095),
      kind: 'fixed-single-country-tight',
      score: 2140,
      allowedPrefixes: NON_FWC_PREFIXES,
    },
  ]

  return zones.map(zone => {
    const safe = clampZone(bitmap, zone)
    const isFwc = zone.kind.includes('fwc')
    const visual = scoreCodeCandidate(bitmap, safe, isFwc ? 'light-code' : 'dark-code')

    return {
      ...safe,
      forced: true,
      rotateThumb: false,
      angle: 0,
      score: zone.score + visual.score,
      allowedPrefixes: zone.allowedPrefixes,
      meta: {
        visual: visual.score,
        ratio: visual.ratio,
        areaRatio: visual.areaRatio,
        ...visual.stats,
      },
    }
  })
}

function filterVisualCandidate(candidate) {
  if (candidate.forced) return true

  const stats = candidate.meta || {}
  const ratio = candidate.width / Math.max(1, candidate.height)

  if (Number(stats.coloredRatio || 0) >= 0.18) return false
  if (Number(stats.avgChroma || 0) >= 72) return false
  if (Number(stats.edgeRatio || 0) < 0.006) return false
  if (Number(stats.stdGray || 0) < 5) return false
  if (ratio < 1.15 || ratio > 9.5) return false

  return true
}

function detectVisualCandidates(bitmap) {
  const lightCandidates = detectComponents(bitmap, 'light-code')
  const darkCandidates = detectComponents(bitmap, 'dark-code')

  const detected = uniqueZones([
    ...lightCandidates,
    ...darkCandidates,
  ]).filter(filterVisualCandidate)

  const withRotation = uniqueZones([
    ...detected,
    ...addRotatedCopies(detected),
  ])

  return removeOverlappingRegions(withRotation, 0.50)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_VISUAL_CANDIDATES)
}

function makeNormalCanvas(bitmap, candidate, scale = 6) {
  const safe = clampZone(bitmap, candidate)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(safe.width * scale))
  canvas.height = Math.max(1, Math.floor(safe.height * scale))

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = false

  ctx.drawImage(
    bitmap,
    safe.x,
    safe.y,
    safe.width,
    safe.height,
    0,
    0,
    canvas.width,
    canvas.height
  )

  return canvas
}

function makeRotatedCanvas(bitmap, candidate, scale = 5) {
  const safe = clampZone(bitmap, candidate)
  const angle = normalizeAngle(candidate.angle || 0)

  if (!angle) return makeNormalCanvas(bitmap, candidate, scale)

  const padding = Math.ceil(Math.max(safe.width, safe.height) * 0.42)
  const sourceX = Math.max(0, safe.x - padding)
  const sourceY = Math.max(0, safe.y - padding)
  const sourceW = Math.min(safe.width + padding * 2, bitmap.width - sourceX)
  const sourceH = Math.min(safe.height + padding * 2, bitmap.height - sourceY)

  const diagonal = Math.ceil(Math.sqrt(sourceW * sourceW + sourceH * sourceH))

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(diagonal * scale))
  canvas.height = Math.max(1, Math.floor(diagonal * scale))

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = false

  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((-angle * Math.PI) / 180)

  ctx.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceW,
    sourceH,
    -(sourceW * scale) / 2,
    -(sourceH * scale) / 2,
    sourceW * scale,
    sourceH * scale
  )

  return canvas
}

function candidateToCanvas(bitmap, candidate, scale = 6) {
  return candidate.rotateThumb
    ? makeRotatedCanvas(bitmap, candidate, scale)
    : makeNormalCanvas(bitmap, candidate, scale)
}

function canvasToUrl(canvas) {
  return canvas.toDataURL('image/png')
}

function renderVariantCell(sourceCanvas, mode, cellW, cellH) {
  const canvas = document.createElement('canvas')
  canvas.width = cellW
  canvas.height = cellH

  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cellW, cellH)

  const marginX = 10
  const marginY = 10

  const scale = Math.min(
    (cellW - marginX * 2) / sourceCanvas.width,
    (cellH - marginY * 2) / sourceCanvas.height
  )

  const drawW = Math.max(1, Math.floor(sourceCanvas.width * scale))
  const drawH = Math.max(1, Math.floor(sourceCanvas.height * scale))
  const dx = Math.floor((cellW - drawW) / 2)
  const dy = Math.floor((cellH - drawH) / 2)

  ctx.imageSmoothingEnabled = false
  ctx.drawImage(sourceCanvas, dx, dy, drawW, drawH)

  const imageData = ctx.getImageData(0, 0, cellW, cellH)
  const data = imageData.data

  let totalGray = 0
  let count = 0

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
    totalGray += gray
    count += 1
  }

  const avgGray = totalGray / Math.max(1, count)

  for (let i = 0; i < data.length; i += 4) {
    const grayRaw = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114)
    let gray = grayRaw

    if (mode === 'contrast') {
      gray = Math.round((grayRaw - 128) * 2.15 + 128)
    }

    if (mode === 'darkText') {
      gray = grayRaw < avgGray - 8 ? 0 : 255
    }

    if (mode === 'lightText') {
      gray = grayRaw > avgGray + 8 ? 0 : 255
    }

    gray = Math.max(0, Math.min(255, gray))

    data[i] = gray
    data[i + 1] = gray
    data[i + 2] = gray
    data[i + 3] = 255
  }

  ctx.putImageData(imageData, 0, 0)

  return canvas
}

function makeOcrBatchSheet(bitmap, candidates) {
  const cellW = 260
  const cellH = 105
  const gap = 10
  const rowH = cellH + gap
  const sheetW = cellW * 3 + gap * 4
  const sheetH = Math.max(rowH, candidates.length * rowH)

  const sheet = document.createElement('canvas')
  sheet.width = sheetW
  sheet.height = sheetH

  const ctx = sheet.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, sheetW, sheetH)

  const thumbs = []

  candidates.forEach((candidate, index) => {
    const crop = candidateToCanvas(bitmap, candidate, candidate.forced ? 7 : 6)
    thumbs.push(canvasToUrl(crop))

    const y = index * rowH

    const contrast = renderVariantCell(crop, 'contrast', cellW, cellH)
    const darkText = renderVariantCell(crop, 'darkText', cellW, cellH)
    const lightText = renderVariantCell(crop, 'lightText', cellW, cellH)

    ctx.drawImage(contrast, gap, y)
    ctx.drawImage(darkText, gap * 2 + cellW, y)
    ctx.drawImage(lightText, gap * 3 + cellW * 2, y)
  })

  return {
    sheet,
    rowH,
    thumbs,
  }
}

function cleanOcrText(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[|()[\]{}]/g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function repairNumber(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[OQD]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[ZS]/g, '2')
    .replace(/[^0-9]/g, '')
}

function repairPrefixRaw(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S')
    .replace(/8/g, 'B')
    .replace(/4/g, 'A')
    .replace(/6/g, 'G')
    .replace(/[^A-Z]/g, '')
}

function isValidNumber(number) {
  const value = Number(number)
  return Number.isFinite(value) && value >= 1 && value <= 20
}

function countStopWords(cleanText) {
  return STOP_WORDS.reduce((total, word) => {
    if (cleanText.includes(word)) return total + 1
    return total
  }, 0)
}

function editDistance(a, b) {
  const aa = String(a || '')
  const bb = String(b || '')

  const dp = Array.from({ length: aa.length + 1 }, () =>
    Array(bb.length + 1).fill(0)
  )

  for (let i = 0; i <= aa.length; i += 1) dp[i][0] = i
  for (let j = 0; j <= bb.length; j += 1) dp[0][j] = j

  for (let i = 1; i <= aa.length; i += 1) {
    for (let j = 1; j <= bb.length; j += 1) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1

      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      )
    }
  }

  return dp[aa.length][bb.length]
}

function getAllowedPrefixes(candidate) {
  const kind = String(candidate.kind || '').toLowerCase()

  if (Array.isArray(candidate.allowedPrefixes) && candidate.allowedPrefixes.length) {
    return candidate.allowedPrefixes
  }

  if (kind.includes('light') || kind.includes('fwc')) return ['FWC']

  return VALID_PREFIXES
}

function getClosestPrefix(rawPrefix, allowedPrefixes) {
  const repaired = repairPrefixRaw(rawPrefix)

  if (!repaired) return ''

  if (allowedPrefixes.includes(repaired)) return repaired

  let best = ''
  let bestDistance = Infinity

  allowedPrefixes.forEach(prefix => {
    const distance = editDistance(repaired, prefix)

    if (distance < bestDistance) {
      best = prefix
      bestDistance = distance
    }
  })

  if (bestDistance <= 1) return best

  return ''
}

function extractCodesFromText(text, candidate) {
  const clean = cleanOcrText(text)

  if (!clean) return []

  const stopCount = countStopWords(clean)

  if (stopCount >= 3 && !candidate.forced) return []

  const allowedPrefixes = getAllowedPrefixes(candidate)
  const joined = clean.replace(/\s+/g, '')
  const found = []

  const prefixPart = allowedPrefixes.join('|')

  const exactSpacedRegex = new RegExp(`\\b(${prefixPart})\\s*([0-9OQDILZS]{1,2})\\b`, 'g')
  let exactSpacedMatch = exactSpacedRegex.exec(clean)

  while (exactSpacedMatch) {
    const prefix = exactSpacedMatch[1]
    const number = repairNumber(exactSpacedMatch[2])

    if (isValidNumber(number)) found.push(`${prefix}${number}`)

    exactSpacedMatch = exactSpacedRegex.exec(clean)
  }

  const exactJoinedRegex = new RegExp(`(${prefixPart})([0-9OQDILZS]{1,2})`, 'g')
  let exactJoinedMatch = exactJoinedRegex.exec(joined)

  while (exactJoinedMatch) {
    const prefix = exactJoinedMatch[1]
    const number = repairNumber(exactJoinedMatch[2])

    if (isValidNumber(number)) found.push(`${prefix}${number}`)

    exactJoinedMatch = exactJoinedRegex.exec(joined)
  }

  if (found.length) {
    return [...new Set(found.map(normalizeCode))]
  }

  const fuzzyJoinedRegex = /([A-Z0-9]{2,4})([0-9OQDILZS]{1,2})/g
  let fuzzyJoinedMatch = fuzzyJoinedRegex.exec(joined)

  while (fuzzyJoinedMatch) {
    const prefix = getClosestPrefix(fuzzyJoinedMatch[1], allowedPrefixes)
    const number = repairNumber(fuzzyJoinedMatch[2])

    if (prefix && isValidNumber(number)) found.push(`${prefix}${number}`)

    fuzzyJoinedMatch = fuzzyJoinedRegex.exec(joined)
  }

  const tokens = clean.split(/\s+/).filter(Boolean)

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const rawPrefix = tokens[i]
    const rawNumber = tokens[i + 1]

    if (!/^[A-Z0-9]{2,4}$/.test(rawPrefix)) continue
    if (!/^[0-9OQDILZS]{1,2}$/.test(rawNumber)) continue

    const prefix = getClosestPrefix(rawPrefix, allowedPrefixes)
    const number = repairNumber(rawNumber)

    if (prefix && isValidNumber(number)) found.push(`${prefix}${number}`)
  }

  return [...new Set(found.map(normalizeCode))]
    .filter(code => /^[A-Z]{3}[0-9]{1,2}$/.test(code))
    .filter(code => isValidNumber(code.replace(/^[A-Z]{3}/, '')))
}

function getWordText(word) {
  return String(word?.text || word?.symbol || '').trim()
}

function getWordMidY(word) {
  const box = word?.bbox || word

  const y0 = Number(box?.y0 ?? box?.top ?? 0)
  const y1 = Number(box?.y1 ?? box?.bottom ?? y0)

  return (y0 + y1) / 2
}

function readRowsFromOcrResult(result, rowH, rowCount) {
  const rows = Array.from({ length: rowCount }, () => ({
    text: '',
    confidenceSum: 0,
    confidenceCount: 0,
  }))

  const words = Array.isArray(result?.data?.words)
    ? result.data.words
    : []

  if (words.length) {
    words.forEach(word => {
      const text = getWordText(word)

      if (!text) return

      const midY = getWordMidY(word)
      const rowIndex = Math.max(0, Math.min(rowCount - 1, Math.floor(midY / rowH)))

      rows[rowIndex].text = `${rows[rowIndex].text} ${text}`.trim()

      const confidence = Number(word?.confidence ?? 0)

      if (Number.isFinite(confidence)) {
        rows[rowIndex].confidenceSum += confidence
        rows[rowIndex].confidenceCount += 1
      }
    })

    return rows.map(row => ({
      text: cleanOcrText(row.text),
      confidence: row.confidenceCount
        ? row.confidenceSum / row.confidenceCount
        : 0,
    }))
  }

  const allText = cleanOcrText(result?.data?.text || '')

  if (rowCount === 1) {
    return [{
      text: allText,
      confidence: Number(result?.data?.confidence ?? 0),
    }]
  }

  const lines = allText.split(/\s{2,}|\n/g).filter(Boolean)

  return rows.map((_, index) => ({
    text: lines[index] || '',
    confidence: Number(result?.data?.confidence ?? 0),
  }))
}

async function recognizeCandidatesBatch(recognize, bitmap, candidates) {
  if (!candidates.length) return []

  const { sheet, rowH, thumbs } = makeOcrBatchSheet(bitmap, candidates)
  const imageDataUrl = canvasToUrl(sheet)

  let result = null

  try {
    result = await recognize(imageDataUrl, 'eng', {
      rotateAuto: false,
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    })
  } catch (error) {
    console.warn('OCR batch failed:', error)
  }

  const rows = readRowsFromOcrResult(result, rowH, candidates.length)

  return candidates.map((candidate, index) => {
    const row = rows[index] || { text: '', confidence: 0 }
    const codes = extractCodesFromText(row.text, candidate)

    return {
      ...candidate,
      codes,
      ocrRawText: row.text,
      ocrConfidence: Number(row.confidence || result?.data?.confidence || 0),
      thumbUrl: thumbs[index],
    }
  })
}

function isLikelySingleImage(visualCandidates) {
  return visualCandidates.length <= 36
}

function pickOcrTargets(visualCandidates, fixedCandidates) {
  const likelySingle = isLikelySingleImage(visualCandidates)

  if (likelySingle) {
    return uniqueZones([
      ...fixedCandidates,
      ...visualCandidates.slice(0, 8),
    ]).slice(0, MAX_OCR_SINGLE)
  }

  return uniqueZones([
    ...visualCandidates,
  ]).slice(0, MAX_OCR_MULTI)
}

function buildDebugLabel(candidate, index, detection) {
  const meta = candidate.meta || {}
  const angle = normalizeAngle(candidate.angle || 0)
  const codes = candidate.codes || []
  const raw = cleanOcrText(candidate.ocrRawText || '')

  return [
    `ZONA ${index + 1}`,
    detection.mode,
    codes.length ? `CODIGO ${codes.join(',')}` : 'SIN CODIGO',
    candidate.kind || 'unknown',
    candidate.rotateThumb ? 'ROT' : '',
    candidate.forced ? 'FORCED' : '',
    `score ${Math.round(candidate.score || 0)}`,
    angle ? `ang ${angle}` : '',
    `x ${Math.round(candidate.x)}`,
    `y ${Math.round(candidate.y)}`,
    `w ${Math.round(candidate.width)}`,
    `h ${Math.round(candidate.height)}`,
    meta.ratio !== undefined ? `r ${meta.ratio}` : '',
    meta.coloredRatio !== undefined ? `color ${meta.coloredRatio}` : '',
    meta.avgChroma !== undefined ? `chroma ${meta.avgChroma}` : '',
    raw ? `raw ${raw}` : 'raw VACIO',
  ]
    .filter(Boolean)
    .join(' | ')
}

function buildReading(bitmap, candidate, index, detection) {
  const codes = candidate.codes || []
  const debugLabel = buildDebugLabel(candidate, index, detection)

  return {
    id: `candidate-${index}`,
    confidence: codes.length
      ? Math.max(50, Math.round(candidate.ocrConfidence || 0))
      : Math.max(1, 99 - index),
    rawText: codes.length ? codes.join(' ') : '',
    debugText: debugLabel,
    region: clampZone(bitmap, candidate),
    thumbUrl: candidate.thumbUrl || canvasToUrl(candidateToCanvas(bitmap, candidate, 3)),
    manualCode: '',
  }
}

export async function analyzeStickerCodesFromImage(recognize, bitmap, stickers) {
  const normalizedBitmap = await normalizeBitmapForAnalysis(bitmap)

  const visualCandidates = detectVisualCandidates(normalizedBitmap)
  const fixedCandidates = makeFixedSingleFallbacks(normalizedBitmap)
  const ocrTargets = pickOcrTargets(visualCandidates, fixedCandidates)

  const enriched = await recognizeCandidatesBatch(
    recognize,
    normalizedBitmap,
    ocrTargets
  )

  const untouched = visualCandidates
    .filter(candidate => !ocrTargets.some(target => regionIoU(target, candidate) > 0.72))
    .slice(0, MAX_DEBUG_RESULTS)
    .map(candidate => ({
      ...candidate,
      codes: [],
      ocrRawText: '',
      ocrConfidence: 0,
      thumbUrl: canvasToUrl(candidateToCanvas(normalizedBitmap, candidate, 3)),
    }))

  const sorted = [...enriched, ...untouched].sort((a, b) => {
    const aCode = a.codes?.length ? 1 : 0
    const bCode = b.codes?.length ? 1 : 0

    if (aCode !== bCode) return bCode - aCode

    const aForced = a.forced ? 1 : 0
    const bForced = b.forced ? 1 : 0

    if (aForced !== bForced) return bForced - aForced

    return b.score - a.score
  })

  const finalCandidates = sorted.slice(0, MAX_DEBUG_RESULTS)

  const detection = {
    mode: isLikelySingleImage(visualCandidates) ? 'SINGLE_BATCH_DEBUG' : 'MULTI_BATCH_DEBUG',
    visualCount: visualCandidates.length,
    fixedCount: fixedCandidates.length,
    ocrCount: ocrTargets.length,
  }

  if (DEBUG_DETECTOR) {
    console.log('DEBUG GRAY CODE OCR DETECTOR:', {
      mode: detection.mode,
      prefixes: VALID_PREFIXES,
      visualCount: visualCandidates.length,
      fixedCount: fixedCandidates.length,
      ocrCount: ocrTargets.length,
      detectedCodes: finalCandidates
        .filter(candidate => candidate.codes?.length)
        .map(candidate => candidate.codes)
        .flat(),
      candidates: finalCandidates.map(candidate => ({
        kind: candidate.kind,
        allowedPrefixes: getAllowedPrefixes(candidate),
        codes: candidate.codes,
        raw: cleanOcrText(candidate.ocrRawText),
        confidence: candidate.ocrConfidence,
        score: candidate.score,
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height,
        rotated: Boolean(candidate.rotateThumb),
        forced: Boolean(candidate.forced),
        meta: candidate.meta,
      })),
    })
  }

  const readings = finalCandidates.map((candidate, index) =>
    buildReading(normalizedBitmap, candidate, index, detection)
  )

  const grouped = classifyZoneReadings(readings, stickers)

  return {
    grouped,
    regions: finalCandidates.map(candidate => ({
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
    })),
  }
}
