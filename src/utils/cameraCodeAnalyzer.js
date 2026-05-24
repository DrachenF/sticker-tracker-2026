import { classifyZoneReadings } from './ocrStickerCodes'

const DEBUG_DETECTOR = true

const MAX_SINGLE_CANDIDATES = 10
const MAX_MULTI_CANDIDATES = 22

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
  let safeAngle = Number(angle || 0)

  while (safeAngle > 45) safeAngle -= 90
  while (safeAngle < -45) safeAngle += 90

  if (Math.abs(safeAngle) < 4) return 0

  return Number(safeAngle.toFixed(1))
}

function shouldRotate(angle) {
  const safe = Math.abs(normalizeAngle(angle))
  return safe >= 6 && safe <= 28
}

function isReadableZone(bitmap, zone) {
  const safe = clampZone(bitmap, zone)
  return safe.width >= 20 && safe.height >= 8
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

function expandRightZone(bitmap, zone, kind) {
  const safe = clampZone(bitmap, zone)

  const leftExtra = Math.floor(safe.width * 0.35)
  const rightExtra = Math.floor(safe.width * 1.15)
  const topExtra = Math.floor(safe.height * 0.35)
  const bottomExtra = Math.floor(safe.height * 0.35)

  return clampZone(bitmap, {
    ...safe,
    kind,
    x: safe.x - leftExtra,
    y: safe.y - topExtra,
    width: safe.width + leftExtra + rightExtra,
    height: safe.height + topExtra + bottomExtra,
  })
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

function removeOverlappingRegions(regions, maxOverlap = 0.54) {
  const sorted = [...regions].sort((a, b) => b.score - a.score)
  const kept = []

  sorted.forEach(region => {
    const overlaps = kept.some(existing => {
      if (existing.rotateThumb !== region.rotateThumb) return false
      return regionIoU(existing, region) > maxOverlap
    })

    if (!overlaps) {
      kept.push(region)
    }
  })

  return kept
}

function getPixelInfo(data, index) {
  const i = index * 4
  const r = data[i]
  const g = data[i + 1]
  const b = data[i + 2]

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)

  return {
    gray: Math.round((r * 0.299) + (g * 0.587) + (b * 0.114)),
    chroma: max - min,
  }
}

function createMaskClassifier(kind) {
  if (kind === 'light-pill') {
    // Cápsula clara: FWC2 / FWC3.
    return ({ gray, chroma }) => (
      gray >= 135 &&
      gray <= 255 &&
      chroma <= 75
    )
  }

  if (kind === 'dark-pill') {
    // Cajita oscura: ARG17 / PAR1.
    return ({ gray, chroma }) => (
      gray >= 45 &&
      gray <= 175 &&
      chroma <= 70
    )
  }

  return () => false
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

    if (chroma >= 80) coloredCount += 1
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

  // La etiqueta real casi siempre es horizontal y pequeña.
  if (ratio >= 1.4 && ratio <= 8.8) score += 35
  if (ratio >= 2.0 && ratio <= 6.2) score += 35

  // Debe tener algo de contraste de letras.
  if (stats.stdGray >= 8 && stats.stdGray <= 90) score += 25
  if (stats.edgeRatio >= 0.018 && stats.edgeRatio <= 0.65) score += 32

  // Debe ser gris/blanco, no flor/mantel.
  if (stats.coloredRatio <= 0.20) score += 45
  if (stats.avgChroma <= 60) score += 30

  if (kind.includes('light')) {
    if (stats.avgGray >= 125) score += 35
    if (stats.brightRatio >= 0.20) score += 20
  }

  if (kind.includes('dark')) {
    if (stats.avgGray >= 45 && stats.avgGray <= 180) score += 35
    if (stats.darkRatio >= 0.10 || stats.brightRatio >= 0.08) score += 18
  }

  // Penalizaciones agresivas contra fondo.
  if (stats.coloredRatio >= 0.32) score -= 120
  if (stats.avgChroma >= 95) score -= 90
  if (stats.edgeRatio < 0.010) score -= 70
  if (ratio < 1.0 || ratio > 11.5) score -= 80

  // Si el componente original era sólido tipo cápsula, suma.
  if (componentMeta.fillRatio >= 0.30 && componentMeta.fillRatio <= 0.95) {
    score += 25
  }

  return {
    score: Math.round(score),
    stats,
    ratio: Number(ratio.toFixed(2)),
  }
}

function componentToLabelCandidates(bitmap, component, scale, kind, imageArea) {
  const boxW = component.maxX - component.minX + 1
  const boxH = component.maxY - component.minY + 1
  const area = boxW * boxH
  const fillRatio = component.count / Math.max(1, area)
  const ratio = boxW / Math.max(1, boxH)

  const originalX = Math.floor(component.minX / scale)
  const originalY = Math.floor(component.minY / scale)
  const originalW = Math.floor(boxW / scale)
  const originalH = Math.floor(boxH / scale)

  if (originalW < 24 || originalH < 9) return []
  if (originalW > bitmap.width * 0.36) return []
  if (originalH > bitmap.height * 0.16) return []

  if (ratio < 1.1 || ratio > 10.5) return []
  if (fillRatio < 0.18) return []

  const imageAreaRatio = (originalW * originalH) / Math.max(1, imageArea)

  if (imageAreaRatio < 0.00006 || imageAreaRatio > 0.050) return []

  const base = {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  }

  const angle = getComponentAngle(component)

  const type = kind === 'light-pill' ? 'light' : 'dark'

  const tight = expandZone(bitmap, base, 0.16, 0.30)
  const wide = expandRightZone(bitmap, base, `pill-${type}-wide`)

  const variants = [
    {
      ...tight,
      kind: `pill-${type}-tight`,
      angle,
      rotateThumb: false,
      baseScore: kind === 'light-pill' ? 460 : 440,
    },
    {
      ...wide,
      kind: `pill-${type}-wide`,
      angle,
      rotateThumb: false,
      baseScore: kind === 'light-pill' ? 430 : 420,
    },
  ]

  return variants
    .map(candidate => {
      const visual = scoreCandidate(bitmap, candidate, candidate.kind, {
        fillRatio,
      })

      if (visual.score < 40) return null

      return {
        ...candidate,
        score: candidate.baseScore + visual.score,
        meta: {
          ratio: Number(ratio.toFixed(2)),
          fillRatio: Number(fillRatio.toFixed(2)),
          area: Number(imageAreaRatio.toFixed(4)),
          visual: visual.score,
          angle,
          ...visual.stats,
        },
      }
    })
    .filter(Boolean)
}

function detectLabelComponents(bitmap, kind) {
  const maxW = 900
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

      const candidates = componentToLabelCandidates(bitmap, component, scale, kind, imageArea)

      candidates.forEach(candidate => {
        if (candidate && isReadableZone(bitmap, candidate)) {
          results.push(candidate)
        }
      })
    }
  }

  return results
}

function detectLikelyMultiple(labelCandidates, bitmap) {
  const good = labelCandidates.filter(candidate => {
    const stats = candidate.meta || {}
    const area = (candidate.width * candidate.height) / Math.max(1, bitmap.width * bitmap.height)

    return (
      candidate.score >= 520 &&
      Number(stats.coloredRatio || 0) <= 0.26 &&
      area <= 0.035
    )
  })

  return good.length >= 6
}

function addSinglePhotoBackups(bitmap) {
  const { width, height } = bitmap

  const backups = [
    // FWC2 horizontal: estas son intencionalmente más precisas.
    {
      x: Math.floor(width * 0.610),
      y: Math.floor(height * 0.318),
      width: Math.floor(width * 0.295),
      height: Math.floor(height * 0.078),
      kind: 'single-fwc-exact',
      score: 1400,
      forced: true,
      rotateThumb: false,
      angle: 0,
    },
    {
      x: Math.floor(width * 0.575),
      y: Math.floor(height * 0.298),
      width: Math.floor(width * 0.355),
      height: Math.floor(height * 0.112),
      kind: 'single-fwc-wide',
      score: 1320,
      forced: true,
      rotateThumb: false,
      angle: 0,
    },

    // ARG17 vertical.
    {
      x: Math.floor(width * 0.605),
      y: Math.floor(height * 0.138),
      width: Math.floor(width * 0.285),
      height: Math.floor(height * 0.082),
      kind: 'single-arg-exact',
      score: 1400,
      forced: true,
      rotateThumb: false,
      angle: 0,
    },
    {
      x: Math.floor(width * 0.555),
      y: Math.floor(height * 0.108),
      width: Math.floor(width * 0.360),
      height: Math.floor(height * 0.125),
      kind: 'single-arg-wide',
      score: 1320,
      forced: true,
      rotateThumb: false,
      angle: 0,
    },
  ]

  return backups
    .filter(region => isReadableZone(bitmap, region))
    .map(region => {
      const visual = scoreCandidate(bitmap, region, region.kind.includes('arg') ? 'dark' : 'light')

      return {
        ...region,
        score: region.score + visual.score,
        meta: {
          visual: visual.score,
          ratio: visual.ratio,
          ...visual.stats,
        },
      }
    })
}

function addRotatedCopies(candidates) {
  const copies = []

  candidates.forEach(candidate => {
    const angle = normalizeAngle(candidate.angle || 0)

    if (!shouldRotate(angle)) return
    if (candidate.forced) return

    copies.push({
      ...candidate,
      kind: `${candidate.kind}-ROT`,
      rotateThumb: true,
      angle,
      score: candidate.score + 90,
    })
  })

  return copies
}

function filterNoise(candidate) {
  if (candidate.forced) return true

  const stats = candidate.meta || {}
  const ratio = candidate.width / Math.max(1, candidate.height)

  if (Number(stats.coloredRatio || 0) >= 0.42) return false
  if (Number(stats.avgChroma || 0) >= 95) return false
  if (Number(stats.edgeRatio || 0) < 0.006) return false
  if (ratio < 0.85 || ratio > 13.5) return false

  return true
}

function detectPreciseCodeCandidates(bitmap) {
  const lightLabels = detectLabelComponents(bitmap, 'light-pill')
  const darkLabels = detectLabelComponents(bitmap, 'dark-pill')

  const labelCandidates = uniqueZones([
    ...lightLabels,
    ...darkLabels,
  ])
    .filter(filterNoise)

  const likelyMultiple = detectLikelyMultiple(labelCandidates, bitmap)

  const baseCandidates = likelyMultiple
    ? labelCandidates
    : uniqueZones([
      ...addSinglePhotoBackups(bitmap),
      ...labelCandidates,
    ])

  const withRotation = likelyMultiple
    ? uniqueZones([
      ...baseCandidates,
      ...addRotatedCopies(baseCandidates),
    ])
    : baseCandidates

  const cleaned = removeOverlappingRegions(withRotation, likelyMultiple ? 0.48 : 0.56)
    .sort((a, b) => b.score - a.score)

  return {
    candidates: cleaned.slice(0, likelyMultiple ? MAX_MULTI_CANDIDATES : MAX_SINGLE_CANDIDATES),
    likelyMultiple,
  }
}

function makeNormalCanvas(bitmap, zone, scale = 2.6) {
  const safe = clampZone(bitmap, zone)

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

function makeRotatedCanvas(bitmap, zone, scale = 2.4) {
  const safe = clampZone(bitmap, zone)
  const angle = normalizeAngle(safe.angle || 0)

  if (!angle) return makeNormalCanvas(bitmap, safe, scale)

  const padding = Math.ceil(Math.max(safe.width, safe.height) * 0.32)
  const sourceX = Math.max(0, safe.x - padding)
  const sourceY = Math.max(0, safe.y - padding)
  const sourceW = Math.min(safe.width + padding * 2, bitmap.width - sourceX)
  const sourceH = Math.min(safe.height + padding * 2, bitmap.height - sourceY)

  const diagonal = Math.ceil(Math.sqrt(sourceW * sourceW + sourceH * sourceH))

  const c = document.createElement('canvas')
  c.width = diagonal * scale
  c.height = diagonal * scale

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

function workerCanvasToUrl(bitmap, candidate) {
  const canvas = candidate.rotateThumb
    ? makeRotatedCanvas(bitmap, candidate)
    : makeNormalCanvas(bitmap, candidate)

  return canvas.toDataURL('image/jpeg', 0.92)
}

function buildDebugReading(bitmap, candidate, index, likelyMultiple) {
  const safe = clampZone(bitmap, candidate)
  const meta = candidate.meta || {}
  const angle = normalizeAngle(candidate.angle || 0)

  const label = [
    `DBG${index + 1}`,
    likelyMultiple ? 'MULTI' : 'SINGLE',
    candidate.kind || 'unknown',
    candidate.rotateThumb ? 'ROT' : '',
    `score${Math.round(candidate.score || 0)}`,
    angle ? `ang${angle}` : '',
    `x${safe.x}`,
    `y${safe.y}`,
    `w${safe.width}`,
    `h${safe.height}`,
    meta.visual ? `v${meta.visual}` : '',
    meta.ratio ? `r${meta.ratio}` : '',
    meta.coloredRatio !== undefined ? `color${meta.coloredRatio}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    id: `debug-candidate-${index}`,
    confidence: Math.max(1, 99 - index),
    rawText: label,
    region: safe,
    thumbUrl: workerCanvasToUrl(bitmap, candidate),
    manualCode: '',
  }
}

export async function analyzeStickerCodesFromImage(recognize, bitmap, stickers) {
  const { candidates, likelyMultiple } = detectPreciseCodeCandidates(bitmap)

  if (DEBUG_DETECTOR) {
    console.log('DEBUG LAST BLOCK DETECTOR:', {
      likelyMultiple,
      count: candidates.length,
      candidates: candidates.map(candidate => ({
        kind: candidate.kind,
        score: candidate.score,
        x: candidate.x,
        y: candidate.y,
        width: candidate.width,
        height: candidate.height,
        angle: candidate.angle,
        rotated: Boolean(candidate.rotateThumb),
        meta: candidate.meta,
      })),
    })
  }

  const debugReadings = candidates.map((candidate, index) =>
    buildDebugReading(bitmap, candidate, index, likelyMultiple)
  )

  const grouped = classifyZoneReadings(debugReadings, stickers)

  return {
    grouped,
    regions: candidates.map(candidate => ({
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
    })),
  }
}
