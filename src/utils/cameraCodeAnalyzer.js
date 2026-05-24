import { classifyZoneReadings } from './ocrStickerCodes'

const DEBUG_DETECTOR = true

const MAX_DEBUG_CANDIDATES = 18

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

function expandZone(bitmap, zone, amountX = 0.08, amountY = 0.12) {
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

function expandLabelWide(bitmap, zone, kind) {
  const safe = clampZone(bitmap, zone)

  const leftExtra = Math.floor(safe.width * 0.28)
  const rightExtra = Math.floor(safe.width * 1.45)
  const topExtra = Math.floor(safe.height * 0.35)
  const bottomExtra = Math.floor(safe.height * 0.35)

  return clampZone(bitmap, {
    x: safe.x - leftExtra,
    y: safe.y - topExtra,
    width: safe.width + leftExtra + rightExtra,
    height: safe.height + topExtra + bottomExtra,
    kind,
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

function removeOverlappingRegions(regions, maxOverlap = 0.48) {
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

function isInside(zone, container, paddingRatio = 0.08) {
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

  return (
    c.x >= body.x + body.width * 0.38 &&
    c.x <= body.x + body.width * 1.05 &&
    c.y >= body.y - body.height * 0.05 &&
    c.y <= body.y + body.height * 0.42
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
      gray >= 90 &&
      gray <= 248 &&
      chroma <= 100
    )
  }

  if (kind === 'light-label') {
    return ({ gray, chroma }) => (
      gray >= 128 &&
      gray <= 255 &&
      chroma <= 85
    )
  }

  if (kind === 'dark-label') {
    return ({ gray, chroma }) => (
      gray >= 42 &&
      gray <= 190 &&
      chroma <= 78
    )
  }

  return () => false
}

function measureZoneStats(bitmap, zone) {
  const safe = clampZone(bitmap, zone)

  const maxW = 130
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

  if (ratio >= 1.25 && ratio <= 9.5) score += 35
  if (ratio >= 1.8 && ratio <= 6.8) score += 25

  if (stats.stdGray >= 7 && stats.stdGray <= 90) score += 22
  if (stats.edgeRatio >= 0.025 && stats.edgeRatio <= 0.65) score += 26

  if (stats.coloredRatio <= 0.26) score += 22
  if (stats.avgChroma <= 72) score += 18

  if (kind.includes('light')) {
    if (stats.avgGray >= 115) score += 20
    if (stats.brightRatio >= 0.18) score += 10
  }

  if (kind.includes('dark')) {
    if (stats.avgGray >= 42 && stats.avgGray <= 190) score += 20
    if (stats.darkRatio >= 0.08 || stats.brightRatio >= 0.08) score += 10
  }

  if (stats.coloredRatio >= 0.42) score -= 70
  if (stats.edgeRatio < 0.015) score -= 40
  if (ratio < 1.0 || ratio > 11.5) score -= 55

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

  if (originalW < bitmap.width * 0.12) return null
  if (originalH < bitmap.height * 0.07) return null
  if (originalW > bitmap.width * 0.98) return null
  if (originalH > bitmap.height * 0.98) return null

  if (ratio < 0.30 || ratio > 4.2) return null
  if (fillRatio < 0.13) return null
  if (imageAreaRatio < 0.014 || imageAreaRatio > 0.78) return null

  const base = {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  }

  const expanded = expandZone(bitmap, base, 0.01, 0.01)

  let score = 120

  score += Math.min(60, imageAreaRatio * 220)
  score += Math.min(35, fillRatio * 40)
  score -= Math.abs(ratio - 1.45) * 6

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

function componentToDirectLabels(bitmap, component, scale, kind, imageArea) {
  const boxW = component.maxX - component.minX + 1
  const boxH = component.maxY - component.minY + 1
  const area = boxW * boxH
  const fillRatio = component.count / Math.max(1, area)
  const ratio = boxW / Math.max(1, boxH)

  const originalX = Math.floor(component.minX / scale)
  const originalY = Math.floor(component.minY / scale)
  const originalW = Math.floor(boxW / scale)
  const originalH = Math.floor(boxH / scale)

  if (originalW < 18 || originalH < 8) return []
  if (originalW > bitmap.width * 0.36) return []
  if (originalH > bitmap.height * 0.14) return []

  if (ratio < 0.90 || ratio > 10.5) return []
  if (fillRatio < 0.16) return []

  const imageAreaRatio = (originalW * originalH) / Math.max(1, imageArea)

  if (imageAreaRatio < 0.00008 || imageAreaRatio > 0.045) return []

  const base = {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  }

  const tight = kind === 'light-label'
    ? expandZone(bitmap, base, 0.08, 0.14)
    : expandZone(bitmap, base, 0.10, 0.16)

  const wide = expandLabelWide(
    bitmap,
    base,
    kind === 'light-label' ? 'light-label-wide' : 'dark-label-wide'
  )

  const rawCandidates = [
    {
      ...tight,
      kind: kind === 'light-label' ? 'direct-light-tight' : 'direct-dark-tight',
      baseScore: 260,
    },
    {
      ...wide,
      kind: kind === 'light-label' ? 'direct-light-wide' : 'direct-dark-wide',
      baseScore: 245,
    },
  ]

  return rawCandidates
    .map(candidate => {
      const visual = scoreVisualQuality(bitmap, candidate, candidate.kind)

      if (visual.score < 14) return null

      let score = candidate.baseScore

      score += visual.score
      score += Math.min(34, fillRatio * 36)
      score -= Math.abs(ratio - 3.7) * 2

      if (candidate.kind.includes('dark')) score += 10
      if (candidate.kind.includes('wide')) score += 16

      return {
        ...candidate,
        score: Math.round(score),
        meta: {
          ratio: Number(ratio.toFixed(2)),
          fillRatio: Number(fillRatio.toFixed(2)),
          area: Number(imageAreaRatio.toFixed(4)),
          ...visual.stats,
          visual: visual.score,
        },
      }
    })
    .filter(Boolean)
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

      if (kind === 'sticker-body') {
        const candidate = componentToStickerBody(bitmap, component, scale, imageArea)

        if (candidate && isReadableZone(bitmap, candidate)) {
          results.push(candidate)
        }
      }

      if (kind === 'light-label' || kind === 'dark-label') {
        const labelCandidates = componentToDirectLabels(bitmap, component, scale, kind, imageArea)

        labelCandidates.forEach(candidate => {
          if (candidate && isReadableZone(bitmap, candidate)) {
            results.push(candidate)
          }
        })
      }
    }
  }

  return results
}

function makeTopRightCandidatesFromBody(bitmap, body, index) {
  const zones = [
    {
      name: 'wide',
      x: 0.49,
      y: 0.000,
      w: 0.50,
      h: 0.205,
      score: 320,
    },
    {
      name: 'tight',
      x: 0.56,
      y: 0.015,
      w: 0.42,
      h: 0.155,
      score: 335,
    },
    {
      name: 'small',
      x: 0.61,
      y: 0.030,
      w: 0.34,
      h: 0.110,
      score: 325,
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

    if (darkVisual.score >= 12) {
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

    if (lightVisual.score >= 12) {
      candidates.push({
        ...crop,
        kind: `body${index + 1}-${zone.name}-light`,
        score: zone.score + Math.round(body.score || 0) + lightVisual.score - 6,
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

function boostDirectLabelsWithBodies(labels, bodies) {
  if (!bodies.length) {
    return labels
  }

  return labels.map(label => {
    const body = bodies.find(candidateBody =>
      isInside(label, candidateBody, 0.10) &&
      isTopRightOfBody(label, candidateBody)
    )

    if (!body) {
      return {
        ...label,
        score: label.score - 35,
      }
    }

    return {
      ...label,
      kind: `body-direct-${label.kind}`,
      score: label.score + 240 + Math.round(body.score || 0),
      parentBody: body,
    }
  })
}

function addSinglePhotoBackups(bitmap, bodies, labels) {
  const likelySingle = bodies.length <= 4 && labels.length <= 16

  if (!likelySingle) return []

  const { width, height } = bitmap

  const backups = [
    {
      x: Math.floor(width * 0.590),
      y: Math.floor(height * 0.125),
      width: Math.floor(width * 0.275),
      height: Math.floor(height * 0.090),
      kind: 'backup-single-arg-tight',
      score: 900,
      forced: true,
    },
    {
      x: Math.floor(width * 0.555),
      y: Math.floor(height * 0.108),
      width: Math.floor(width * 0.345),
      height: Math.floor(height * 0.120),
      kind: 'backup-single-arg-wide',
      score: 860,
      forced: true,
    },
    {
      x: Math.floor(width * 0.610),
      y: Math.floor(height * 0.300),
      width: Math.floor(width * 0.285),
      height: Math.floor(height * 0.085),
      kind: 'backup-single-fwc-tight',
      score: 900,
      forced: true,
    },
    {
      x: Math.floor(width * 0.580),
      y: Math.floor(height * 0.285),
      width: Math.floor(width * 0.360),
      height: Math.floor(height * 0.125),
      kind: 'backup-single-fwc-wide',
      score: 860,
      forced: true,
    },
  ]

  return backups.filter(region => isReadableZone(bitmap, region))
}

function filterCandidateNoise(candidate) {
  if (candidate.forced) return true

  const stats = candidate.meta || {}

  if (Number(stats.coloredRatio || 0) >= 0.50) return false
  if (Number(stats.edgeRatio || 0) < 0.010) return false

  const ratio = candidate.width / Math.max(1, candidate.height)

  if (ratio < 0.90 || ratio > 12.0) return false

  return true
}

function detectPreciseCodeCandidates(bitmap) {
  const rawBodies = detectComponents(bitmap, 'sticker-body')

  const bodies = removeOverlappingRegions(
    rawBodies.sort((a, b) => b.score - a.score),
    0.64
  ).slice(0, 14)

  const directLightLabels = detectComponents(bitmap, 'light-label')
  const directDarkLabels = detectComponents(bitmap, 'dark-label')

  const directLabels = boostDirectLabelsWithBodies(
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
    ...backups,
    ...directLabels,
    ...bodyCornerCandidates,
  ])
    .filter(candidate => isReadableZone(bitmap, candidate))
    .filter(filterCandidateNoise)

  candidates = removeOverlappingRegions(candidates, 0.50)
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
