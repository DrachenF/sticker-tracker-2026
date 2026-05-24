import { classifyZoneReadings } from './ocrStickerCodes'

const DEBUG_DETECTOR = true

const MAX_DEBUG_CANDIDATES = 24

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

  return safe.width >= 18 && safe.height >= 7
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
    const safe = {
      x: Math.round(zone?.x || 0),
      y: Math.round(zone?.y || 0),
      width: Math.round(zone?.width || 0),
      height: Math.round(zone?.height || 0),
    }

    const key = [
      safe.x,
      safe.y,
      safe.width,
      safe.height,
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
    // Papel / estampa: gris, blanco, poco color.
    // Excluye flores, mantel muy azul/verde/rojo y teclado muy oscuro.
    return ({ gray, chroma }) => (
      gray >= 92 &&
      gray <= 245 &&
      chroma <= 95
    )
  }

  if (kind === 'light-label') {
    // Cápsulas claras tipo FWC2/FWC3.
    return ({ gray, chroma }) => (
      gray >= 140 &&
      gray <= 255 &&
      chroma <= 82
    )
  }

  if (kind === 'dark-label') {
    // Etiquetas grises tipo ARG17/PAR1.
    return ({ gray, chroma }) => (
      gray >= 55 &&
      gray <= 180 &&
      chroma <= 72
    )
  }

  return () => false
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

  let score = 100

  // Estampas suelen ser rectángulos medianos.
  score += Math.min(40, imageAreaRatio * 180)
  score += Math.min(30, fillRatio * 35)
  score -= Math.abs(ratio - 1.45) * 8

  const expanded = expandZone(
    bitmap,
    {
      x: originalX,
      y: originalY,
      width: originalW,
      height: originalH,
    },
    0.015,
    0.015
  )

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
  if (originalH > bitmap.height * 0.12) return null

  if (ratio < 1.25 || ratio > 9.5) return null
  if (fillRatio < 0.24) return null

  const imageAreaRatio = (originalW * originalH) / Math.max(1, imageArea)

  if (imageAreaRatio < 0.00012 || imageAreaRatio > 0.035) return null

  let score = 190

  score += Math.min(36, fillRatio * 38)
  score -= Math.abs(ratio - 3.9) * 5

  if (kind === 'dark-label') score += 14
  if (kind === 'light-label') score += 10

  if (originalH >= 10 && originalH <= 55) score += 18
  if (originalW >= 34 && originalW <= 210) score += 18

  const baseZone = {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  }

  const expanded = kind === 'light-label'
    ? expandZone(bitmap, baseZone, 0.07, 0.12)
    : expandZone(bitmap, baseZone, 0.09, 0.14)

  return {
    ...expanded,
    kind,
    score: Math.round(score),
    meta: {
      ratio: Number(ratio.toFixed(2)),
      fillRatio: Number(fillRatio.toFixed(2)),
      area: Number(imageAreaRatio.toFixed(4)),
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
  const candidates = []

  const zones = [
    {
      name: 'wide',
      x: 0.52,
      y: 0.01,
      w: 0.45,
      h: 0.17,
      score: 300,
    },
    {
      name: 'tight',
      x: 0.58,
      y: 0.025,
      w: 0.37,
      h: 0.125,
      score: 315,
    },
    {
      name: 'small',
      x: 0.62,
      y: 0.035,
      w: 0.30,
      h: 0.095,
      score: 305,
    },
  ]

  zones.forEach(zone => {
    const crop = expandZone(
      bitmap,
      relativeZone(bitmap, body, zone.x, zone.y, zone.w, zone.h),
      0.04,
      0.10
    )

    candidates.push({
      ...crop,
      kind: `body-${index + 1}-${zone.name}-dark`,
      score: zone.score + Math.round(body.score || 0),
      parentBody: body,
    })

    candidates.push({
      ...crop,
      kind: `body-${index + 1}-${zone.name}-light`,
      score: zone.score - 8 + Math.round(body.score || 0),
      parentBody: body,
    })
  })

  return candidates.filter(candidate => isReadableZone(bitmap, candidate))
}

function isCandidateInsideTopAreaOfBody(candidate, body) {
  const cx = candidate.x + candidate.width / 2
  const cy = candidate.y + candidate.height / 2

  const insideX = cx >= body.x + body.width * 0.40 && cx <= body.x + body.width * 1.02
  const insideY = cy >= body.y - body.height * 0.04 && cy <= body.y + body.height * 0.35

  return insideX && insideY
}

function keepLabelsRelatedToBodies(labels, bodies) {
  if (!bodies.length) {
    return labels
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  }

  return labels
    .map(label => {
      const body = bodies.find(candidateBody =>
        isCandidateInsideTopAreaOfBody(label, candidateBody)
      )

      if (!body) return null

      return {
        ...label,
        kind: `direct-${label.kind}`,
        score: label.score + 180 + Math.round(body.score || 0),
        parentBody: body,
      }
    })
    .filter(Boolean)
}

function addEmergencyBackupRegions(bitmap) {
  const { width, height } = bitmap

  return [
    {
      x: Math.floor(width * 0.615),
      y: Math.floor(height * 0.315),
      width: Math.floor(width * 0.255),
      height: Math.floor(height * 0.065),
      kind: 'backup-single-fwc-tight',
      score: 260,
    },
    {
      x: Math.floor(width * 0.590),
      y: Math.floor(height * 0.125),
      width: Math.floor(width * 0.255),
      height: Math.floor(height * 0.085),
      kind: 'backup-single-arg-tight',
      score: 260,
    },
  ].filter(region => isReadableZone(bitmap, region))
}

function detectPreciseCodeCandidates(bitmap) {
  const bodies = removeOverlappingRegions(
    detectComponents(bitmap, 'sticker-body')
      .sort((a, b) => b.score - a.score),
    0.62
  ).slice(0, 12)

  const bodyCornerCandidates = bodies.flatMap((body, index) =>
    makeTopRightCandidatesFromBody(bitmap, body, index)
  )

  const directLightLabels = detectComponents(bitmap, 'light-label')
  const directDarkLabels = detectComponents(bitmap, 'dark-label')

  const directLabels = keepLabelsRelatedToBodies(
    [
      ...directDarkLabels,
      ...directLightLabels,
    ],
    bodies
  )

  let candidates = uniqueZones([
    ...directLabels,
    ...bodyCornerCandidates,
  ])
    .filter(candidate => isReadableZone(bitmap, candidate))

  candidates = removeOverlappingRegions(candidates, 0.50)
    .sort((a, b) => b.score - a.score)

  if (candidates.length < 4) {
    candidates = uniqueZones([
      ...candidates,
      ...addEmergencyBackupRegions(bitmap),
    ])
      .filter(candidate => isReadableZone(bitmap, candidate))
      .sort((a, b) => b.score - a.score)
  }

  return candidates.slice(0, MAX_DEBUG_CANDIDATES)
}

function buildDebugReading(bitmap, candidate, index) {
  const safe = clampZone(bitmap, candidate)
  const parent = candidate.parentBody || null

  const label = [
    `DBG${index + 1}`,
    candidate.kind || 'unknown',
    `score${Math.round(candidate.score || 0)}`,
    `x${safe.x}`,
    `y${safe.y}`,
    `w${safe.width}`,
    `h${safe.height}`,
    parent ? `body${Math.round(parent.width)}x${Math.round(parent.height)}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    id: `debug-candidate-${index}`,
    confidence: Math.round(candidate.score || 0),
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
