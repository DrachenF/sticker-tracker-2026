import { classifyZoneReadings } from './ocrStickerCodes'

const DEBUG_DETECTOR = true

const MAX_DEBUG_CANDIDATES = 60

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

function expandZone(bitmap, zone, amountX = 0.10, amountY = 0.15) {
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

function removeOverlappingRegions(regions) {
  const sorted = [...regions].sort((a, b) => b.score - a.score)
  const kept = []

  sorted.forEach(region => {
    const overlaps = kept.some(existing => regionIoU(existing, region) > 0.45)

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

  return c.toDataURL('image/jpeg', 0.9)
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
  if (kind === 'light-box') {
    return ({ gray, chroma }) => (
      gray >= 115 &&
      gray <= 255 &&
      chroma <= 95
    )
  }

  if (kind === 'dark-box') {
    return ({ gray, chroma }) => (
      gray >= 25 &&
      gray <= 185 &&
      chroma <= 85
    )
  }

  if (kind === 'sticker-body') {
    return ({ gray, chroma }) => (
      gray >= 85 &&
      gray <= 255 &&
      chroma <= 115
    )
  }

  return () => false
}

function componentToBoxCandidate(bitmap, component, scale, kind, imageArea) {
  const boxW = component.maxX - component.minX + 1
  const boxH = component.maxY - component.minY + 1
  const area = boxW * boxH
  const fillRatio = component.count / Math.max(1, area)
  const ratio = boxW / Math.max(1, boxH)

  const originalX = Math.floor(component.minX / scale)
  const originalY = Math.floor(component.minY / scale)
  const originalW = Math.floor(boxW / scale)
  const originalH = Math.floor(boxH / scale)

  if (originalW < 16 || originalH < 6) return null
  if (originalW > bitmap.width * 0.48) return null
  if (originalH > bitmap.height * 0.18) return null

  if (ratio < 0.85 || ratio > 10.5) return null
  if (fillRatio < 0.12) return null

  const originalArea = originalW * originalH
  const imageAreaRatio = originalArea / Math.max(1, imageArea)

  if (imageAreaRatio < 0.00008 || imageAreaRatio > 0.055) return null

  let score = 100

  score -= Math.abs(ratio - 3.8) * 2
  score += Math.min(25, fillRatio * 25)

  if (kind === 'light-box') score += 18
  if (kind === 'dark-box') score += 22

  if (originalH >= 8 && originalH <= 70) score += 18
  if (originalW >= 24 && originalW <= 250) score += 18

  const baseZone = {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  }

  const expanded = kind === 'light-box'
    ? expandZone(bitmap, baseZone, 0.08, 0.14)
    : expandZone(bitmap, baseZone, 0.10, 0.16)

  return {
    ...expanded,
    kind,
    score: Math.round(score),
    meta: {
      ratio: Number(ratio.toFixed(2)),
      fillRatio: Number(fillRatio.toFixed(2)),
    },
  }
}

function componentToStickerBodyCodeCandidates(bitmap, component, scale, imageArea) {
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

  if (originalW < bitmap.width * 0.14) return []
  if (originalH < bitmap.height * 0.08) return []
  if (originalW > bitmap.width * 0.98) return []
  if (originalH > bitmap.height * 0.98) return []
  if (ratio < 0.35 || ratio > 3.6) return []
  if (fillRatio < 0.15) return []
  if (imageAreaRatio < 0.018 || imageAreaRatio > 0.78) return []

  const sticker = {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  }

  const candidates = []

  candidates.push({
    ...expandZone(bitmap, {
      x: Math.floor(sticker.x + sticker.width * 0.52),
      y: Math.floor(sticker.y + sticker.height * 0.015),
      width: Math.floor(sticker.width * 0.45),
      height: Math.floor(sticker.height * 0.16),
    }, 0.04, 0.10),
    kind: 'body-top-right-dark',
    score: 260,
    meta: {
      ratio: Number(ratio.toFixed(2)),
      fillRatio: Number(fillRatio.toFixed(2)),
    },
  })

  candidates.push({
    ...expandZone(bitmap, {
      x: Math.floor(sticker.x + sticker.width * 0.52),
      y: Math.floor(sticker.y + sticker.height * 0.015),
      width: Math.floor(sticker.width * 0.45),
      height: Math.floor(sticker.height * 0.16),
    }, 0.04, 0.10),
    kind: 'body-top-right-light',
    score: 250,
    meta: {
      ratio: Number(ratio.toFixed(2)),
      fillRatio: Number(fillRatio.toFixed(2)),
    },
  })

  candidates.push({
    ...expandZone(bitmap, {
      x: Math.floor(sticker.x + sticker.width * 0.60),
      y: Math.floor(sticker.y + sticker.height * 0.030),
      width: Math.floor(sticker.width * 0.33),
      height: Math.floor(sticker.height * 0.115),
    }, 0.05, 0.12),
    kind: 'body-tight-dark',
    score: 245,
    meta: {
      ratio: Number(ratio.toFixed(2)),
      fillRatio: Number(fillRatio.toFixed(2)),
    },
  })

  candidates.push({
    ...expandZone(bitmap, {
      x: Math.floor(sticker.x + sticker.width * 0.60),
      y: Math.floor(sticker.y + sticker.height * 0.030),
      width: Math.floor(sticker.width * 0.33),
      height: Math.floor(sticker.height * 0.115),
    }, 0.05, 0.12),
    kind: 'body-tight-light',
    score: 240,
    meta: {
      ratio: Number(ratio.toFixed(2)),
      fillRatio: Number(fillRatio.toFixed(2)),
    },
  })

  return candidates.filter(candidate => isReadableZone(bitmap, candidate))
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
  const candidates = []
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

      if (kind === 'light-box' || kind === 'dark-box') {
        const candidate = componentToBoxCandidate(bitmap, component, scale, kind, imageArea)

        if (candidate && isReadableZone(bitmap, candidate)) {
          candidates.push(candidate)
        }
      }

      if (kind === 'sticker-body') {
        const bodyCandidates = componentToStickerBodyCodeCandidates(bitmap, component, scale, imageArea)

        bodyCandidates.forEach(candidate => {
          if (candidate && isReadableZone(bitmap, candidate)) {
            candidates.push(candidate)
          }
        })
      }
    }
  }

  return candidates
}

function addBackupRegions(bitmap) {
  const { width, height } = bitmap

  return [
    {
      x: Math.floor(width * 0.615),
      y: Math.floor(height * 0.315),
      width: Math.floor(width * 0.255),
      height: Math.floor(height * 0.065),
      kind: 'backup-fwc-tight',
      score: 300,
    },
    {
      x: Math.floor(width * 0.595),
      y: Math.floor(height * 0.300),
      width: Math.floor(width * 0.315),
      height: Math.floor(height * 0.095),
      kind: 'backup-fwc-wide',
      score: 285,
    },
    {
      x: Math.floor(width * 0.590),
      y: Math.floor(height * 0.125),
      width: Math.floor(width * 0.255),
      height: Math.floor(height * 0.085),
      kind: 'backup-arg-tight',
      score: 300,
    },
    {
      x: Math.floor(width * 0.555),
      y: Math.floor(height * 0.110),
      width: Math.floor(width * 0.330),
      height: Math.floor(height * 0.115),
      kind: 'backup-arg-wide',
      score: 285,
    },
    {
      x: Math.floor(width * 0.500),
      y: Math.floor(height * 0.070),
      width: Math.floor(width * 0.440),
      height: Math.floor(height * 0.190),
      kind: 'backup-top-right',
      score: 210,
    },
    {
      x: Math.floor(width * 0.420),
      y: Math.floor(height * 0.220),
      width: Math.floor(width * 0.520),
      height: Math.floor(height * 0.220),
      kind: 'backup-mid-right',
      score: 190,
    },
  ].filter(region => isReadableZone(bitmap, region))
}

function detectCodeLabelCandidates(bitmap) {
  const backupCandidates = addBackupRegions(bitmap)

  const stickerBodyCandidates = detectComponents(bitmap, 'sticker-body')
  const lightBoxCandidates = detectComponents(bitmap, 'light-box')
  const darkBoxCandidates = detectComponents(bitmap, 'dark-box')

  const candidates = uniqueZones([
    ...backupCandidates,
    ...stickerBodyCandidates,
    ...darkBoxCandidates,
    ...lightBoxCandidates,
  ])
    .filter(candidate => isReadableZone(bitmap, candidate))

  const cleaned = removeOverlappingRegions(candidates)

  return cleaned
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_DEBUG_CANDIDATES)
}

function buildDebugReading(bitmap, candidate, index) {
  const safe = clampZone(bitmap, candidate)
  const meta = candidate.meta || {}

  const label = [
    `DBG${index + 1}`,
    candidate.kind || 'unknown',
    `score${Math.round(candidate.score || 0)}`,
    `x${safe.x}`,
    `y${safe.y}`,
    `w${safe.width}`,
    `h${safe.height}`,
    meta.ratio ? `r${meta.ratio}` : '',
    meta.fillRatio ? `fill${meta.fillRatio}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return {
    id: `debug-candidate-${index}`,
    confidence: Math.round(candidate.score || 0),

    // Importante: rawText simple para que classifyZoneReadings no rompa la UI.
    rawText: label,

    region: safe,
    thumbUrl: workerCanvasToUrl(bitmap, safe),
    manualCode: '',
  }
}

export async function analyzeStickerCodesFromImage(recognize, bitmap, stickers) {
  const candidates = detectCodeLabelCandidates(bitmap)

  if (DEBUG_DETECTOR) {
    console.log('DEBUG detector candidates:', candidates)
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
