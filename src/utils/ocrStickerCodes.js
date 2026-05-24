function normalizeRawToken(token) {
  return String(token || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

function buildTeamRanges(stickers) {
  const rangeMap = {}

  stickers.forEach((sticker) => {
    const code = String(sticker.code || '').toUpperCase()
    const match = code.match(/^([A-Z]{3})(\d{1,2})$/)
    if (!match) {
      return
    }

    const [, prefix, numberText] = match
    const number = Number(numberText)

    if (!Number.isFinite(number)) {
      return
    }

    const current = rangeMap[prefix]

    if (!current) {
      rangeMap[prefix] = { min: number, max: number }
      return
    }

    current.min = Math.min(current.min, number)
    current.max = Math.max(current.max, number)
  })

  return rangeMap
}

function buildVariantCandidates(rawText, validPrefixes) {
  const normalizedText = String(rawText || '').toUpperCase()
  const compactText = normalizedText.replace(/[^A-Z0-9]/g, '')
  const candidates = new Set()

  const directMatches = compactText.match(/[A-Z]{3}\d{1,2}/g) || []
  directMatches.forEach((match) => candidates.add(normalizeRawToken(match)))

  const withSpaceMatches = normalizedText.match(/[A-Z]{2,3}\s{1,3}\d{1,2}/g) || []
  withSpaceMatches.forEach((match) => candidates.add(normalizeRawToken(match)))

  const splitPairs = compactText.match(/[A-Z]{2}\d{1,2}/g) || []
  splitPairs.forEach((pair) => {
    const prefix2 = pair.slice(0, 2)
    const number = pair.slice(2)

    validPrefixes.forEach((prefix3) => {
      if (prefix3.startsWith(prefix2)) {
        candidates.add(`${prefix3}${number}`)
      }
    })
  })

  return [...candidates]
}

export function classifyDetectedCodes({ text, words = [], stickers, minConfidence = 60 }) {
  const validCodeSet = new Set(stickers.map((item) => String(item.code || '').toUpperCase()))
  const teamRanges = buildTeamRanges(stickers)
  const validPrefixes = Object.keys(teamRanges)
  const groupedByCode = new Map()

  words.forEach((word) => {
    const confidence = Number(word?.confidence ?? 0)
    const variants = buildVariantCandidates(word?.text || '', validPrefixes)
    variants.forEach((candidate) => {
      if (!groupedByCode.has(candidate)) {
        groupedByCode.set(candidate, [])
      }
      groupedByCode.get(candidate).push({ source: word?.text || '', confidence })
    })
  })

  const fallbackVariants = buildVariantCandidates(text || '', validPrefixes)
  fallbackVariants.forEach((candidate) => {
    if (!groupedByCode.has(candidate)) {
      groupedByCode.set(candidate, [{ source: candidate, confidence: 50 }])
    }
  })

  const good = []
  const review = []
  const invalid = []

  groupedByCode.forEach((hits, code) => {
    const bestConfidence = Math.max(...hits.map((hit) => hit.confidence || 0), 0)
    const prefixMatch = code.match(/^([A-Z]{3})(\d{1,2})$/)

    if (!prefixMatch) {
      invalid.push({ code, reason: 'Formato inválido', confidence: bestConfidence })
      return
    }

    const [, prefix, numberText] = prefixMatch
    const number = Number(numberText)
    const range = teamRanges[prefix]

    if (!range) {
      invalid.push({ code, reason: 'Prefijo no válido para este álbum', confidence: bestConfidence })
      return
    }

    if (number < range.min || number > range.max) {
      invalid.push({ code, reason: `Número fuera de rango (${range.min}-${range.max})`, confidence: bestConfidence })
      return
    }

    if (!validCodeSet.has(code)) {
      review.push({ code, reason: 'Código cercano pero no exacto, revisar manualmente', confidence: bestConfidence })
      return
    }

    if (bestConfidence >= minConfidence) {
      good.push({ code, confidence: bestConfidence })
    } else {
      review.push({ code, reason: 'Confianza baja, revisar manualmente', confidence: bestConfidence })
    }
  })

  const sortByCode = (a, b) => a.code.localeCompare(b.code)

  return {
    good: good.sort(sortByCode),
    review: review.sort(sortByCode),
    invalid: invalid.sort(sortByCode),
  }
}
