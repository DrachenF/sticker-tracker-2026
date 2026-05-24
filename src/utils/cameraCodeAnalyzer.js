import { classifyZoneReadings } from './ocrStickerCodes'

const DEBUG_DETECTOR = true

const MAX_VISUAL_CANDIDATES = 34
const MAX_PRIMARY_OCR = 8
const MAX_FALLBACK_OCR = 5
const MAX_DEBUG_RESULTS = 22

const VALID_PREFIXES = [
  'FWC',
  'MEX', 'RSA', 'KOR', 'CZE', 'CAN', 'BIH', 'QAT', 'SUI', 'BRA', 'MAR', 'HAI',
  'SCO', 'USA', 'PAR', 'TUR', 'ARG', 'BOL', 'CHI', 'COL', 'ECU', 'PER', 'URU',
  'VEN', 'AUT', 'BEL', 'CRO', 'DEN', 'ENG', 'ESP', 'FRA', 'GER', 'HUN', 'ITA',
  'NED', 'POL', 'POR', 'ROU', 'SRB', 'SVK', 'UKR', 'CRC', 'GUA', 'HON', 'JAM',
  'PAN', 'SLV', 'ALG', 'BFA', 'CMR', 'CIV', 'EGY', 'GHA', 'MLI', 'NGA', 'SEN',
  'TUN', 'AUS', 'IRN', 'IRQ', 'JPN', 'KSA', 'UAE', 'UZB', 'NZL'
]

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
  'LOGOS'
]

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

function isReadableZone(bitmap, zone) {
  const safe = clampZone(bitmap, zone)
  return safe.width >= 18 && safe.height >= 8
}

function expandZone(bitmap, zone, amountX = 0.10, amountY = 0.18) {
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
    gray: Math.round((r * 0.299) + (g * 0.587) + (b * 0.114)),
    chroma: max - min,
  }
}

function getComponentAngle(component) {
  const count = Math.max(1, component.count || 1)

  const meanX = component.sumX / count
  const meanY = component.sumY / count

  const covXX = (component.sumXX / count) - meanX * meanX
  const covYY = (component.sumYY / count) - meanY * meanY
  const covXY = (component.sumXY / count) - meanX * meanY

  if (!Number.isFinite(covXX) || !Number.isFinite(covYY) || !Number.isFinite(covXY)) {
    return 0
  }

  const angleRad = 0.5 * Math.atan2(2 * covXY, covXX - covYY)
  const angleDeg = (angleRad * 180) / Math.PI

  return normalizeAngle(angleDeg)
}

function createMaskClassifier(kind) {
  if (kind === 'light-pill') {
    return ({ gray, chroma }) => (
      gray >= 128 &&
      gray <= 255 &&
      chroma <= 78
    )
  }

  if (kind === 'dark-label') {
    return ({ gray, chroma }) => (
      gray >= 38 &&
      gray <= 188 &&
      chroma <= 78
    )
  }

  if (kind === 'neutral-panel') {
    return ({ gray, chroma }) => (
      gray >= 74 &&
      gray <= 236 &&
      chroma <= 84
    )
  }

  return () => false
}

function measureZoneStats(bitmap, zone) {
  const safe = clampZone(bitmap, zone)

  const maxW = 140
  const scale = Math.min(1, maxW / safe.width)

  const w = Math.max(1, Math.floor(safe.width * scale))
  const h = Math.max(1, Math.floor(safe.height * scale))

  const c = document.createElement('canvas')
  c.width = w
  c.height = h

  const ctx = c.getContext('2d')

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
    const gray = Math.round((r * 0.299) + (g * 0.587) + (b * 0.114))

    grays.push(gray)
    sumGray += gray
    sumChroma += chroma

    if (chroma >= 82) coloredCount += 1
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

function scoreCandidate(bitmap, zone, kind, componentMeta = {}) {
  const safe = clampZone(bitmap, zone)
  const stats = measureZoneStats(bitmap, safe)
  const ratio = safe.width / Math.max(1, safe.height)

  let score = 0

  if (ratio >= 1.25 && ratio <= 10.8) score += 36
  if (ratio >= 1.8 && ratio <= 7.0) score += 42
  if (ratio >= 2.4 && ratio <= 5.8) score += 18

  if (stats.coloredRatio <= 0.10) score += 70
  else if (stats.coloredRatio <= 0.16) score += 42
  else if (stats.coloredRatio <= 0.24) score += 12
  else score -= 170

  if (stats.avgChroma <= 48) score += 48
  else if (stats.avgChroma <= 68) score += 24
  else if (stats.avgChroma <= 86) score -= 35
  else score -= 160

  if (stats.stdGray >= 7 && stats.stdGray <= 105) score += 28
  if (stats.edgeRatio >= 0.010 && stats.edgeRatio <= 0.70) score += 34
  if (stats.edgeRatio < 0.008) score -= 90
  if (stats.stdGray < 6) score -= 70

  if (kind.includes('light')) {
    if (stats.avgGray >= 120) score += 30
    if (stats.brightRatio >= 0.18) score += 18
  }

  if (kind.includes('dark')) {
    if (stats.avgGray >= 38 && stats.avgGray <= 190) score += 30
    if (stats.darkRatio >= 0.05 || stats.brightRatio >= 0.05) score += 18
  }

  if (componentMeta.fillRatio >= 0.14 && componentMeta.fillRatio <= 0.96) {
    score += 20
  }

  if (stats.coloredRatio >= 0.30) score -= 240
  if (stats.avgChroma >= 105) score -= 240
  if (ratio < 0.85 || ratio > 13.5) score -= 150

  return {
    score: Math.round(score),
    stats,
    ratio: Number(ratio.toFixed(2)),
  }
}

function componentToCandidates(bitmap, component, scale, kind, imageArea) {
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
  if (originalW > bitmap.width * 0.42) return []
  if (originalH > bitmap.height * 0.18) return []
  if (ratio < 0.85 || ratio > 12.5) return []
  if (fillRatio < 0.10) return []

  const areaRatio = (originalW * originalH) / Math.max(1, imageArea)

  if (areaRatio < 0.000035 || areaRatio > 0.060) return []

  const base = clampZone(bitmap, {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  })

  const angle = normalizeAngle(getComponentAngle(component))
  const type = kind === 'light-pill' ? 'light' : kind === 'dark-label' ? 'dark' : 'neutral'

  const variants = [
    {
      ...expandZone(bitmap, base, 0.12, 0.25),
      kind: `box-${type}-tight`,
      score: type === 'light' ? 760 : type === 'dark' ? 740 : 700,
    },
    {
      ...expandZone(bitmap, base, 0.26, 0.34),
      kind: `box-${type}-medium`,
      score: type === 'light' ? 720 : type === 'dark' ? 705 : 665,
    },
    {
      ...clampZone(bitmap, {
        ...base,
        x: base.x - Math.floor(base.width * 0.45),
        y: base.y - Math.floor(base.height * 0.42),
        width: base.width + Math.floor(base.width * 1.75),
        height: base.height + Math.floor(base.height * 0.84),
      }),
      kind: `box-${type}-wide`,
      score: type === 'light' ? 680 : type === 'dark' ? 675 : 630,
    },
  ]

  return variants
    .map(candidate => {
      const visual = scoreCandidate(bitmap, candidate, candidate.kind, {
        fillRatio,
      })

      if (visual.score < 20) return null

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
          area: Number(areaRatio.toFixed(4)),
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

  const c = document.createElement('canvas')
  c.width = w
  c.height = h

  const ctx = c.getContext('2d')
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

      const candidates = componentToCandidates(bitmap, component, scale, kind, imageArea)

      candidates.forEach(candidate => {
        if (candidate && isReadableZone(bitmap, candidate)) {
          results.push(candidate)
        }
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
  const union = (a.width * a.height) + (b.width * b.height) - intersection

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

  return angle >= 7 && angle <= 30
}

function addRotatedCopies(candidates) {
  const copies = []

  candidates.forEach(candidate => {
    if (!shouldAddRotatedCopy(candidate)) return

    copies.push({
      ...candidate,
      kind: `${candidate.kind}-ROT`,
      rotateThumb: true,
      score: candidate.score + 85,
      angle: normalizeAngle(candidate.angle || 0),
    })
  })

  return copies
}

function makeFixedSingleFallbacks(bitmap) {
  const { width, height } = bitmap

  return [
    {
      x: Math.floor(width * 0.590),
      y: Math.floor(height * 0.295),
      width: Math.floor(width * 0.340),
      height: Math.floor(height * 0.115),
      kind: 'fixed-single-fwc-wide',
      score: 1900,
      allowedPrefixes: ['FWC'],
    },
    {
      x: Math.floor(width * 0.625),
      y: Math.floor(height * 0.307),
      width: Math.floor(width * 0.285),
      height: Math.floor(height * 0.090),
      kind: 'fixed-single-fwc-tight',
      score: 1860,
      allowedPrefixes: ['FWC'],
    },
    {
      x: Math.floor(width * 0.540),
      y: Math.floor(height * 0.280),
      width: Math.floor(width * 0.420),
      height: Math.floor(height * 0.145),
      kind: 'fixed-single-fwc-superwide',
      score: 1820,
      allowedPrefixes: ['FWC'],
    },
    {
      x: Math.floor(width * 0.585),
      y: Math.floor(height * 0.145),
      width: Math.floor(width * 0.330),
      height: Math.floor(height * 0.095),
      kind: 'fixed-single-arg-wide',
      score: 1900,
      allowedPrefixes: ['ARG'],
    },
    {
      x: Math.floor(width * 0.620),
      y: Math.floor(height * 0.155),
      width: Math.floor(width * 0.280),
      height: Math.floor(height * 0.078),
      kind: 'fixed-single-arg-tight',
      score: 1860,
      allowedPrefixes: ['ARG'],
    },
    {
      x: Math.floor(width * 0.545),
      y: Math.floor(height * 0.132),
      width: Math.floor(width * 0.400),
      height: Math.floor(height * 0.120),
      kind: 'fixed-single-arg-superwide',
      score: 1820,
      allowedPrefixes: ['ARG'],
    },
  ]
    .map(zone => {
      const safe = clampZone(bitmap, zone)
      const visual = scoreCandidate(
        bitmap,
        safe,
        zone.kind.includes('arg') ? 'fixed-dark' : 'fixed-light'
      )

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
          ...visual.stats,
        },
      }
    })
    .filter(zone => isReadableZone(bitmap, zone))
}

function filterVisualCandidate(candidate) {
  if (candidate.forced) return true

  const stats = candidate.meta || {}
  const ratio = candidate.width / Math.max(1, candidate.height)

  const coloredRatio = Number(stats.coloredRatio || 0)
  const avgChroma = Number(stats.avgChroma || 0)
  const edgeRatio = Number(stats.edgeRatio || 0)
  const stdGray = Number(stats.stdGray || 0)

  if (coloredRatio >= 0.26) return false
  if (avgChroma >= 96) return false
  if (edgeRatio < 0.006) return false
  if (stdGray < 5) return false
  if (ratio < 0.85 || ratio > 13.5) return false

  return true
}

function detectVisualCandidates(bitmap) {
  const lightCandidates = detectComponents(bitmap, 'light-pill').map(candidate => ({
    ...candidate,
    allowedPrefixes: ['FWC'],
  }))

  const darkCandidates = detectComponents(bitmap, 'dark-label').map(candidate => ({
    ...candidate,
    allowedPrefixes: VALID_PREFIXES.filter(prefix => prefix !== 'FWC'),
  }))

  const neutralCandidates = detectComponents(bitmap, 'neutral-panel').map(candidate => ({
    ...candidate,
    allowedPrefixes: VALID_PREFIXES,
  }))

  const detected = uniqueZones([
    ...lightCandidates,
    ...darkCandidates,
    ...neutralCandidates,
  ])
    .filter(filterVisualCandidate)

  const withRotation = uniqueZones([
    ...detected,
    ...addRotatedCopies(detected),
  ])

  return removeOverlappingRegions(withRotation, 0.52)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_VISUAL_CANDIDATES)
}

function makeNormalCanvas(bitmap, candidate, scale = 4) {
  const safe = clampZone(bitmap, candidate)

  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.floor(safe.width * scale))
  c.height = Math.max(1, Math.floor(safe.height * scale))

  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = false

  ctx.drawImage(
    bitmap,
    safe.x,
    safe.y,
    safe.width,
    safe.height,
    0,
    0,
    c.width,
    c.height
  )

  return c
}

function makeRotatedCanvas(bitmap, candidate, scale = 3.4) {
  const safe = clampZone(bitmap, candidate)
  const angle = normalizeAngle(candidate.angle || 0)

  if (!angle) return makeNormalCanvas(bitmap, candidate, scale)

  const padding = Math.ceil(Math.max(safe.width, safe.height) * 0.34)
  const sourceX = Math.max(0, safe.x - padding)
  const sourceY = Math.max(0, safe.y - padding)
  const sourceW = Math.min(safe.width + padding * 2, bitmap.width - sourceX)
  const sourceH = Math.min(safe.height + padding * 2, bitmap.height - sourceY)

  const diagonal = Math.ceil(Math.sqrt(sourceW * sourceW + sourceH * sourceH))

  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.floor(diagonal * scale))
  c.height = Math.max(1, Math.floor(diagonal * scale))

  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.imageSmoothingEnabled = false

  ctx.translate(c.width / 2, c.height / 2)
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

  return c
}

function canvasToUrl(canvas) {
  return canvas.toDataURL('image/jpeg', 0.94)
}

function candidateToCanvas(bitmap, candidate, scale = 4) {
  return candidate.rotateThumb
    ? makeRotatedCanvas(bitmap, candidate, scale)
    : makeNormalCanvas(bitmap, candidate, scale)
}

function preprocessCanvasForOcr(canvas, mode = 'normal') {
  const c = document.createElement('canvas')
  c.width = canvas.width
  c.height = canvas.height

  const ctx = c.getContext('2d')
  ctx.drawImage(canvas, 0, 0)

  const imageData = ctx.getImageData(0, 0, c.width, c.height)
  const data = imageData.data

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    let gray = Math.round((r * 0.299) + (g * 0.587) + (b * 0.114))

    if (mode === 'contrast') {
      gray = Math.round((gray - 128) * 1.85 + 128)
    }

    if (mode === 'binary') {
      gray = gray >= 142 ? 255 : 0
    }

    gray = Math.max(0, Math.min(255, gray))

    data[i] = gray
    data[i + 1] = gray
    data[i + 2] = gray
  }

  ctx.putImageData(imageData, 0, 0)

  return c
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
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function repairNumber(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[OQD]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[ZS]/g, '2')
    .replace(/[^0-9]/g, '')
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

function getAllowedPrefixes(candidate) {
  const kind = String(candidate.kind || '').toLowerCase()

  if (Array.isArray(candidate.allowedPrefixes) && candidate.allowedPrefixes.length) {
    return candidate.allowedPrefixes
  }

  if (kind.includes('fixed-single-fwc')) return ['FWC']
  if (kind.includes('fixed-single-arg')) return ['ARG']
  if (kind.includes('box-light')) return ['FWC']

  if (kind.includes('box-dark')) {
    return VALID_PREFIXES.filter(prefix => prefix !== 'FWC')
  }

  return VALID_PREFIXES
}

function extractExactCodes(cleanText, candidate) {
  const allowedPrefixes = getAllowedPrefixes(candidate)
  const prefixPart = allowedPrefixes.join('|')
  const found = []
  const joined = cleanText.replace(/\s+/g, '')

  const spacedRegex = new RegExp(`\\b(${prefixPart})\\s*([0-9OQDILZS]{1,2})\\b`, 'g')
  let spacedMatch = spacedRegex.exec(cleanText)

  while (spacedMatch) {
    const prefix = spacedMatch[1]
    const number = repairNumber(spacedMatch[2])

    if (isValidNumber(number)) found.push(`${prefix}${number}`)

    spacedMatch = spacedRegex.exec(cleanText)
  }

  const joinedRegex = new RegExp(`(${prefixPart})([0-9OQDILZS]{1,2})`, 'g')
  let joinedMatch = joinedRegex.exec(joined)

  while (joinedMatch) {
    const prefix = joinedMatch[1]
    const number = repairNumber(joinedMatch[2])

    if (isValidNumber(number)) found.push(`${prefix}${number}`)

    joinedMatch = joinedRegex.exec(joined)
  }

  return found
}

function extractControlledFuzzyCodes(cleanText, candidate) {
  const allowedPrefixes = getAllowedPrefixes(candidate)
  const joined = cleanText.replace(/\s+/g, '')
  const stopWordCount = countStopWords(cleanText)
  const found = []

  const canUseLooseNumber = stopWordCount <= 1 || candidate.forced

  if (allowedPrefixes.includes('FWC')) {
    const fwcRegexes = [
      /(?:FWC|FWG|FVC|FIC|FVG|FNC|FVV|WC)([0-9OQDILZS]{1,2})/,
      /(?:FWC|FWG|FVC|FIC|FVG|FNC|FVV)\s+([0-9OQDILZS]{1,2})/,
    ]

    fwcRegexes.forEach(regex => {
      const match = cleanText.match(regex) || joined.match(regex)
      const number = repairNumber(match?.[1] || '')

      if (isValidNumber(number)) found.push(`FWC${number}`)
    })

    if (canUseLooseNumber) {
      const tokenNumber = extractLooseTokenNumber(cleanText)

      if (isValidNumber(tokenNumber)) found.push(`FWC${tokenNumber}`)
    }
  }

  if (allowedPrefixes.includes('ARG')) {
    const argRegexes = [
      /(?:ARG|ABG|AKG|ARC|RG|AG)([0-9OQDILZS]{1,2})/,
      /(?:ARG|ABG|AKG|ARC|RG|AG)\s+([0-9OQDILZS]{1,2})/,
    ]

    argRegexes.forEach(regex => {
      const match = cleanText.match(regex) || joined.match(regex)
      const number = repairNumber(match?.[1] || '')

      if (isValidNumber(number)) found.push(`ARG${number}`)
    })

    if (candidate.forced && canUseLooseNumber) {
      const tokenNumber = extractLooseTokenNumber(cleanText)

      if (isValidNumber(tokenNumber)) found.push(`ARG${tokenNumber}`)
    }
  }

  if (allowedPrefixes.includes('PAR')) {
    const parRegexes = [
      /(?:PAR|P4R|FAR|PAB|P4B)([0-9OQDILZS]{1,2})/,
      /(?:PAR|P4R|FAR|PAB|P4B)\s+([0-9OQDILZS]{1,2})/,
    ]

    parRegexes.forEach(regex => {
      const match = cleanText.match(regex) || joined.match(regex)
      const number = repairNumber(match?.[1] || '')

      if (isValidNumber(number)) found.push(`PAR${number}`)
    })
  }

  return found
}

function extractLooseTokenNumber(cleanText) {
  const tokens = cleanText.split(/\s+/).filter(Boolean)

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]

    const joinedMatch = token.match(/^[A-Z]{2,4}([0-9OQDILZS]{1,2})$/)
    if (joinedMatch) {
      const number = repairNumber(joinedMatch[1])
      if (isValidNumber(number)) return number
    }

    const numberOnly = token.match(/^[0-9OQDILZS]{1,2}$/)
    if (numberOnly) {
      const previous = tokens[i - 1] || ''
      const number = repairNumber(token)

      if (isValidNumber(number) && /^[A-Z]{2,4}$/.test(previous)) {
        return number
      }
    }
  }

  return ''
}

function extractCodesFromText(text, candidate) {
  const clean = cleanOcrText(text)

  if (!clean) return []

  const exact = extractExactCodes(clean, candidate)
  const fuzzy = exact.length ? [] : extractControlledFuzzyCodes(clean, candidate)

  return [...new Set([...exact, ...fuzzy].map(normalizeCode))]
    .filter(code => /^[A-Z]{3}[0-9]{1,2}$/.test(code))
    .filter(code => isValidNumber(code.replace(/^[A-Z]{3}/, '')))
}

async function recognizeCandidate(recognize, bitmap, candidate, index) {
  const originalCanvas = candidateToCanvas(bitmap, candidate, candidate.forced ? 5 : 4)

  const modes = candidate.forced || index < 4
    ? ['contrast', 'normal']
    : ['contrast']

  let best = {
    codes: [],
    rawText: '',
    confidence: 0,
    thumbUrl: canvasToUrl(originalCanvas),
  }

  for (let i = 0; i < modes.length; i += 1) {
    const processedCanvas = preprocessCanvasForOcr(originalCanvas, modes[i])
    const imageDataUrl = canvasToUrl(processedCanvas)

    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await recognize(imageDataUrl, 'eng', {
        rotateAuto: false,
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
        tessedit_pageseg_mode: '7',
      })

      const rawText = String(result?.data?.text || '')
      const confidence = Number(result?.data?.confidence ?? 0)
      const codes = extractCodesFromText(rawText, candidate)

      if (
        codes.length > best.codes.length ||
        (codes.length === best.codes.length && confidence > best.confidence)
      ) {
        best = {
          codes,
          rawText,
          confidence,
          thumbUrl: canvasToUrl(originalCanvas),
        }
      }

      if (codes.length) break
    } catch (error) {
      console.warn('OCR candidate failed:', error)
    }
  }

  return best
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
    raw ? `raw ${raw}` : '',
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

function pickOcrTargets(visualCandidates, fixedCandidates) {
  const primary = visualCandidates.slice(0, MAX_PRIMARY_OCR)

  return uniqueZones([
    ...primary,
    ...fixedCandidates.slice(0, MAX_FALLBACK_OCR),
  ]).slice(0, MAX_PRIMARY_OCR + MAX_FALLBACK_OCR)
}

export async function analyzeStickerCodesFromImage(recognize, bitmap, stickers) {
  const visualCandidates = detectVisualCandidates(bitmap)
  const fixedCandidates = makeFixedSingleFallbacks(bitmap)

  const ocrTargets = pickOcrTargets(visualCandidates, fixedCandidates)
  const enriched = []

  for (let i = 0; i < ocrTargets.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const ocr = await recognizeCandidate(recognize, bitmap, ocrTargets[i], i)

    enriched.push({
      ...ocrTargets[i],
      codes: ocr.codes,
      ocrRawText: ocr.rawText,
      ocrConfidence: ocr.confidence,
      thumbUrl: ocr.thumbUrl,
    })
  }

  const untouched = visualCandidates
    .filter(candidate => !ocrTargets.some(target => regionIoU(target, candidate) > 0.72))
    .slice(0, MAX_DEBUG_RESULTS)
    .map(candidate => ({
      ...candidate,
      codes: [],
      ocrRawText: '',
      ocrConfidence: 0,
      thumbUrl: canvasToUrl(candidateToCanvas(bitmap, candidate, 3)),
    }))

  const sorted = [
    ...enriched,
    ...untouched,
  ].sort((a, b) => {
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
    mode: 'DEBUG',
    visualCount: visualCandidates.length,
    ocrCount: ocrTargets.length,
  }

  if (DEBUG_DETECTOR) {
    console.log('DEBUG STRICT PREFIX OCR DETECTOR:', {
      visualCount: visualCandidates.length,
      fixedCount: fixedCandidates.length,
      ocrCount: ocrTargets.length,
      candidates: finalCandidates.map(candidate => ({
        kind: candidate.kind,
        allowedPrefixes: getAllowedPrefixes(candidate),
        codes: candidate.codes,
        raw: candidate.ocrRawText,
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
    buildReading(bitmap, candidate, index, detection)
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
