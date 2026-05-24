import { classifyZoneReadings } from './ocrStickerCodes'

const DEBUG_DETECTOR = true

const MAX_SINGLE_CANDIDATES = 8
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

function isReadableZone(bitmap, zone) {
  const safe = clampZone(bitmap, zone)

  return safe.width >= 18 && safe.height >= 8
}

function normalizeAngle(angle) {
  let safeAngle = Number(angle || 0)

  while (safeAngle > 45) safeAngle -= 90
  while (safeAngle < -45) safeAngle += 90

  if (Math.abs(safeAngle) < 3) return 0

  return Number(safeAngle.toFixed(1))
}

function shouldUseRotatedCopy(angle) {
  const safeAngle = Math.abs(normalizeAngle(angle))

  return safeAngle >= 5 && safeAngle <= 28
}

function expandZone(bitmap, zone, amountX = 0.08, amountY = 0.12) {
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

function expandLabelWide(bitmap, zone, kind) {
  const safe = clampZone(bitmap, zone)

  const leftExtra = Math.floor(safe.width * 0.25)
  const rightExtra = Math.floor(safe.width * 1.45)
  const topExtra = Math.floor(safe.height * 0.35)
  const bottomExtra = Math.floor(safe.height * 0.35)

  return clampZone(bitmap, {
    ...safe,
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
      zone?.rotateThumb ? 'rot' : 'normal',
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

function removeOverlappingRegions(regions, maxOverlap = 0.50) {
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

function zoneCenter(zone) {
  return {
    x: zone.x + zone.width / 2,
    y: zone.y + zone.height / 2,
  }
}

function isInside(zone, container, paddingRatio = 0.10) {
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
    c.x >= body.x + body.width * 0.34 &&
    c.x <= body.x + body.width * 1.08 &&
    c.y >= body.y - body.height * 0.08 &&
    c.y <= body.y + body.height * 0.45
  )
}

function workerCanvasToUrl(bitmap, zone) {
  const safe = clampZone(bitmap, zone)
  const angle = safe.rotateThumb ? normalizeAngle(safe.angle || 0) : 0

  if (!angle) {
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

  const padding = Math.ceil(Math.max(safe.width, safe.height) * 0.35)
  const sourceX = Math.max(0, safe.x - padding)
  const sourceY = Math.max(0, safe.y - padding)
  const sourceW = Math.min(safe.width + padding * 2, bitmap.width - sourceX)
  const sourceH = Math.min(safe.height + padding * 2, bitmap.height - sourceY)

  const temp = document.createElement('canvas')
  temp.width = sourceW
  temp.height = sourceH

  const tempCtx = temp.getContext('2d')

  tempCtx.drawImage(
    bitmap,
    sourceX,
    sourceY,
    sourceW,
    sourceH,
    0,
    0,
    sourceW,
    sourceH
  )

  const diagonal = Math.ceil(Math.sqrt(sourceW * sourceW + sourceH * sourceH))

  const rotated = document.createElement('canvas')
  rotated.width = diagonal
  rotated.height = diagonal

  const rotatedCtx = rotated.getContext('2d')
  rotatedCtx.fillStyle = '#ffffff'
  rotatedCtx.fillRect(0, 0, rotated.width, rotated.height)

  rotatedCtx.translate(rotated.width / 2, rotated.height / 2)
  rotatedCtx.rotate((-angle * Math.PI) / 180)
  rotatedCtx.drawImage(temp, -sourceW / 2, -sourceH / 2)

  return rotated.toDataURL('image/jpeg', 0.92)
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
      gray >= 88 &&
      gray <= 250 &&
      chroma <= 105
    )
  }

  if (kind === 'light-label') {
    return ({ gray, chroma }) => (
      gray >= 126 &&
      gray <= 255 &&
      chroma <= 88
    )
  }

  if (kind === 'dark-label') {
    return ({ gray, chroma }) => (
      gray >= 40 &&
      gray <= 195 &&
      chroma <= 82
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
    if (chroma >= 82) coloredCount += 1
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

  if (ratio >= 0.90 && ratio <= 13.0) score += 24
  if (ratio >= 1.45 && ratio <= 8.0) score += 26

  if (stats.stdGray >= 6 && stats.stdGray <= 95) score += 20
  if (stats.edgeRatio >= 0.012 && stats.edgeRatio <= 0.70) score += 24

  if (stats.coloredRatio <= 0.30) score += 18
  if (stats.avgChroma <= 78) score += 16

  if (String(kind).includes('light')) {
    if (stats.avgGray >= 110) score += 18
    if (stats.brightRatio >= 0.15) score += 10
  }

  if (String(kind).includes('dark')) {
    if (stats.avgGray >= 38 && stats.avgGray <= 198) score += 18
    if (stats.darkRatio >= 0.06 || stats.brightRatio >= 0.06) score += 10
  }

  if (stats.coloredRatio >= 0.50) score -= 70
  if (stats.edgeRatio < 0.008) score -= 38
  if (ratio < 0.75 || ratio > 14.0) score -= 55

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

  if (originalW < bitmap.width * 0.11) return null
  if (originalH < bitmap.height * 0.065) return null
  if (originalW > bitmap.width * 0.98) return null
  if (originalH > bitmap.height * 0.98) return null

  if (ratio < 0.28 || ratio > 4.5) return null
  if (fillRatio < 0.12) return null
  if (imageAreaRatio < 0.012 || imageAreaRatio > 0.80) return null

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
  score -= Math.abs(ratio - 1.45) * 5

  return {
    ...expanded,
    kind: 'sticker-body',
    angle: normalizeAngle(component.angle || 0),
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

  if (originalW < 16 || originalH < 7) return []
  if (originalW > bitmap.width * 0.38) return []
  if (originalH > bitmap.height * 0.16) return []

  if (ratio < 0.75 || ratio > 11.5) return []
  if (fillRatio < 0.13) return []

  const imageAreaRatio = (originalW * originalH) / Math.max(1, imageArea)

  if (imageAreaRatio < 0.00006 || imageAreaRatio > 0.052) return []

  const base = {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  }

  const angle = normalizeAngle(component.angle || 0)

  const tight = kind === 'light-label'
    ? expandZone(bitmap, base, 0.10, 0.18)
    : expandZone(bitmap, base, 0.12, 0.18)

  const wide = expandLabelWide(
    bitmap,
    base,
    kind === 'light-label' ? 'light-label-wide' : 'dark-label-wide'
  )

  const rawCandidates = [
    {
      ...tight,
      angle,
      rotateThumb: false,
      kind: kind === 'light-label' ? 'direct-light-tight' : 'direct-dark-tight',
      baseScore: 270,
    },
    {
      ...wide,
      angle,
      rotateThumb: false,
      kind: kind === 'light-label' ? 'direct-light-wide' : 'direct-dark-wide',
      baseScore: 265,
    },
  ]

  return rawCandidates
    .map(candidate => {
      const visual = scoreVisualQuality(bitmap, candidate, candidate.kind)

      if (visual.score < 8) return null

      let score = candidate.baseScore

      score += visual.score
      score += Math.min(34, fillRatio * 36)
      score -= Math.abs(ratio - 3.6) * 2

      if (candidate.kind.includes('dark')) score += 10
      if (candidate.kind.includes('wide')) score += 20

      return {
        ...candidate,
        score: Math.round(score),
        meta: {
          ratio: Number(ratio.toFixed(2)),
          fillRatio: Number(fillRatio.toFixed(2)),
          area: Number(imageAreaRatio.toFixed(4)),
          angle,
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

      component.angle = getComponentAngle(component)

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

function makeTopRightCandidatesFromBody(bitmap, body, index, allowRotation) {
  const bodyAngle = allowRotation ? normalizeAngle(body.angle || 0) : 0

  const zones = [
    {
      name: 'wide',
      x: 0.47,
      y: 0.000,
      w: 0.52,
      h: 0.215,
      score: 320,
    },
    {
      name: 'tight',
      x: 0.55,
      y: 0.010,
      w: 0.44,
      h: 0.165,
      score: 335,
    },
    {
      name: 'small',
      x: 0.60,
      y: 0.025,
      w: 0.36,
      h: 0.120,
      score: 325,
    },
  ]

  const candidates = []

  zones.forEach(zone => {
    const crop = expandZone(
      bitmap,
      relativeZone(bitmap, body, zone.x, zone.y, zone.w, zone.h),
      0.05,
      0.12
    )

    const darkVisual = scoreVisualQuality(bitmap, crop, 'dark-label')
    const lightVisual = scoreVisualQuality(bitmap, crop, 'light-label')

    if (darkVisual.score >= 8) {
      candidates.push({
        ...crop,
        angle: bodyAngle,
        rotateThumb: false,
        kind: `body${index + 1}-${zone.name}-dark`,
        score: zone.score + Math.round(body.score || 0) + darkVisual.score,
        parentBody: body,
        meta: {
          ...darkVisual.stats,
          visual: darkVisual.score,
          ratio: darkVisual.ratio,
          angle: bodyAngle,
        },
      })
    }

    if (lightVisual.score >= 8) {
      candidates.push({
        ...crop,
        angle: bodyAngle,
        rotateThumb: false,
        kind: `body${index + 1}-${zone.name}-light`,
        score: zone.score + Math.round(body.score || 0) + lightVisual.score - 6,
        parentBody: body,
        meta: {
          ...lightVisual.stats,
          visual: lightVisual.score,
          ratio: lightVisual.ratio,
          angle: bodyAngle,
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
      isInside(label, candidateBody, 0.12) &&
      isTopRightOfBody(label, candidateBody)
    )

    if (!body) {
      return {
        ...label,
        score: label.score - 20,
      }
    }

    return {
      ...label,
      kind: `body-direct-${label.kind}`,
      score: label.score + 230 + Math.round(body.score || 0),
      parentBody: body,
    }
  })
}

function addRotatedCopiesForMultiMode(candidates) {
  const rotatedCopies = []

  candidates.forEach(candidate => {
    const angle = normalizeAngle(candidate.angle || 0)

    if (!shouldUseRotatedCopy(angle)) return
    if (candidate.forced) return
    if (String(candidate.kind || '').startsWith('body')) return

    rotatedCopies.push({
      ...candidate,
      kind: `${candidate.kind}-ROT`,
      rotateThumb: true,
      score: candidate.score + 38,
      angle,
    })
  })

  return rotatedCopies
}

function addSinglePhotoBackups(bitmap) {
  const { width, height } = bitmap

  return [
    {
      x: Math.floor(width * 0.590),
      y: Math.floor(height * 0.125),
      width: Math.floor(width * 0.275),
      height: Math.floor(height * 0.090),
      kind: 'backup-single-arg-tight',
      angle: 0,
      rotateThumb: false,
      score: 980,
      forced: true,
    },
    {
      x: Math.floor(width * 0.555),
      y: Math.floor(height * 0.108),
      width: Math.floor(width * 0.345),
      height: Math.floor(height * 0.120),
      kind: 'backup-single-arg-wide',
      angle: 0,
      rotateThumb: false,
      score: 940,
      forced: true,
    },
    {
      x: Math.floor(width * 0.610),
      y: Math.floor(height * 0.300),
      width: Math.floor(width * 0.285),
      height: Math.floor(height * 0.085),
      kind: 'backup-single-fwc-tight',
      angle: 0,
      rotateThumb: false,
      score: 980,
      forced: true,
    },
    {
      x: Math.floor(width * 0.580),
      y: Math.floor(height * 0.285),
      width: Math.floor(width * 0.360),
      height: Math.floor(height * 0.125),
      kind: 'backup-single-fwc-wide',
      angle: 0,
      rotateThumb: false,
      score: 940,
      forced: true,
    },
  ].filter(region => isReadableZone(bitmap, region))
}

function filterCandidateNoise(candidate) {
  if (candidate.forced) return true

  const stats = candidate.meta || {}

  if (Number(stats.coloredRatio || 0) >= 0.58) return false
  if (Number(stats.edgeRatio || 0) < 0.006) return false

  const ratio = candidate.width / Math.max(1, candidate.height)

  if (ratio < 0.70 || ratio > 14.5) return false

  return true
}

function detectPreciseCodeCandidates(bitmap) {
  const rawBodies = detectComponents(bitmap, 'sticker-body')

  const bodies = removeOverlappingRegions(
    rawBodies.sort((a, b) => b.score - a.score),
    0.64
  ).slice(0, 16)

  const directLightLabels = detectComponents(bitmap, 'light-label')
  const directDarkLabels = detectComponents(bitmap, 'dark-label')

  const rawDirectLabels = [
    ...directDarkLabels,
    ...directLightLabels,
  ]

  const likelyMultiple = (
    bodies.length >= 5 ||
    rawDirectLabels.length >= 18
  )

  const allowRotation = likelyMultiple

  const directLabels = boostDirectLabelsWithBodies(rawDirectLabels, bodies)

  const bodyCornerCandidates = bodies.flatMap((body, index) =>
    makeTopRightCandidatesFromBody(bitmap, body, index, allowRotation)
  )

  const singleBackups = likelyMultiple ? [] : addSinglePhotoBackups(bitmap)

  let baseCandidates = uniqueZones([
    ...singleBackups,
    ...directLabels,
    ...bodyCornerCandidates,
  ])
    .filter(candidate => isReadableZone(bitmap, candidate))
    .filter(filterCandidateNoise)

  if (allowRotation) {
    baseCandidates = uniqueZones([
      ...baseCandidates,
      ...addRotatedCopiesForMultiMode(baseCandidates),
    ])
  }

  const candidates = removeOverlappingRegions(baseCandidates, 0.50)
    .sort((a, b) => b.score - a.score)

  return candidates.slice(0, likelyMultiple ? MAX_MULTI_CANDIDATES : MAX_SINGLE_CANDIDATES)
}

function buildDebugReading(bitmap, candidate, index) {
  const safe = clampZone(bitmap, candidate)
  const parent = candidate.parentBody || null
  const meta = candidate.meta || {}
  const angle = normalizeAngle(candidate.angle || 0)

  const label = [
    `DBG${index + 1}`,
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
    parent ? `body${Math.round(parent.width)}x${Math.round(parent.height)}` : '',
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
  const candidates = detectPreciseCodeCandidates(bitmap)

  if (DEBUG_DETECTOR) {
    console.log('DEBUG hybrid candidates:', candidates)
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
