export const FIGURITAS_PREFIX = '⋋~'
const BASE_BLOCK_BYTES = 123
const COCA_COLA_BLOCK_BYTES = 125
const BASE_REAL_STICKERS = 980
const COCA_COLA_REAL_STICKERS = 994
const GZIP_BASE64_MARKER = 'H4sI'
const VALID_BLOCK_BYTE_LENGTHS = [BASE_BLOCK_BYTES, COCA_COLA_BLOCK_BYTES]

export const QR_EXCHANGE_ERROR =
  'No se pudo leer este código de intercambio. Verifica que sea un QR de Figuritas App - Usa Méx Can 26.'

export const EXCHANGE_COUNTRIES = [
  'MEX', 'RSA', 'KOR', 'CZE', 'CAN', 'BIH', 'QAT', 'SUI',
  'BRA', 'MAR', 'HAI', 'SCO', 'USA', 'PAR', 'AUS', 'TUR',
  'GER', 'CUW', 'CIV', 'ECU', 'NED', 'JPN', 'SWE', 'TUN',
  'BEL', 'EGY', 'IRN', 'NZL', 'ESP', 'CPV', 'KSA', 'URU',
  'FRA', 'SEN', 'IRQ', 'NOR', 'ARG', 'ALG', 'AUT', 'JOR',
  'POR', 'COD', 'UZB', 'COL', 'ENG', 'CRO', 'GHA', 'PAN',
]

export function getBit(bytes, index) {
  const byteIndex = Math.floor(index / 8)
  const bitIndex = index % 8
  return (bytes[byteIndex] & (1 << bitIndex)) !== 0
}

export function setBit(bytes, index) {
  const byteIndex = Math.floor(index / 8)
  const bitIndex = index % 8
  bytes[byteIndex] |= 1 << bitIndex
}

export function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }

  return btoa(binary)
}

export function base64ToBytes(base64Text) {
  const binary = atob(base64Text)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function gzipBytes(bytes) {
  if (!('CompressionStream' in globalThis)) {
    throw new Error('Tu navegador no permite generar gzip desde la app.')
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzipBytes(bytes) {
  if (!('DecompressionStream' in globalThis)) {
    throw new Error(QR_EXCHANGE_ERROR)
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function bytesToGzipBase64(bytes) {
  return bytesToBase64(await gzipBytes(bytes))
}

export async function gzipBase64ToBytes(base64Text) {
  return gunzipBytes(base64ToBytes(base64Text))
}

export function extractFiguritasPayload(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Texto QR vacío')
  }

  const start = rawText.indexOf(GZIP_BASE64_MARKER)
  if (start === -1) {
    throw new Error('No se encontró H4sI en el QR')
  }

  const payload = rawText.slice(start).trim()
  const parts = payload.split(';')

  if (parts.length < 2) {
    throw new Error('El QR no contiene dos bloques separados por ;')
  }

  return {
    missingBlockBase64: parts[0].replace(/\s+/g, ''),
    duplicatesBlockBase64: parts[1].replace(/\s+/g, ''),
    partCount: parts.length,
  }
}

function assertValidBlockSizes(missingBytes, duplicatesBytes) {
  if (!VALID_BLOCK_BYTE_LENGTHS.includes(missingBytes.length)) {
    throw new Error(`Tamaño inválido de bloque faltantes: ${missingBytes.length}`)
  }

  if (!VALID_BLOCK_BYTE_LENGTHS.includes(duplicatesBytes.length)) {
    throw new Error(`Tamaño inválido de bloque repetidas: ${duplicatesBytes.length}`)
  }

  if (missingBytes.length !== duplicatesBytes.length) {
    throw new Error('Los bloques de faltantes y repetidas no tienen el mismo tamaño')
  }
}

export function countActiveBits(bytes, realStickerCount = bytes.length * 8) {
  let count = 0

  for (let index = 0; index < realStickerCount; index += 1) {
    if (getBit(bytes, index)) {
      count += 1
    }
  }

  return count
}

export function indexToStickerId(index) {
  return canonicalIdForIndex(index)
}

export function stickerIdToIndex(stickerId) {
  return indexForCanonicalId(stickerId)
}

export function canonicalIdForIndex(index) {
  if (index === 0) {
    return 'FWC00'
  }

  if (index > 0 && index < 20) {
    return `FWC${index}`
  }

  if (index >= 20 && index < BASE_REAL_STICKERS) {
    const countryIndex = Math.floor((index - 20) / 20)
    const stickerNumber = ((index - 20) % 20) + 1
    return `${EXCHANGE_COUNTRIES[countryIndex]}${stickerNumber}`
  }

  if (index >= BASE_REAL_STICKERS && index < COCA_COLA_REAL_STICKERS) {
    return `COCA_COLA${index - BASE_REAL_STICKERS + 1}`
  }

  return `DESCONOCIDA_${index}`
}

export function indexForCanonicalId(code) {
  if (code === '00' || code === 'FWC00') {
    return 0
  }

  const fwcMatch = /^FWC(\d+)$/.exec(code)
  if (fwcMatch) {
    const number = Number(fwcMatch[1])
    return number >= 1 && number <= 19 ? number : null
  }

  const cocaMatch = /^COCA_COLA(\d+)$/.exec(code)
  if (cocaMatch) {
    const number = Number(cocaMatch[1])
    return number >= 1 && number <= 14 ? BASE_REAL_STICKERS + number - 1 : null
  }

  const countryMatch = /^([A-Z]{3})(\d{1,2})$/.exec(code)
  if (!countryMatch) {
    return null
  }

  const countryIndex = EXCHANGE_COUNTRIES.indexOf(countryMatch[1])
  const stickerNumber = Number(countryMatch[2])

  if (countryIndex === -1 || stickerNumber < 1 || stickerNumber > 20) {
    return null
  }

  return 20 + countryIndex * 20 + stickerNumber - 1
}

export function appCodeToCanonicalId(code) {
  return code === '00' ? 'FWC00' : code
}

export function canonicalIdToAppCode(code) {
  return code === 'FWC00' ? '00' : code
}

function realStickerCountForBytes(bytes) {
  if (bytes.length <= BASE_BLOCK_BYTES) {
    return BASE_REAL_STICKERS
  }

  if (bytes.length <= COCA_COLA_BLOCK_BYTES) {
    return COCA_COLA_REAL_STICKERS
  }

  return bytes.length * 8
}

function activeIdsFromBytes(bytes) {
  const realStickerCount = realStickerCountForBytes(bytes)
  const ids = []
  const unknownIds = []

  for (let index = 0; index < realStickerCount; index += 1) {
    if (!getBit(bytes, index)) {
      continue
    }

    const code = canonicalIdForIndex(index)
    ids.push(code)

    if (code.startsWith('DESCONOCIDA_')) {
      unknownIds.push(code)
    }
  }

  return { ids, unknownIds, realStickerCount, totalBits: bytes.length * 8 }
}

export async function decodeFiguritasQrPayload(rawText) {
  try {
    const { missingBlockBase64, duplicatesBlockBase64, partCount } = extractFiguritasPayload(rawText)
    const missingBytes = await gzipBase64ToBytes(missingBlockBase64)
    const duplicatesBytes = await gzipBase64ToBytes(duplicatesBlockBase64)

    assertValidBlockSizes(missingBytes, duplicatesBytes)

    const missing = activeIdsFromBytes(missingBytes)
    const duplicates = activeIdsFromBytes(duplicatesBytes)
    const debug = {
      textStart: String(rawText || '').slice(0, 20),
      textLength: String(rawText || '').length,
      partCount,
      missingBlockBytes: missingBytes.length,
      duplicatesBlockBytes: duplicatesBytes.length,
      activeMissingBits: countActiveBits(missingBytes, missing.realStickerCount),
      activeDuplicateBits: countActiveBits(duplicatesBytes, duplicates.realStickerCount),
    }

    return {
      rawText,
      theirMissing: missing.ids,
      theirDuplicates: duplicates.ids,
      missing: missing.ids,
      duplicates: duplicates.ids,
      unknownIds: Array.from(new Set([...missing.unknownIds, ...duplicates.unknownIds])),
      blockBytes: {
        missing: missingBytes.length,
        duplicates: duplicatesBytes.length,
      },
      totalBits: Math.max(missing.totalBits, duplicates.totalBits),
      realStickerCount: Math.max(missing.realStickerCount, duplicates.realStickerCount),
      hasCocaCola: missing.realStickerCount >= COCA_COLA_REAL_STICKERS || duplicates.realStickerCount >= COCA_COLA_REAL_STICKERS,
      debug,
    }
  } catch (error) {
    throw new Error(error.message || QR_EXCHANGE_ERROR, { cause: error })
  }
}

export async function decodeExchangeText(rawText) {
  return decodeFiguritasQrPayload(rawText)
}


export function buildMyExchangeSets(stickers, collection, options = {}) {
  const minDuplicateCopies = Math.max(1, Number(options.minDuplicateCopies) || 1)
  const myMissing = []
  const myDuplicates = []

  stickers.forEach((sticker) => {
    const state = collection[sticker.code]
    const canonicalCode = appCodeToCanonicalId(sticker.code)

    if (!state?.owned) {
      myMissing.push(canonicalCode)
    }

    if ((state?.duplicates ?? 0) >= minDuplicateCopies) {
      myDuplicates.push(canonicalCode)
    }
  })

  return { myMissing, myDuplicates }
}

export function compareExchange({ myMissing, myDuplicates, theirMissing, theirDuplicates }) {
  const myMissingSet = new Set(myMissing)
  const myDuplicatesSet = new Set(myDuplicates)
  const theirMissingSet = new Set(theirMissing)
  const theirDuplicatesSet = new Set(theirDuplicates)

  return {
    theyCanGiveMe: Array.from(theirDuplicatesSet).filter((code) => myMissingSet.has(code)),
    iCanGiveThem: Array.from(myDuplicatesSet).filter((code) => theirMissingSet.has(code)),
  }
}

export async function encodeFiguritasQrPayload({ missingIds, duplicateIds, includeCocaCola = false }) {
  const allIds = [...missingIds, ...duplicateIds]
  const needsCocaCola = includeCocaCola || allIds.some((code) => {
    const index = indexForCanonicalId(code)
    return index !== null && index >= BASE_REAL_STICKERS && index < COCA_COLA_REAL_STICKERS
  })
  const blockBytes = needsCocaCola ? COCA_COLA_BLOCK_BYTES : BASE_BLOCK_BYTES
  const realStickerLimit = needsCocaCola ? COCA_COLA_REAL_STICKERS : BASE_REAL_STICKERS
  const missingBytes = new Uint8Array(blockBytes)
  const duplicateBytes = new Uint8Array(blockBytes)

  missingIds.forEach((code) => {
    const index = indexForCanonicalId(code)
    if (index !== null && index < realStickerLimit) {
      setBit(missingBytes, index)
    }
  })

  duplicateIds.forEach((code) => {
    const index = indexForCanonicalId(code)
    if (index !== null && index < realStickerLimit) {
      setBit(duplicateBytes, index)
    }
  })

  const [base64Faltantes, base64Repetidas] = await Promise.all([
    bytesToGzipBase64(missingBytes),
    bytesToGzipBase64(duplicateBytes),
  ])
  const qrText = FIGURITAS_PREFIX + base64Faltantes + ';' + base64Repetidas

  console.log('QR prefix:', qrText.slice(0, 2))
  console.log('First code point:', qrText.codePointAt(0)?.toString(16))
  console.log('Faltantes usados para QR:', missingIds)
  console.log('Repetidas usadas para QR:', Array.from(new Set(duplicateIds)))
  console.log('Bits activos faltantes:', countActiveBits(missingBytes, realStickerLimit))
  console.log('Bits activos repetidas:', countActiveBits(duplicateBytes, realStickerLimit))

  return {
    qrText,
    missingBytes,
    duplicateBytes,
    blockBytes,
    realStickerLimit,
  }
}

export async function encodeExchangeText({ missingIds, duplicateIds, includeCocaCola = false }) {
  const { qrText } = await encodeFiguritasQrPayload({ missingIds, duplicateIds, includeCocaCola })
  return qrText
}


export function buildQrImageUrl(text) {
  const params = new URLSearchParams({
    data: text,
    size: '320x320',
    ecc: 'M',
    margin: '12',
  })

  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`
}
