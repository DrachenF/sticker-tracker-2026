import { classifyZoneReadings } from './ocrStickerCodes'

const DEBUG_DETECTOR = true

const MAX_DEBUG_CANDIDATES = 14

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
    x,
    y,
    width,
    height,
  }
}

function isReadableZone(bitmap, zone) {
  const safe = clampZone(bitmap, zone)
  return safe.width >= 20 && safe.height >= 8
}

function expandZone(bitmap, zone, amountX = 0.06, amountY = 0.10) {
  const safe = clampZone(bitmap, zone)

  const extraX = Math.floor(safe.width * amountX)
  const extraY = Math.floor(safe.height * amountY)

  return clampZone(bitmap, {
    x: safe.x - extraX,
    y: safe.y - extraY,
    width: safe.width + extraX * 2,
    height: safe.height + extraY * 2,
  })
}

function relativeZone(bitmap, parent, rx, ry, rw, rh) {
  return clampZone(bitmap, {
    x: Math.floor(parent.x + parent.width * rx),
    y: Math.floor(parent.y + parent.height * ry),
    width: Math.floor(parent.width * rw),
    height: Math.floor(parent.height * rh),
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

function removeOverlappingRegions(regions, maxOverlap = 0.45) {
  const sorted = [...regions].sort((a, b) => b.score - a.score)
  const kept = []

  sorted.forEach(region => {
    const overlaps = kept.some(existing => regionIoU(existing, region) > maxOverlap)

    if (!overlaps) {
      kept.push(region)
    }
  })

  return kept
}

function zoneCenter(zone) {
  return {
    x: zone.x + zone.width / 2,
    y: zone.y + zone.height / 2,
  }
}

function isInside(zone, container, paddingRatio = 0.04) {
  const c = zoneCenter(zone)
  const padX = container.width * paddingRatio
  const padY = container.height * paddingRatio

  return (
    c.x >= container.x - padX &&
    c.x <= container.x + container.width + padX &&
    c.y >= container.y - padY &&
    c.y <= container.y + container.height + padY
  )
}

function isTopRightOfBody(zone, body) {
  const c = zoneCenter(zone)

  const minX = body.x + body.width * 0.42
  const maxX = body.x + body.width * 1.04
  const minY = body.y - body.height * 0.04
  const maxY = body.y + body.height * 0.38

  return (
    c.x >= minX &&
    c.x <= maxX &&
    c.y >= minY &&
    c.y <= maxY
  )
}

function workerCanvasToUrl(bitmap, zone) {
  const safe = clampZone(bitmap, zone)

  const c = document.createElement('canvas')
  c.width = safe.width
  c.height = safe.height

  const ctx = c.getContext('2d')

  ctx.drawImage(
    bitmap,
    safe.x,
    safe.y,
    safe.width,
    safe.height,
    0,
    0,
    safe.width,
    safe.height
  )

  return c.toDataURL('image/jpeg', 0.92)
}

function getPixelInfo(data, index) {
  const i = index * 4
  const r = data[i]
  const g = data[i + 1]
  const b = data[i + 2]

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const gray = Math.round((r * 0.299) + (g * 0.587) + (b * 0.114))
  const chroma = max - min

  return {
    gray,
    chroma,
  }
}

function createMaskClassifier(kind) {
  if (kind === 'sticker-body') {
    return ({ gray, chroma }) => (
      gray >= 92 &&
      gray <= 246 &&
      chroma <= 92
    )
  }

  if (kind === 'light-label') {
    return ({ gray, chroma }) => (
      gray >= 135 &&
      gray <= 255 &&
      chroma <= 78
    )
  }

  if (kind === 'dark-label') {
    return ({ gray, chroma }) => (
      gray >= 45 &&
      gray <= 185 &&
      chroma <= 70
    )
  }

  return () => false
}

function measureZoneStats(bitmap, zone) {
  const safe = clampZone(bitmap, zone)

  const maxW = 120
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
  let darkCount = 0
  let brightCount = 0
  let coloredCount = 0

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const gray = Math.round((r * 0.299) + (g * 0.587) + (b * 0.114))
    const chroma = max - min

    grays.push(gray)
    sumGray += gray
    sumChroma += chroma

    if (gray <= 95) darkCount += 1
    if (gray >= 165) brightCount += 1
    if (chroma >= 80) coloredCount += 1
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

      if (Math.abs(current - previous) >= 22) {
        edgeCount += 1
      }

      comparisons += 1
    }
  }

  return {
    avgGray: Number(avgGray.toFixed(1)),
    avgChroma: Number(avgChroma.toFixed(1)),
    stdGray: Number(stdGray.toFixed(1)),
    darkRatio: Number((darkCount / count).toFixed(3)),
    brightRatio: Number((brightCount / count).toFixed(3)),
    coloredRatio: Number((coloredCount / count).toFixed(3)),
    edgeRatio: Number((edgeCount / Math.max(1, comparisons)).toFixed(3)),
  }
}

function scoreVisualQuality(bitmap, zone, kind) {
  const stats = measureZoneStats(bitmap, zone)
  const ratio = zone.width / Math.max(1, zone.height)

  let score = 0

  // Debe parecer etiqueta horizontal.
  if (ratio >= 1.4 && ratio <= 7.8) score += 35
  if (ratio >= 2.0 && ratio <= 5.8) score += 25

  // Debe tener algo de contraste interno, porque hay letras.
  if (stats.stdGray >= 10 && stats.stdGray <= 80) score += 25
  if (stats.edgeRatio >= 0.08 && stats.edgeRatio <= 0.55) score += 30

  // Evita flores/mantel por color.
  if (stats.coloredRatio <= 0.18) score += 25
  if (stats.avgChroma <= 62) score += 20

  if (kind.includes('light')) {
    if (stats.avgGray >= 120) score += 20
    if (stats.brightRatio >= 0.25) score += 12
  }

  if (kind.includes('dark')) {
    if (stats.avgGray >= 45 && stats.avgGray <= 178) score += 20
    if (stats.darkRatio >= 0.12 || stats.brightRatio >= 0.10) score += 12
  }

  // Penalizaciones fuertes.
  if (stats.coloredRatio >= 0.32) score -= 80
  if (stats.edgeRatio < 0.025) score -= 45
  if (ratio < 1.0 || ratio > 10.5) score -= 60

  return {
    score: Math.round(score),
    stats,
    ratio: Number(ratio.toFixed(2)),
  }
}

function componentToStickerBody(bitmap, component, scale, imageArea) {
  const boxW = component.maxX - component.minX + 1
  const boxH = component.maxY - component.minY + 1
  const area = boxW * boxH
  const fillRatio = component.count / Math.max(1, area)

  const originalX = Math.floor(component.minX / scale)
  const originalY = Math.floor(component.minY / scale)
  const originalW = Math.floor(boxW / scale)
  const originalH = Math.floor(boxH / scale)

  const ratio = originalW / Math.max(1, originalH)
  const imageAreaRatio = (originalW * originalH) / Math.max(1, imageArea)

  if (originalW < bitmap.width * 0.13) return null
  if (originalH < bitmap.height * 0.08) return null
  if (originalW > bitmap.width * 0.96) return null
  if (originalH > bitmap.height * 0.96) return null

  if (ratio < 0.35 || ratio > 3.8) return null
  if (fillRatio < 0.16) return null
  if (imageAreaRatio < 0.018 || imageAreaRatio > 0.72) return null

  const base = {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  }

  const expanded = expandZone(bitmap, base, 0.01, 0.01)

  let score = 120

  score += Math.min(55, imageAreaRatio * 220)
  score += Math.min(35, fillRatio * 40)
  score -= Math.abs(ratio - 1.45) * 7

  return {
    ...expanded,
    kind: 'sticker-body',
    score: Math.round(score),
    meta: {
      ratio: Number(ratio.toFixed(2)),
      fillRatio: Number(fillRatio.toFixed(2)),
      area: Number(imageAreaRatio.toFixed(3)),
    },
  }
}

function componentToDirectLabel(bitmap, component, scale, kind, imageArea) {
  const boxW = component.maxX - component.minX + 1
  const boxH = component.maxY - component.minY + 1
  const area = boxW * boxH
  const fillRatio = component.count / Math.max(1, area)
  const ratio = boxW / Math.max(1, boxH)

  const originalX = Math.floor(component.minX / scale)
  const originalY = Math.floor(component.minY / scale)
  const originalW = Math.floor(boxW / scale)
  const originalH = Math.floor(boxH / scale)

  if (originalW < 22 || originalH < 8) return null
  if (originalW > bitmap.width * 0.34) return null
  if (originalH > bitmap.height * 0.13) return null

  if (ratio < 1.20 || ratio > 9.8) return null
  if (fillRatio < 0.22) return null

  const imageAreaRatio = (originalW * originalH) / Math.max(1, imageArea)

  if (imageAreaRatio < 0.00012 || imageAreaRatio > 0.040) return null

  const base = {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  }

  const expanded = kind === 'light-label'
    ? expandZone(bitmap, base, 0.07, 0.12)
    : expandZone(bitmap, base, 0.09, 0.14)

  const visual = scoreVisualQuality(bitmap, expanded, kind)

  if (visual.score < 25) return null

  let score = 210

  score += visual.score
  score += Math.min(35, fillRatio * 38)
  score -= Math.abs(ratio - 3.8) * 3

  if (kind === 'dark-label') score += 12
  if (kind === 'light-label') score += 8

  return {
    ...expanded,
    kind,
    score: Math.round(score),
    meta: {
      ratio: Number(ratio.toFixed(2)),
      fillRatio: Number(fillRatio.toFixed(2)),
      area: Number(imageAreaRatio.toFixed(4)),
      ...visual.stats,
      visual: visual.score,
    },
  }
}

function detectComponents(bitmap, kind) {
  const maxW = 760
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
  const results = []
  const imageArea = bitmap.width * bitmap.height

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

      while (stack.length) {
        const current = stack.pop()
        const cx = current % w
        const cy = Math.floor(current / w)

        count += 1

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
      }

      let candidate = null

      if (kind === 'sticker-body') {
        candidate = componentToStickerBody(bitmap, component, scale, imageArea)
      }

      if (kind === 'light-label' || kind === 'dark-label') {
        candidate = componentToDirectLabel(bitmap, component, scale, kind, imageArea)
      }

      if (candidate && isReadableZone(bitmap, candidate)) {
        results.push(candidate)
      }
    }
  }

  return results
}

function makeTopRightCandidatesFromBody(bitmap, body, index) {
  const zones = [
    {
      name: 'tight',
      x: 0.58,
      y: 0.020,
      w: 0.38,
      h: 0.130,
      score: 330,
    },
    {
      name: 'wide',
      x: 0.51,
      y: 0.005,
      w: 0.47,
      h: 0.175,
      score: 310,
    },
    {
      name: 'small',
      x: 0.62,
      y: 0.030,
      w: 0.31,
      h: 0.100,
      score: 315,
    },
  ]

  const candidates = []

  zones.forEach(zone => {
    const crop = expandZone(
      bitmap,
      relativeZone(bitmap, body, zone.x, zone.y, zone.w, zone.h),
      0.04,
      0.10
    )

    const darkVisual = scoreVisualQuality(bitmap, crop, 'dark-label')
    const lightVisual = scoreVisualQuality(bitmap, crop, 'light-label')

    if (darkVisual.score >= 20) {
      candidates.push({
        ...crop,
        kind: `body${index + 1}-${zone.name}-dark`,
        score: zone.score + Math.round(body.score || 0) + darkVisual.score,
        parentBody: body,
        meta: {
          ...darkVisual.stats,
          visual: darkVisual.score,
          ratio: darkVisual.ratio,
        },
      })
    }

    if (lightVisual.score >= 20) {
      candidates.push({
        ...crop,
        kind: `body${index + 1}-${zone.name}-light`,
        score: zone.score + Math.round(body.score || 0) + lightVisual.score - 8,
        parentBody: body,
        meta: {
          ...lightVisual.stats,
          visual: lightVisual.score,
          ratio: lightVisual.ratio,
        },
      })
    }
  })

  return candidates.filter(candidate => isReadableZone(bitmap, candidate))
}

function keepLabelsRelatedToBodies(labels, bodies) {
  if (!bodies.length) {
    return labels
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
  }

  return labels
    .map(label => {
      const body = bodies.find(candidateBody =>
        isInside(label, candidateBody, 0.08) &&
        isTopRightOfBody(label, candidateBody)
      )

      if (!body) return null

      return {
        ...label,
        kind: `direct-${label.kind}`,
        score: label.score + 220 + Math.round(body.score || 0),
        parentBody: body,
      }
    })
    .filter(Boolean)
}

function addSinglePhotoBackups(bitmap, bodies, directLabels) {
  const shouldUseBackups = bodies.length <= 3 && directLabels.length <= 8

  if (!shouldUseBackups) return []

  const { width, height } = bitmap

  const backups = [
    {
      x: Math.floor(width * 0.615),
      y: Math.floor(height * 0.315),
      width: Math.floor(width * 0.255),
      height: Math.floor(height * 0.065),
      kind: 'backup-single-fwc-tight',
      score: 410,
    },
    {
      x: Math.floor(width * 0.590),
      y: Math.floor(height * 0.125),
      width: Math.floor(width * 0.255),
      height: Math.floor(height * 0.085),
      kind: 'backup-single-arg-tight',
      score: 410,
    },
    {
      x: Math.floor(width * 0.555),
      y: Math.floor(height * 0.110),
      width: Math.floor(width * 0.330),
      height: Math.floor(height * 0.115),
      kind: 'backup-single-arg-wide',
      score: 385,
    },
    {
      x: Math.floor(width * 0.595),
      y: Math.floor(height * 0.300),
      width: Math.floor(width * 0.315),
      height: Math.floor(height * 0.095),
      kind: 'backup-single-fwc-wide',
      score: 385,
    },
  ]
    .filter(region => isReadableZone(bitmap, region))
    .map(region => {
      const visual = scoreVisualQuality(bitmap, region, region.kind.includes('arg') ? 'dark-label' : 'light-label')

      return {
        ...region,
        score: region.score + visual.score,
        meta: {
          ...visual.stats,
          visual: visual.score,
          ratio: visual.ratio,
        },
      }
    })
    .filter(region => Number(region.meta?.visual || 0) >= 18)

  return backups
}

function detectPreciseCodeCandidates(bitmap) {
  const rawBodies = detectComponents(bitmap, 'sticker-body')
  const bodies = removeOverlappingRegions(
    rawBodies.sort((a, b) => b.score - a.score),
    0.62
  ).slice(0, 12)

  const directLightLabels = detectComponents(bitmap, 'light-label')
  const directDarkLabels = detectComponents(bitmap, 'dark-label')

  const directLabels = keepLabelsRelatedToBodies(
    [
      ...directDarkLabels,
      ...directLightLabels,
    ],
    bodies
  )

  const bodyCornerCandidates = bodies.flatMap((body, index) =>
    makeTopRightCandidatesFromBody(bitmap, body, index)
  )

  const backups = addSinglePhotoBackups(bitmap, bodies, directLabels)

  let candidates = uniqueZones([
    ...directLabels,
    ...bodyCornerCandidates,
    ...backups,
  ])
    .filter(candidate => isReadableZone(bitmap, candidate))

  candidates = candidates.filter(candidate => {
    const stats = candidate.meta || measureZoneStats(bitmap, candidate)

    if (Number(stats.coloredRatio || 0) >= 0.35) return false
    if (Number(stats.edgeRatio || 0) < 0.02) return false

    return true
  })

  candidates = removeOverlappingRegions(candidates, 0.48)
    .sort((a, b) => b.score - a.score)

  return candidates.slice(0, MAX_DEBUG_CANDIDATES)
}

function buildDebugReading(bitmap, candidate, index) {
  const safe = clampZone(bitmap, candidate)
  const parent = candidate.parentBody || null
  const meta = candidate.meta || {}

  const label = [
    `DBG${index + 1}`,
    candidate.kind || 'unknown',
    `score${Math.round(candidate.score || 0)}`,
    `x${safe.x}`,
    `y${safe.y}`,
    `w${safe.width}`,
    `h${safe.height}`,
    meta.visual ? `v${meta.visual}` : '',
    meta.ratio ? `r${meta.ratio}` : '',
    parent ? `body${Math.round(parent.width)}x${Math.round(parent.height)}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    id: `debug-candidate-${index}`,
    confidence: Math.max(1, 99 - index),
    rawText: label,
    region: safe,
    thumbUrl: workerCanvasToUrl(bitmap, safe),
    manualCode: '',
  }
}

export async function analyzeStickerCodesFromImage(recognize, bitmap, stickers) {
  const candidates = detectPreciseCodeCandidates(bitmap)

  if (DEBUG_DETECTOR) {
    console.log('DEBUG precise candidates:', candidates)
  }

  const debugReadings = candidates.map((candidate, index) =>
    buildDebugReading(bitmap, candidate, index)
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
