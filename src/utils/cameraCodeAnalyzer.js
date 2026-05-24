import { classifyZoneReadings } from './ocrStickerCodes'

const DEBUG_OCR = true

const OCR_SCALE = 9
const OCR_MIN_WIDTH = 24
const OCR_MIN_HEIGHT = 9

const MAX_OCR_CANDIDATES = 15 // Reducido porque ahora somos mucho más precisos
const OCR_TIME_LIMIT_MS = 18000

const COMMON_FALLBACK_PREFIXES = [
  'FWC', 'MEX', 'RSA', 'KOR', 'CZE', 'CAN', 'BIH', 'QAT', 'SUI', 'HAI', 
  'SCO', 'USA', 'PAR', 'TUR', 'BRA', 'MAR', 'ARG', 'URU', 'COL', 'ESP', 
  'FRA', 'ENG', 'GER', 'POR', 'ITA', 'NED', 'BEL',
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
  return sticker?.code || sticker?.codigo || sticker?.id || sticker?.label || sticker?.number || ''
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
    if (directCode) output.push(String(directCode))
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
  const validPrefixes = validCodes.size ? detectedPrefixes : COMMON_FALLBACK_PREFIXES
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
    'FIFA', 'WORLD', 'CUP', '2026', 'OFFICIAL', 'LICENSED', 'PRODUCT',
    'PANINI', 'BRASIL', 'BRAZIL', 'MADE', 'WWW', 'COM', 'MANUFACTURED',
    'UNDER', 'LICENCE', 'LICENSE', 'TRADEMARKS', 'COPYRIGHTS',
    'TOURNAMENTS', 'EVENTS', 'LOGOS', 'BRAND', 'ELEMENTS', 'DESIGNS', 'NAMES',
  ]
  let clean = String(text || '').toUpperCase()
  stopWords.forEach(word => {
    clean = clean.replace(new RegExp(`\\b${word}\\b`, 'g'), ' ')
  })
  return clean
}

function buildTextCandidates(rawText) {
  const text = sanitizeText(rawText)
  const candidates = []

  text.split(/\n+/).map(line => line.trim()).filter(Boolean).forEach(line => {
    const spaced = line.replace(/[^A-Z0-9]+/g, ' ').trim()
    const compact = normalizeRaw(line)
    if (spaced && spaced.length <= 28) candidates.push(spaced)
    if (compact && compact.length <= 28) candidates.push(compact)
  })

  const compactFull = normalizeRaw(text)
  if (compactFull && compactFull.length <= 34) candidates.push(compactFull)

  return Array.from(new Set(candidates))
}

function extractValidCodesFromText(rawText, validStickerData) {
  const { validCodes, validPrefixes, hasCatalog } = validStickerData
  if (!validPrefixes.length) return []

  const prefixes = validPrefixes.map(escapeRegExp).join('|')
  const candidates = buildTextCandidates(rawText)
  const extractedCodes = []

  candidates.forEach(source => {
    const normalRegex = new RegExp(`(^|\\b)(${prefixes})\\s*([0-9OQDISBLZG]{1,3})($|\\b)`, 'g')
    const compactExactRegex = new RegExp(`^(${prefixes})([0-9OQDISBLZG]{1,3})$`)
    const compactStartRegex = new RegExp(`^(${prefixes})([0-9OQDISBLZG]{1,3})`)

    let match
    while ((match = normalRegex.exec(source)) !== null) {
      const number = normalizeNumberLike(match[3])
      if (!number) continue
      const code = normalizeStickerCode(`${match[2]}${number}`)
      if (!hasCatalog || validCodes.has(code)) extractedCodes.push(code)
    }

    const compact = normalizeRaw(source)
    const compactMatch = compact.match(compactExactRegex) || compact.match(compactStartRegex)
    if (compactMatch) {
      const number = normalizeNumberLike(compactMatch[2])
      if (number) {
        const code = normalizeStickerCode(`${compactMatch[1]}${number}`)
        if (!hasCatalog || validCodes.has(code)) extractedCodes.push(code)
      }
    }
  })

  return Array.from(new Set(extractedCodes))
}

function clampZone(bitmap, zone) {
  const x = Math.max(0, Math.min(Math.floor(zone?.x || 0), bitmap.width - 1))
  const y = Math.max(0, Math.min(Math.floor(zone?.y || 0), bitmap.height - 1))
  const width = Math.max(1, Math.min(Math.floor(zone?.width || 1), bitmap.width - x))
  const height = Math.max(1, Math.min(Math.floor(zone?.height || 1), bitmap.height - y))
  return { x, y, width, height }
}

function isReadableZone(bitmap, zone) {
  const safeZone = clampZone(bitmap, zone)
  return safeZone.width >= OCR_MIN_WIDTH && safeZone.height >= OCR_MIN_HEIGHT
}

function expandZone(bitmap, zone, amountX = 0.15, amountY = 0.25) {
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
      Math.round(zone?.x || 0), Math.round(zone?.y || 0),
      Math.round(zone?.width || 0), Math.round(zone?.height || 0)
    ].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function regionIoU(a, b) {
  const ix1 = Math.max(a.x, b.x)
  const iy1 = Math.max(a.y, b.y)
  const ix2 = Math.min(a.x + a.width, b.x + b.width)
  const iy2 = Math.min(a.y + a.height, b.y + b.height)
  
  const iw = Math.max(0, ix2 - ix1)
  const ih = Math.max(0, iy2 - iy1)
  
  const intersection = iw * ih
  const union = (a.width * a.height) + (b.width * b.height) - intersection
  return union ? intersection / union : 0
}

function removeOverlappingRegions(regions) {
  const sorted = [...regions].sort((a, b) => b.score - a.score)
  const kept = []
  sorted.forEach(region => {
    if (!kept.some(existing => regionIoU(existing, region) > 0.35)) {
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
  cx.drawImage(bitmap, safeZone.x, safeZone.y, safeZone.width, safeZone.height, 0, 0, safeZone.width, safeZone.height)
  return c.toDataURL('image/jpeg', 0.86)
}

function buildOcrCanvas(bitmap, zone, mode = 'original', scale = OCR_SCALE) {
  const safeZone = clampZone(bitmap, zone)
  if (!isReadableZone(bitmap, safeZone)) return null

  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.floor(safeZone.width * scale))
  c.height = Math.max(1, Math.floor(safeZone.height * scale))

  const ctx = c.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, safeZone.x, safeZone.y, safeZone.width, safeZone.height, 0, 0, c.width, c.height)

  if (mode === 'original') return c

  const imageData = ctx.getImageData(0, 0, c.width, c.height)
  const data = imageData.data
  let sum = 0

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round((data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114))
    data[i] = data[i + 1] = data[i + 2] = gray
    sum += gray
  }

  const avgGray = sum / Math.max(1, data.length / 4)

  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i]
    let value = gray

    if (mode === 'light-box-contrast') {
      // Fondo claro, letras oscuras. Todo lo oscuro se vuelve negro.
      value = gray < avgGray ? 0 : 255
    }
    if (mode === 'dark-box-invert') {
      // Fondo oscuro, letras blancas. Todo lo claro se vuelve negro (invertido para Tesseract)
      value = gray > avgGray ? 0 : 255
    }
    if (mode === 'contrast') {
      value = ((gray - avgGray) * 3.5) + avgGray
      value = Math.max(0, Math.min(255, value))
    }

    data[i] = data[i + 1] = data[i + 2] = value
  }

  ctx.putImageData(imageData, 0, 0)
  return c
}

async function runOcrAttempt(recognize, bitmap, candidate, mode, pageSegMode = 7) {
  const canvas = buildOcrCanvas(bitmap, candidate, mode, OCR_SCALE)
  if (!canvas || canvas.width < OCR_MIN_WIDTH || canvas.height < OCR_MIN_HEIGHT) {
    return { confidence: 0, text: '' }
  }

  try {
    const result = await recognize(canvas.toDataURL('image/png'), 'eng', {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
      tessedit_pageseg_mode: String(pageSegMode),
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    })
    return {
      confidence: Number(result?.data?.confidence ?? 0),
      text: String(result?.data?.text || ''),
    }
  } catch (error) {
    console.warn('OCR attempt failed:', error)
    return { confidence: 0, text: '' }
  }
}

function getPixelInfo(data, index) {
  const i = index * 4
  const gray = Math.round((data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114))
  const chroma = Math.max(data[i], data[i+1], data[i+2]) - Math.min(data[i], data[i+1], data[i+2])
  return { gray, chroma }
}

function createMaskClassifier(kind) {
  if (kind === 'light-box') {
    // Busca áreas blancas/grises claras (ej. cajitas de FWC 2)
    return ({ gray, chroma }) => gray >= 160 && chroma <= 60
  }
  if (kind === 'dark-box') {
    // Busca áreas grises oscuras (ej. cajita de ARG 17)
    return ({ gray, chroma }) => gray >= 45 && gray <= 145 && chroma <= 50
  }
  return () => false
}

function componentToBoxCandidate(bitmap, component, scale, kind, imageArea) {
  const boxW = component.maxX - component.minX + 1
  const boxH = component.maxY - component.minY + 1
  const area = boxW * boxH
  
  // CRÍTICO: Una "cajita" real es un bloque sólido de color, no letras o bordes.
  const fillRatio = component.count / Math.max(1, area)
  const ratio = boxW / Math.max(1, boxH)

  const originalX = Math.floor(component.minX / scale)
  const originalY = Math.floor(component.minY / scale)
  const originalW = Math.floor(boxW / scale)
  const originalH = Math.floor(boxH / scale)

  // Filtramos por proporciones de una etiqueta típica de estampa
  if (ratio < 1.8 || ratio > 4.8) return null
  if (fillRatio < 0.55) return null // Debe ser al menos 55% sólido

  const originalArea = originalW * originalH
  const imageAreaRatio = originalArea / Math.max(1, imageArea)

  // Evitamos capturar componentes enanos o media pantalla
  if (imageAreaRatio < 0.0005 || imageAreaRatio > 0.08) return null

  let score = 200 + (fillRatio * 100) // Premiamos los bloques más sólidos

  const baseZone = {
    x: originalX,
    y: originalY,
    width: originalW,
    height: originalH,
  }

  return {
    ...expandZone(bitmap, baseZone, 0.15, 0.25), // Expandimos suficiente para no cortar texto
    kind,
    score,
  }
}

function detectComponents(bitmap, kind, scale) {
  const w = Math.max(1, Math.floor(bitmap.width * scale))
  const h = Math.max(1, Math.floor(bitmap.height * scale))

  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, w, h)

  const data = ctx.getImageData(0, 0, w, h).data
  const visited = new Uint8Array(w * h)
  const isTargetPixel = createMaskClassifier(kind)
  const candidates = []
  const imageArea = bitmap.width * bitmap.height

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const start = y * w + x
      if (visited[start]) continue

      if (!isTargetPixel(getPixelInfo(data, start))) {
        visited[start] = 1
        continue
      }

      const stack = [start]
      visited[start] = 1

      let minX = x, maxX = x, minY = y, maxY = y, count = 0

      while (stack.length) {
        const current = stack.pop()
        const cx = current % w
        const cy = Math.floor(current / w)
        count += 1

        minX = Math.min(minX, cx)
        maxX = Math.max(maxX, cx)
        minY = Math.min(minY, cy)
        maxY = Math.max(maxY, cy)

        const neighbors = [current - 1, current + 1, current - w, current + w]
        neighbors.forEach(next => {
          if (next < 0 || next >= visited.length) return
          const nx = next % w, ny = Math.floor(next / w)
          if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1 || visited[next]) return

          if (!isTargetPixel(getPixelInfo(data, next))) {
            visited[next] = 1
            return
          }
          visited[next] = 1
          stack.push(next)
        })
      }

      const candidate = componentToBoxCandidate(bitmap, { minX, maxX, minY, maxY, count }, scale, kind, imageArea)
      if (candidate && isReadableZone(bitmap, candidate)) {
        candidates.push(candidate)
      }
    }
  }
  return candidates
}

function detectCodeLabelCandidates(bitmap) {
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height))

  const lightBoxCandidates = detectComponents(bitmap, 'light-box', scale)
  const darkBoxCandidates = detectComponents(bitmap, 'dark-box', scale)

  const candidates = uniqueZones([...lightBoxCandidates, ...darkBoxCandidates])
    .filter(candidate => isReadableZone(bitmap, candidate))

  return removeOverlappingRegions(candidates)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_OCR_CANDIDATES)
}

function dedupeReadings(readings) {
  const seenValid = new Set()
  return readings.filter(reading => {
    const rawText = normalizeStickerCode(reading.rawText)
    if (/^[A-Z]{3}\d{1,3}$/.test(rawText)) {
      if (seenValid.has(rawText)) return false
      seenValid.add(rawText)
      reading.rawText = rawText
    }
    return true
  })
}

function pickBestCandidateReadings(readings) {
  const grouped = new Map()
  readings.forEach(reading => {
    const code = normalizeStickerCode(reading.rawText)
    if (!/^[A-Z]{3}\d{1,3}$/.test(code)) return

    const score = Number(reading.confidence || 0) + Number(reading.candidateScore || 0) + Number(reading.repeatedScore || 0)
    const current = grouped.get(code)
    if (!current || score > current.score) {
      grouped.set(code, { score, reading: { ...reading, rawText: code } })
    }
  })
  return Array.from(grouped.values()).sort((a, b) => b.score - a.score).map(item => item.reading)
}

async function recognizeCandidate(recognize, bitmap, candidate, candidateIndex, validStickerData, startedAt) {
  // Ajustamos los modos basados estrictamente en si la cajita es clara u oscura
  const modes = candidate.kind === 'dark-box'
    ? [
        { mode: 'dark-box-invert', pageSegMode: 7 }, // Ideal para ARG 17
        { mode: 'contrast', pageSegMode: 7 },
        { mode: 'original', pageSegMode: 7 },
      ]
    : [
        { mode: 'light-box-contrast', pageSegMode: 7 }, // Ideal para FWC 2
        { mode: 'contrast', pageSegMode: 7 },
        { mode: 'original', pageSegMode: 7 },
      ]

  const readings = []
  const localHits = new Map()

  for (let i = 0; i < modes.length; i += 1) {
    if (Date.now() - startedAt > OCR_TIME_LIMIT_MS) break

    const attempt = modes[i]
    const result = await runOcrAttempt(recognize, bitmap, candidate, attempt.mode, attempt.pageSegMode)

    if (DEBUG_OCR) {
      console.log(`OCR candidato ${candidateIndex} ${candidate.kind} modo ${attempt.mode}:`, result.text.replace(/\n+/g, ' '))
    }

    const extractedCodes = extractValidCodesFromText(result.text, validStickerData)
    extractedCodes.forEach(code => {
      localHits.set(code, (localHits.get(code) || 0) + 1)
      readings.push({
        id: `candidate-${candidateIndex}-${i}-${code}`,
        confidence: Number(result.confidence || 0),
        candidateScore: Number(candidate.score || 0),
        repeatedScore: (localHits.get(code) || 1) * 20,
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

  const candidates = detectCodeLabelCandidates(bitmap)

  if (DEBUG_OCR) {
    console.log('OCR candidates detectados (Cajitas):', candidates)
  }

  const allReadings = []

  for (let i = 0; i < candidates.length; i += 1) {
    if (Date.now() - startedAt > OCR_TIME_LIMIT_MS) break
    const candidateReadings = await recognizeCandidate(recognize, bitmap, candidates[i], i, validStickerData, startedAt)
    allReadings.push(...candidateReadings)
  }

  const bestReadings = pickBestCandidateReadings(dedupeReadings(allReadings))

  return {
    grouped: classifyZoneReadings(bestReadings, stickers),
    regions: candidates.map(c => ({ x: c.x, y: c.y, width: c.width, height: c.height })),
  }
}
