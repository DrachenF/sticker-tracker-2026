import { classifyZoneReadings } from './ocrStickerCodes'

const DEBUG_DETECTOR = true

const MAX_SINGLE_CANDIDATES = 12
const MAX_MULTI_CANDIDATES = 26

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
  let value = Number(angle || 0)

  while (value > 45) value -= 90
  while (value < -45) value += 90

  if (Math.abs(value) < 5) return 0

  return Number(value.toFixed(1))
}

function shouldAddRotatedCopy(angle) {
  const safe = Math.abs(normalizeAngle(angle))
  return safe >= 7 && safe <= 30
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

function relativeZone(bitmap, parent, rx, ry, rw, rh, kind, score) {
  return clampZone(bitmap, {
    x: Math.floor(parent.x + parent.width * rx),
    y: Math.floor(parent.y + parent.height * ry),
    width: Math.floor(parent.width * rw),
    height: Math.floor(parent.height * rh),
    kind,
    score,
    angle: parent.angle || 0,
    parentBody: parent,
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

function createMaskClassifier(kind) {
  if (kind === 'sticker-body') {
    return ({ gray, chroma }) => (
      gray >= 92 &&
      gray <= 248 &&
      chroma <= 105
    )
  }

  if (kind === 'light-code-pill') {
    return ({ gray, chroma }) => (
      gray >= 135 &&
      gray <= 255 &&
      chroma <= 75
    )
  }

  if (kind === 'dark-code-box') {
    return ({ gray, chroma }) => (
      gray >= 42 &&
      gray <= 180 &&
      chroma <= 75
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

function scoreSmallCodeCandidate(bitmap, zone, kind, fillRatio = 0) {
  const safe = clampZone(bitmap, zone)
  const stats = measureZoneStats(bitmap, safe)
  const ratio = safe.width / Math.max(1, safe.height)

  let score = 0

  if (ratio >= 1.4 && ratio <= 9.5) score += 30
  if (ratio >= 2.0 && ratio <= 6.8) score += 30

  if (stats.stdGray >= 7 && stats.stdGray <= 95) score += 22
  if (stats.edgeRatio >= 0.012 && stats.edgeRatio <= 0.70) score += 28

  if (stats.coloredRatio <= 0.12) score += 58
  if (stats.avgChroma <= 60) score += 36

  if (kind.includes('light')) {
    if (stats.avgGray >= 125) score += 32
    if (stats.brightRatio >= 0.18) score += 16
  }

  if (kind.includes('dark')) {
    if (stats.avgGray >= 42 && stats.avgGray <= 185) score += 32
    if (stats.darkRatio >= 0.08 || stats.brightRatio >= 0.06) score += 16
  }

  if (fillRatio >= 0.18 && fillRatio <= 0.92) score += 20

  // Penalizaciones agresivas contra mantel/flor/fondo.
  if (stats.coloredRatio >= 0.12) score -= 180
  if (stats.coloredRatio >= 0.18) score -= 260
  if (stats.avgChroma >= 70) score -= 160
  if (stats.avgChroma >= 90) score -= 240

  // Debe tener textura de letras, no solo una mancha.
  if (stats.edgeRatio < 0.012) score -= 140
  if (stats.stdGray < 7) score -= 120

  // Debe parecer cajita/cápsula horizontal.
  if (ratio < 1.25 || ratio > 10.5) score -= 140

  return {
    score: Math.round(score),
    stats,
    ratio: Number(ratio.toFixed(2)),
  }
}

function scoreBodyCandidate(bitmap, zone, fillRatio = 0, areaRatio = 0) {
  const safe = clampZone(bitmap, zone)
  const stats = measureZoneStats(bitmap, safe)
  const ratio = safe.width / Math.max(1, safe.height)

  let score = 0

  if (ratio >= 0.35 && ratio <= 3.4) score += 35
  if (stats.coloredRatio <= 0.20) score += 35
  if (stats.avgChroma <= 70) score += 25
  if (stats.avgGray >= 105 && stats.avgGray <= 225) score += 25
  if (fillRatio >= 0.14) score += 25

  score += Math.min(90, areaRatio * 260)

  if (stats.coloredRatio >= 0.35) score -= 90
  if (stats.avgChroma >= 100) score -= 80
  if (ratio < 0.25 || ratio > 4.8) score -= 90

  return {
    score: Math.round(score),
    stats,
    ratio: Number(ratio.toFixed(2)),
  }
}

function componentToBody(bitmap, component, scale, imageArea) {
  const boxW = component.maxX - component.minX + 1
  const boxH = component.maxY - component.minY + 1
  const area = boxW * boxH
  const fillRatio = component.count / Math.max(1, area)

  const originalX = Math.floor(component.minX / scale)
  const originalY = Math.floor(component.minY / scale)
  const originalW = Math.floor(boxW / scale)
  const originalH = Math.floor(boxH / scale)

  const ratio = originalW / Math.max(1, originalH)
  const areaRatio = (originalW * originalH) / Math.max(1, imageArea)

  if (originalW < bitmap.width * 0.10) return null
  if (originalH < bitmap.height * 0.055) return null
  if (originalW > bitmap.width * 0.96) return null
  if (originalH > bitmap.height * 0.96) return null

  if (ratio < 0.25 || ratio > 4.8) return null
  if (fillRatio < 0.11) return null
  if (areaRatio < 0.010 || areaRatio > 0.75) return null

  const base = clampZone(bitmap, {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  })

  const visual = scoreBodyCandidate(bitmap, base, fillRatio, areaRatio)

  if (visual.score < 45) return null

  return {
    ...expandZone(bitmap, base, 0.01, 0.01),
    kind: 'body',
    angle: normalizeAngle(getComponentAngle(component)),
    score: 300 + visual.score,
    meta: {
      ratio: Number(ratio.toFixed(2)),
      fillRatio: Number(fillRatio.toFixed(2)),
      area: Number(areaRatio.toFixed(4)),
      visual: visual.score,
      ...visual.stats,
    },
  }
}

function componentToSmallCodeCandidates(bitmap, component, scale, kind, imageArea) {
  const boxW = component.maxX - component.minX + 1
  const boxH = component.maxY - component.minY + 1
  const area = boxW * boxH
  const fillRatio = component.count / Math.max(1, area)
  const ratio = boxW / Math.max(1, boxH)

  const originalX = Math.floor(component.minX / scale)
  const originalY = Math.floor(component.minY / scale)
  const originalW = Math.floor(boxW / scale)
  const originalH = Math.floor(boxH / scale)

  if (originalW < 22 || originalH < 8) return []
  if (originalW > bitmap.width * 0.34) return []
  if (originalH > bitmap.height * 0.14) return []

  if (ratio < 1.0 || ratio > 10.5) return []
  if (fillRatio < 0.15) return []

  const areaRatio = (originalW * originalH) / Math.max(1, imageArea)

  if (areaRatio < 0.00004 || areaRatio > 0.045) return []

  const base = clampZone(bitmap, {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  })

  const angle = normalizeAngle(getComponentAngle(component))
  const type = kind === 'light-code-pill' ? 'light' : 'dark'

  const tight = expandZone(bitmap, base, 0.18, 0.34)

  const wider = clampZone(bitmap, {
    ...base,
    x: base.x - Math.floor(base.width * 0.42),
    y: base.y - Math.floor(base.height * 0.42),
    width: base.width + Math.floor(base.width * 1.85),
    height: base.height + Math.floor(base.height * 0.84),
  })

  const variants = [
    {
      ...tight,
      kind: `label-${type}-tight`,
      angle,
      rotateThumb: false,
      score: type === 'light' ? 580 : 560,
    },
    {
      ...wider,
      kind: `label-${type}-wide`,
      angle,
      rotateThumb: false,
      score: type === 'light' ? 540 : 525,
    },
  ]

  return variants
    .map(candidate => {
      const visual = scoreSmallCodeCandidate(bitmap, candidate, candidate.kind, fillRatio)

      if (visual.score < 35) return null

      return {
        ...candidate,
        score: candidate.score + visual.score,
        meta: {
          ratio: Number(ratio.toFixed(2)),
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
  const maxW = kind === 'sticker-body' ? 700 : 950
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

      if (kind === 'sticker-body') {
        const body = componentToBody(bitmap, component, scale, imageArea)

        if (body && isReadableZone(bitmap, body)) {
          results.push(body)
        }
      } else {
        const codeCandidates = componentToSmallCodeCandidates(bitmap, component, scale, kind, imageArea)

        codeCandidates.forEach(candidate => {
          if (candidate && isReadableZone(bitmap, candidate)) {
            results.push(candidate)
          }
        })
      }
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

function isLikelySinglePhoto(bitmap, bodies) {
  if (!bodies.length) return false

  const sorted = [...bodies].sort((a, b) => b.score - a.score)
  const first = sorted[0]
  const second = sorted[1]

  const firstArea = (first.width * first.height) / Math.max(1, bitmap.width * bitmap.height)
  const secondArea = second
    ? (second.width * second.height) / Math.max(1, bitmap.width * bitmap.height)
    : 0

  if (firstArea >= 0.14 && secondArea <= 0.07) return true
  if (firstArea >= 0.18 && firstArea / Math.max(0.001, secondArea) >= 1.75) return true

  return false
}

function getMainBody(bitmap, bodies) {
  if (!bodies.length) {
    return {
      x: Math.floor(bitmap.width * 0.08),
      y: Math.floor(bitmap.height * 0.18),
      width: Math.floor(bitmap.width * 0.84),
      height: Math.floor(bitmap.height * 0.64),
      angle: 0,
      kind: 'fallback-body',
      score: 100,
    }
  }

  return [...bodies].sort((a, b) => b.score - a.score)[0]
}

function makeSingleCropsFromBody(bitmap, body) {
  const ratio = body.width / Math.max(1, body.height)
  const isHorizontalSticker = ratio >= 1.05

  const crops = []
  const baseScore = 2200

  const common = [
    {
      name: 'code-exact',
      rx: 0.600,
      ry: 0.000,
      rw: 0.345,
      rh: 0.135,
      score: baseScore + 160,
    },
    {
      name: 'code-tight',
      rx: 0.635,
      ry: 0.015,
      rw: 0.285,
      rh: 0.095,
      score: baseScore + 140,
    },
    {
      name: 'code-wide',
      rx: 0.535,
      ry: 0.000,
      rw: 0.435,
      rh: 0.165,
      score: baseScore + 120,
    },
    {
      name: 'code-extra-wide',
      rx: 0.485,
      ry: 0.000,
      rw: 0.500,
      rh: 0.185,
      score: baseScore + 80,
    },
  ]

  common.forEach(item => {
    const crop = relativeZone(
      bitmap,
      body,
      item.rx,
      item.ry,
      item.rw,
      item.rh,
      `single-body-${isHorizontalSticker ? 'horizontal' : 'vertical'}-${item.name}`,
      item.score
    )

    crops.push({
      ...expandZone(bitmap, crop, 0.03, 0.08),
      forced: true,
      rotateThumb: false,
      angle: 0,
      meta: {
        bodyRatio: Number(ratio.toFixed(2)),
      },
    })
  })

  return crops.filter(crop => isReadableZone(bitmap, crop))
}

function makeFixedSingleFallbacks(bitmap) {
  const { width, height } = bitmap

  return [
    {
      x: Math.floor(width * 0.570),
      y: Math.floor(height * 0.305),
      width: Math.floor(width * 0.360),
      height: Math.floor(height * 0.105),
      kind: 'fixed-fwc-wide',
      score: 1950,
    },
    {
      x: Math.floor(width * 0.620),
      y: Math.floor(height * 0.318),
      width: Math.floor(width * 0.285),
      height: Math.floor(height * 0.080),
      kind: 'fixed-fwc-tight',
      score: 1920,
    },
    {
      x: Math.floor(width * 0.555),
      y: Math.floor(height * 0.105),
      width: Math.floor(width * 0.370),
      height: Math.floor(height * 0.125),
      kind: 'fixed-arg-wide',
      score: 1950,
    },
    {
      x: Math.floor(width * 0.600),
      y: Math.floor(height * 0.130),
      width: Math.floor(width * 0.300),
      height: Math.floor(height * 0.095),
      kind: 'fixed-arg-tight',
      score: 1920,
    },
  ]
    .map(zone => ({
      ...clampZone(bitmap, zone),
      forced: true,
      rotateThumb: false,
      angle: 0,
    }))
    .filter(zone => isReadableZone(bitmap, zone))
}

function makeMultiCropsFromBodies(bitmap, bodies) {
  const crops = []

  const sortedBodies = [...bodies]
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)

  sortedBodies.forEach((body, index) => {
    const bodyRatio = body.width / Math.max(1, body.height)

    const variants = [
      {
        name: 'top-right-wide',
        rx: 0.500,
        ry: 0.000,
        rw: 0.490,
        rh: 0.205,
        score: 1300,
      },
      {
        name: 'top-right-tight',
        rx: 0.585,
        ry: 0.010,
        rw: 0.365,
        rh: 0.145,
        score: 1340,
      },
      {
        name: 'top-right-small',
        rx: 0.635,
        ry: 0.020,
        rw: 0.285,
        rh: 0.110,
        score: 1320,
      },
    ]

    variants.forEach(variant => {
      const crop = relativeZone(
        bitmap,
        body,
        variant.rx,
        variant.ry,
        variant.rw,
        variant.rh,
        `multi-body${index + 1}-${variant.name}`,
        variant.score + Math.round(body.score || 0)
      )

      crops.push({
        ...expandZone(bitmap, crop, 0.04, 0.10),
        forced: false,
        rotateThumb: false,
        angle: normalizeAngle(body.angle || 0),
        parentBody: body,
        meta: {
          bodyRatio: Number(bodyRatio.toFixed(2)),
          bodyScore: Math.round(body.score || 0),
        },
      })
    })
  })

  return crops.filter(crop => isReadableZone(bitmap, crop))
}

function addRotatedCopies(candidates) {
  const copies = []

  candidates.forEach(candidate => {
    if (candidate.forced) return

    const angle = normalizeAngle(candidate.angle || 0)

    if (!shouldAddRotatedCopy(angle)) return

    copies.push({
      ...candidate,
      kind: `${candidate.kind}-ROT`,
      rotateThumb: true,
      angle,
      score: candidate.score + 110,
    })
  })

  return copies
}

function filterNoise(candidate) {
  if (candidate.forced) return true

  const stats = candidate.meta || {}
  const ratio = candidate.width / Math.max(1, candidate.height)

  const coloredRatio = Number(stats.coloredRatio || 0)
  const avgChroma = Number(stats.avgChroma || 0)
  const edgeRatio = Number(stats.edgeRatio || 0)
  const stdGray = Number(stats.stdGray || 0)

  // Quitar mantel, flor, fondo azul, verde, amarillo, rojo, etc.
  if (coloredRatio >= 0.16) return false
  if (avgChroma >= 72) return false

  // Quitar manchas lisas sin texto.
  if (edgeRatio < 0.012) return false
  if (stdGray < 7) return false

  // Mantener solo forma tipo código.
  if (ratio < 1.25 || ratio > 10.5) return false

  return true
}

function isCleanCrop(bitmap, candidate) {
  if (candidate.forced) return true

  const stats = measureZoneStats(bitmap, candidate)

  if (stats.coloredRatio >= 0.20) return false
  if (stats.avgChroma >= 78) return false
  if (stats.edgeRatio < 0.008) return false

  return true
}

function detectPreciseCodeCandidates(bitmap) {
  const bodies = removeOverlappingRegions(
    detectComponents(bitmap, 'sticker-body'),
    0.58
  ).sort((a, b) => b.score - a.score)

  const lightLabels = detectComponents(bitmap, 'light-code-pill')
  const darkLabels = detectComponents(bitmap, 'dark-code-box')

  const smallLabelCandidates = uniqueZones([
    ...lightLabels,
    ...darkLabels,
  ])
    .filter(filterNoise)
    .sort((a, b) => b.score - a.score)

  const likelySingleByBody = isLikelySinglePhoto(bitmap, bodies)

  // Si no detecta cuerpos, no asumimos múltiple solo por ruido.
  const likelyMultiple = !likelySingleByBody && (
    bodies.length >= 3 ||
    smallLabelCandidates.length >= 6
  )

  const likelySingle = likelySingleByBody || !likelyMultiple
  const mainBody = getMainBody(bitmap, bodies)

  let candidates = []

  if (likelySingle) {
    candidates = uniqueZones([
      ...makeSingleCropsFromBody(bitmap, mainBody),
      ...makeFixedSingleFallbacks(bitmap),
      ...smallLabelCandidates.slice(0, 4),
    ])
  } else {
    const multiBodyCrops = makeMultiCropsFromBodies(bitmap, bodies)
      .filter(candidate => isCleanCrop(bitmap, candidate))

    candidates = uniqueZones([
      ...multiBodyCrops,
      ...smallLabelCandidates.slice(0, 12),
    ])

    candidates = uniqueZones([
      ...candidates,
      ...addRotatedCopies(candidates),
    ])
  }

  candidates = removeOverlappingRegions(
    candidates,
    likelySingle ? 0.62 : 0.52
  ).sort((a, b) => b.score - a.score)

  return {
    candidates: candidates.slice(0, likelySingle ? MAX_SINGLE_CANDIDATES : MAX_MULTI_CANDIDATES),
    likelySingle,
    likelyMultiple,
    bodies,
    labelCount: smallLabelCandidates.length,
  }
}

function makeNormalCanvas(bitmap, candidate, scale = 2.8) {
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

function makeRotatedCanvas(bitmap, candidate, scale = 2.5) {
  const safe = clampZone(bitmap, candidate)
  const angle = normalizeAngle(candidate.angle || 0)

  if (!angle) return makeNormalCanvas(bitmap, candidate, scale)

  const padding = Math.ceil(Math.max(safe.width, safe.height) * 0.30)
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

function buildDebugReading(bitmap, candidate, index, detection) {
  const safe = clampZone(bitmap, candidate)
  const meta = candidate.meta || {}
  const angle = normalizeAngle(candidate.angle || 0)

  const label = [
    `DBG${index + 1}`,
    detection.likelySingle ? 'SINGLE' : 'MULTI',
    candidate.kind || 'unknown',
    candidate.rotateThumb ? 'ROT' : '',
    candidate.forced ? 'FORCED' : '',
    `score${Math.round(candidate.score || 0)}`,
    angle ? `ang${angle}` : '',
    `x${safe.x}`,
    `y${safe.y}`,
    `w${safe.width}`,
    `h${safe.height}`,
    meta.bodyRatio !== undefined ? `bodyR${meta.bodyRatio}` : '',
    meta.visual !== undefined ? `v${meta.visual}` : '',
    meta.coloredRatio !== undefined ? `color${meta.coloredRatio}` : '',
    meta.avgChroma !== undefined ? `chroma${meta.avgChroma}` : '',
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
  void recognize

  const detection = detectPreciseCodeCandidates(bitmap)
  const { candidates } = detection

  if (DEBUG_DETECTOR) {
    console.log('DEBUG CLEAN CODE DETECTOR:', {
      likelySingle: detection.likelySingle,
      likelyMultiple: detection.likelyMultiple,
      bodies: detection.bodies.length,
      labels: detection.labelCount,
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
        forced: Boolean(candidate.forced),
        meta: candidate.meta,
      })),
    })
  }

  const debugReadings = candidates.map((candidate, index) =>
    buildDebugReading(bitmap, candidate, index, detection)
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
