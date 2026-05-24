import { classifyZoneReadings } from './ocrStickerCodes'

const DEBUG_OCR = false

const OCR_SCALE = 6
const OCR_MIN_WIDTH = 34
const OCR_MIN_HEIGHT = 14

const MAX_OCR_CANDIDATES = 14
const OCR_TIME_LIMIT_MS = 18000

const COMMON_FALLBACK_PREFIXES = [
  'FWC',
  'MEX',
  'RSA',
  'KOR',
  'CZE',
  'CAN',
  'BIH',
  'QAT',
  'SUI',
  'HAI',
  'SCO',
  'USA',
  'PAR',
  'TUR',
  'BRA',
  'MAR',
  'ARG',
  'URU',
  'COL',
  'ESP',
  'FRA',
  'ENG',
  'GER',
  'POR',
  'ITA',
  'NED',
  'BEL',
]

function normalizeRaw(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function normalizeStickerCode(value) {
  const raw = normalizeRaw(value)
  const match = raw.match(/^([A-Z]{3})0*(\d{1,3})$/)

  if (!match) return raw

  return `${match[1]}${Number(match[2])}`
}

function normalizeNumberLike(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[OQD]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/G/g, '6')
    .replace(/[^0-9]/g, '')
}

function getStickerCode(sticker) {
  if (typeof sticker === 'string') return sticker
  if (typeof sticker === 'number') return String(sticker)

  return (
    sticker?.code ||
    sticker?.codigo ||
    sticker?.id ||
    sticker?.label ||
    sticker?.number ||
    ''
  )
}

function collectStickerCodes(input, output = []) {
  if (!input) return output

  if (typeof input === 'string' || typeof input === 'number') {
    output.push(String(input))
    return output
  }

  if (Array.isArray(input)) {
    input.forEach(item => collectStickerCodes(item, output))
    return output
  }

  if (typeof input === 'object') {
    const directCode = getStickerCode(input)

    if (directCode) {
      output.push(String(directCode))
    }

    Object.entries(input).forEach(([key, value]) => {
      output.push(String(key))
      collectStickerCodes(value, output)
    })
  }

  return output
}

function buildValidStickerData(stickers) {
  const stickerCodes = collectStickerCodes(stickers)

  const validCodes = new Set(
    stickerCodes
      .map(normalizeStickerCode)
      .filter(code => /^[A-Z]{3}\d{1,3}$/.test(code))
  )

  const detectedPrefixes = Array.from(
    new Set(
      Array.from(validCodes)
        .map(code => code.match(/^([A-Z]{3})\d+$/)?.[1])
        .filter(Boolean)
    )
  )

  const validPrefixes = validCodes.size
    ? detectedPrefixes
    : COMMON_FALLBACK_PREFIXES

  return {
    validCodes,
    validPrefixes,
    hasCatalog: validCodes.size > 0,
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sanitizeText(text) {
  const stopWords = [
    'FIFA',
    'WORLD',
    'CUP',
    '2026',
    'PARTE',
    'INTEGRANTE',
    'CROMO',
    'LIVRO',
    'ILUSTRADO',
    'COLECIONAR',
    'PUNTOS',
    'VENTA',
    'OFFICIAL',
    'LICENSED',
    'PRODUCT',
    'LOGOS',
    'BRAND',
    'ELEMENTS',
    'DESIGNS',
    'TRADE',
    'NAMES',
    'TOURNAMENTS',
    'EVENTS',
    'COPYRIGHTS',
    'TRADEMARKS',
    'MANUFACTURED',
    'UNDER',
    'LICENCE',
    'LICENSE',
    'MADE',
    'BRAZIL',
    'PANINI',
    'BRASIL',
    'LTDA',
    'WWW',
    'COM',
  ]

  let clean = String(text || '').toUpperCase()

  stopWords.forEach(word => {
    clean = clean.replace(new RegExp(`\\b${word}\\b`, 'g'), ' ')
  })

  return clean
}

function buildTextCandidates(rawText) {
  const text = String(rawText || '').toUpperCase()
  const cleanText = sanitizeText(text)

  const lines = cleanText
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)

  const candidates = []

  lines.forEach(line => {
    const spaced = line.replace(/[^A-Z0-9]+/g, ' ').trim()
    const compact = normalizeRaw(line)

    if (spaced && spaced.length <= 18) {
      candidates.push(spaced)
    }

    if (compact && compact.length <= 18) {
      candidates.push(compact)
    }
  })

  const compactFull = normalizeRaw(cleanText)

  if (compactFull && compactFull.length <= 24) {
    candidates.push(compactFull)
  }

  return Array.from(new Set(candidates))
}

function extractValidCodesFromText(rawText, validStickerData) {
  const {
    validCodes,
    validPrefixes,
    hasCatalog,
  } = validStickerData

  if (!validPrefixes.length) {
    return []
  }

  const prefixes = validPrefixes.map(escapeRegExp).join('|')
  const candidates = buildTextCandidates(rawText)
  const extractedCodes = []

  candidates.forEach(source => {
    const normalRegex = new RegExp(
      `(^|\\b)(${prefixes})\\s*([0-9OQDISBLZG]{1,3})($|\\b)`,
      'g'
    )

    const compactStartRegex = new RegExp(
      `^(${prefixes})([0-9OQDISBLZG]{1,3})`
    )

    let match

    while ((match = normalRegex.exec(source)) !== null) {
      const prefix = match[2]
      const number = normalizeNumberLike(match[3])

      if (!number) continue

      const code = normalizeStickerCode(`${prefix}${number}`)

      if (!hasCatalog || validCodes.has(code)) {
        extractedCodes.push(code)
      }
    }

    const compact = normalizeRaw(source)
    const compactMatch = compact.match(compactStartRegex)

    if (compactMatch) {
      const prefix = compactMatch[1]
      const number = normalizeNumberLike(compactMatch[2])

      if (number) {
        const code = normalizeStickerCode(`${prefix}${number}`)

        if (!hasCatalog || validCodes.has(code)) {
          extractedCodes.push(code)
        }
      }
    }
  })

  return Array.from(new Set(extractedCodes))
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
    x,
    y,
    width,
    height,
  }
}

function isReadableZone(bitmap, zone) {
  const safeZone = clampZone(bitmap, zone)

  return (
    safeZone.width >= OCR_MIN_WIDTH &&
    safeZone.height >= OCR_MIN_HEIGHT
  )
}

function expandZone(bitmap, zone, amountX = 0.35, amountY = 0.45) {
  const safeZone = clampZone(bitmap, zone)

  const extraX = Math.floor(safeZone.width * amountX)
  const extraY = Math.floor(safeZone.height * amountY)

  return clampZone(bitmap, {
    x: safeZone.x - extraX,
    y: safeZone.y - extraY,
    width: safeZone.width + extraX * 2,
    height: safeZone.height + extraY * 2,
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
    const overlaps = kept.some(existing => regionIoU(existing, region) > 0.35)

    if (!overlaps) {
      kept.push(region)
    }
  })

  return kept
}

function workerCanvasToUrl(bitmap, zone) {
  const safeZone = clampZone(bitmap, zone)

  const c = document.createElement('canvas')
  c.width = safeZone.width
  c.height = safeZone.height

  const cx = c.getContext('2d')

  cx.drawImage(
    bitmap,
    safeZone.x,
    safeZone.y,
    safeZone.width,
    safeZone.height,
    0,
    0,
    safeZone.width,
    safeZone.height
  )

  return c.toDataURL('image/jpeg', 0.86)
}

function buildOcrCanvas(bitmap, zone, mode = 'light', scale = OCR_SCALE) {
  const safeZone = clampZone(bitmap, zone)

  if (!isReadableZone(bitmap, safeZone)) {
    return null
  }

  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.floor(safeZone.width * scale))
  c.height = Math.max(1, Math.floor(safeZone.height * scale))

  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  ctx.drawImage(
    bitmap,
    safeZone.x,
    safeZone.y,
    safeZone.width,
    safeZone.height,
    0,
    0,
    c.width,
    c.height
  )

  if (mode === 'original') {
    return c
  }

  const imageData = ctx.getImageData(0, 0, c.width, c.height)
  const data = imageData.data

  let sum = 0

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round((data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114))

    data[i] = gray
    data[i + 1] = gray
    data[i + 2] = gray

    sum += gray
  }

  const pixelCount = Math.max(1, data.length / 4)
  const avgGray = sum / pixelCount

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i]
    let value = gray

    if (mode === 'contrast') {
      value = ((gray - avgGray) * 2.8) + avgGray
      value = Math.max(0, Math.min(255, value))
    }

    if (mode === 'light') {
      // Fondo claro + letras grises/oscuras.
      value = gray > avgGray ? 255 : 0
    }

    if (mode === 'dark') {
      // Fondo gris/oscuro + letras blancas.
      // Se invierte para que Tesseract vea letras negras sobre fondo blanco.
      value = gray > avgGray ? 0 : 255
    }

    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
  }

  ctx.putImageData(imageData, 0, 0)

  return c
}

async function runOcrAttempt(recognize, bitmap, candidate, mode, pageSegMode = 7) {
  const canvas = buildOcrCanvas(bitmap, candidate, mode, OCR_SCALE)

  if (!canvas || canvas.width < OCR_MIN_WIDTH || canvas.height < OCR_MIN_HEIGHT) {
    return {
      confidence: 0,
      text: '',
    }
  }

  const imageDataUrl = canvas.toDataURL('image/png')

  try {
    const result = await recognize(imageDataUrl, 'eng', {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
      tessedit_pageseg_mode: String(pageSegMode),
      preserve_interword_spaces: '1',
    })

    return {
      confidence: Number(result?.data?.confidence ?? 0),
      text: String(result?.data?.text || ''),
    }
  } catch (error) {
    console.warn('OCR attempt failed:', error)

    return {
      confidence: 0,
      text: '',
    }
  }
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
  if (kind === 'light') {
    return ({ gray, chroma }) => (
      gray >= 145 &&
      gray <= 255 &&
      chroma <= 58
    )
  }

  return ({ gray, chroma }) => (
    gray >= 55 &&
    gray <= 185 &&
    chroma <= 50
  )
}

function componentToCandidate(bitmap, component, scale, kind, imageArea) {
  const boxW = component.maxX - component.minX + 1
  const boxH = component.maxY - component.minY + 1
  const area = boxW * boxH
  const fillRatio = component.count / Math.max(1, area)
  const ratio = boxW / Math.max(1, boxH)

  const originalX = Math.floor(component.minX / scale)
  const originalY = Math.floor(component.minY / scale)
  const originalW = Math.floor(boxW / scale)
  const originalH = Math.floor(boxH / scale)

  if (originalW < 28 || originalH < 10) return null
  if (originalW > bitmap.width * 0.42) return null
  if (originalH > bitmap.height * 0.18) return null

  if (ratio < 1.25 || ratio > 9.5) return null
  if (fillRatio < 0.18) return null

  const originalArea = originalW * originalH
  const imageAreaRatio = originalArea / Math.max(1, imageArea)

  if (imageAreaRatio < 0.00025 || imageAreaRatio > 0.04) return null

  let score = 100

  score -= Math.abs(ratio - 3.4) * 6
  score += Math.min(20, fillRatio * 18)

  if (kind === 'light') score += 6
  if (kind === 'dark') score += 10

  if (originalH >= 14 && originalH <= 70) score += 8
  if (originalW >= 45 && originalW <= 230) score += 8

  const expanded = expandZone(
    bitmap,
    {
      x: originalX,
      y: originalY,
      width: originalW,
      height: originalH,
    },
    0.45,
    0.75
  )

  return {
    ...expanded,
    kind,
    score,
  }
}

function detectComponents(bitmap, kind) {
  const maxW = 520
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

      const candidate = componentToCandidate(
        bitmap,
        component,
        scale,
        kind,
        imageArea
      )

      if (candidate && isReadableZone(bitmap, candidate)) {
        candidates.push(candidate)
      }
    }
  }

  return candidates
}

function detectCodeLabelCandidates(bitmap) {
  const lightCandidates = detectComponents(bitmap, 'light')
  const darkCandidates = detectComponents(bitmap, 'dark')

  const candidates = uniqueZones([
    ...lightCandidates,
    ...darkCandidates,
  ])
    .filter(candidate => isReadableZone(bitmap, candidate))

  const cleaned = removeOverlappingRegions(candidates)

  return cleaned
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_OCR_CANDIDATES)
}

function dedupeReadings(readings) {
  const seenValid = new Set()
  const result = []

  readings.forEach(reading => {
    const rawText = normalizeStickerCode(reading.rawText)

    if (/^[A-Z]{3}\d{1,3}$/.test(rawText)) {
      if (seenValid.has(rawText)) return

      seenValid.add(rawText)

      result.push({
        ...reading,
        rawText,
      })

      return
    }

    result.push(reading)
  })

  return result
}

function pickBestCandidateReadings(readings) {
  const grouped = new Map()

  readings.forEach(reading => {
    const code = normalizeStickerCode(reading.rawText)

    if (!/^[A-Z]{3}\d{1,3}$/.test(code)) return

    const current = grouped.get(code)

    const score = (
      Number(reading.confidence || 0) +
      Number(reading.candidateScore || 0) +
      Number(reading.repeatedScore || 0)
    )

    if (!current || score > current.score) {
      grouped.set(code, {
        score,
        reading: {
          ...reading,
          rawText: code,
        },
      })
    }
  })

  return Array.from(grouped.values())
    .sort((a, b) => b.score - a.score)
    .map(item => item.reading)
}

async function recognizeCandidate(recognize, bitmap, candidate, candidateIndex, validStickerData, startedAt) {
  const modes = candidate.kind === 'dark'
    ? [
        { mode: 'dark', pageSegMode: 7 },
        { mode: 'contrast', pageSegMode: 7 },
      ]
    : [
        { mode: 'light', pageSegMode: 7 },
        { mode: 'contrast', pageSegMode: 7 },
      ]

  const readings = []
  const localHits = new Map()

  for (let i = 0; i < modes.length; i += 1) {
    if (Date.now() - startedAt > OCR_TIME_LIMIT_MS) break

    const attempt = modes[i]

    // eslint-disable-next-line no-await-in-loop
    const result = await runOcrAttempt(
      recognize,
      bitmap,
      candidate,
      attempt.mode,
      attempt.pageSegMode
    )

    if (DEBUG_OCR && result.text) {
      console.log(
        `OCR candidato ${candidateIndex} ${candidate.kind} modo ${attempt.mode}:`,
        result.text.replace(/\n+/g, ' ')
      )
    }

    const extractedCodes = extractValidCodesFromText(result.text, validStickerData)

    extractedCodes.forEach(code => {
      localHits.set(code, (localHits.get(code) || 0) + 1)

      readings.push({
        id: `candidate-${candidateIndex}-${i}-${code}`,
        confidence: Number(result.confidence || 0),
        candidateScore: Number(candidate.score || 0),
        repeatedScore: (localHits.get(code) || 1) * 15,
        rawText: code,
        region: candidate,
        thumbUrl: workerCanvasToUrl(bitmap, candidate),
        manualCode: '',
      })
    })
  }

  return readings
}

export async function analyzeStickerCodesFromImage(recognize, bitmap, stickers) {
  const startedAt = Date.now()
  const validStickerData = buildValidStickerData(stickers)

  if (DEBUG_OCR) {
    console.log('OCR validCodes:', Array.from(validStickerData.validCodes))
    console.log('OCR validPrefixes:', validStickerData.validPrefixes)
    console.log('OCR hasCatalog:', validStickerData.hasCatalog)
  }

  const candidates = detectCodeLabelCandidates(bitmap)

  if (DEBUG_OCR) {
    console.log('OCR candidates:', candidates)
  }

  const allReadings = []

  for (let i = 0; i < candidates.length; i += 1) {
    if (Date.now() - startedAt > OCR_TIME_LIMIT_MS) break

    // eslint-disable-next-line no-await-in-loop
    const candidateReadings = await recognizeCandidate(
      recognize,
      bitmap,
      candidates[i],
      i,
      validStickerData,
      startedAt
    )

    allReadings.push(...candidateReadings)
  }

  const bestReadings = pickBestCandidateReadings(
    dedupeReadings(allReadings)
  )

  return {
    grouped: classifyZoneReadings(bestReadings, stickers),
    regions: candidates.map(candidate => ({
      x: candidate.x,
      y: candidate.y,
      width: candidate.width,
      height: candidate.height,
    })),
  }
}
