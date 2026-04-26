function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function buildTeamLookup(teams) {
  return Object.fromEntries(
    teams.map((team) => [
      team.teamCode,
      {
        teamCode: team.teamCode,
        title: team.teamNameEs || team.teamName || team.teamCode,
        shortLabel: team.teamCode,
      },
    ]),
  )
}

const teamCodeToFlagCode = {
  ALG: 'dz',
  ARG: 'ar',
  AUS: 'au',
  AUT: 'at',
  BEL: 'be',
  BIH: 'ba',
  BRA: 'br',
  CAN: 'ca',
  CIV: 'ci',
  COD: 'cd',
  COL: 'co',
  CPV: 'cv',
  CRO: 'hr',
  CUW: 'cw',
  CZE: 'cz',
  ECU: 'ec',
  EGY: 'eg',
  ENG: 'gb-eng',
  ESP: 'es',
  FRA: 'fr',
  GER: 'de',
  GHA: 'gh',
  HAI: 'ht',
  IRN: 'ir',
  IRQ: 'iq',
  JOR: 'jo',
  JPN: 'jp',
  KOR: 'kr',
  KSA: 'sa',
  MAR: 'ma',
  MEX: 'mx',
  NED: 'nl',
  NOR: 'no',
  NZL: 'nz',
  PAN: 'pa',
  PAR: 'py',
  POR: 'pt',
  QAT: 'qa',
  RSA: 'za',
  SCO: 'gb-sct',
  SEN: 'sn',
  SUI: 'ch',
  SWE: 'se',
  TUN: 'tn',
  TUR: 'tr',
  URU: 'uy',
  USA: 'us',
  UZB: 'uz',
}

export function buildFlagUrlFromCode(code) {
  const flagCode = teamCodeToFlagCode[code]

  return flagCode ? `https://flagcdn.com/${flagCode}.svg` : ''
}

export function stickerMatchesSearch(sticker, query) {
  if (!query) {
    return true
  }

  const normalizedQuery = normalizeText(query)

  const searchableText = [
    sticker.code,
    sticker.teamCode,
    sticker.teamName,
    sticker.teamNameEs,
    sticker.section,
    sticker.name,
    sticker.type,
    sticker.localNumber,
  ]
    .map(normalizeText)
    .join(' ')

  return searchableText.includes(normalizedQuery)
}

export function stickerMatchesFilter(sticker, stickerState, filter) {
  const owned = stickerState?.owned ?? false
  const duplicates = stickerState?.duplicates ?? 0

  if (filter === 'owned') {
    return owned
  }

  if (filter === 'missing') {
    return !owned
  }

  if (filter === 'duplicates') {
    return duplicates > 0
  }

  return true
}

export function buildCollectionStats(stickers, collection) {
  const total = stickers.length
  let owned = 0
  let duplicates = 0

  stickers.forEach((sticker) => {
    const stickerState = collection[sticker.code]

    if (stickerState?.owned) {
      owned += 1
    }

    duplicates += stickerState?.duplicates ?? 0
  })

  const missing = Math.max(0, total - owned)
  const percentage = total ? Math.round((owned / total) * 100) : 0

  return {
    total,
    owned,
    missing,
    duplicates,
    percentage,
  }
}

export function buildSections(stickers, teams) {
  const teamLookup = buildTeamLookup(teams)
  const groupedSections = new Map()

  stickers.forEach((sticker) => {
    const sectionId = sticker.teamCode
      ? `team-${sticker.teamCode}`
      : `section-${sticker.section || 'general'}`

    if (!groupedSections.has(sectionId)) {
      const teamInfo = sticker.teamCode ? teamLookup[sticker.teamCode] : null
      const title = teamInfo?.title || sticker.section || 'Especiales del album'

      let fallbackEmoji = '⭐'
      let fallbackShort = 'Base'
      if (!sticker.teamCode && sticker.section) {
        if (sticker.section === 'We Are Panini') { fallbackEmoji = '📖'; fallbackShort = 'PAN'; }
        else if (sticker.section === 'FIFA World Cup 2026') { fallbackEmoji = '🏆'; fallbackShort = 'FWC'; }
        else if (sticker.section === 'Host Countries and Cities') { fallbackEmoji = '🏟️'; fallbackShort = 'HST'; }
        else if (sticker.section === 'FIFA World Cup History') { fallbackEmoji = '📜'; fallbackShort = 'HIS'; }
      }

      groupedSections.set(sectionId, {
        id: sectionId,
        title,
        shortLabel: teamInfo?.shortLabel || fallbackShort,
        subtitle: sticker.teamCode
          ? 'Equipo del album base'
          : 'Seccion general del album base',
        teamCode: sticker.teamCode,
        flagUrl: buildFlagUrlFromCode(sticker.teamCode),
        emoji: sticker.teamCode ? null : fallbackEmoji,
        stickers: [],
      })
    }

    groupedSections.get(sectionId).stickers.push(sticker)
  })

  return Array.from(groupedSections.values())
}

export function buildTeamProgress(stickers, teams, collection) {
  return buildSections(stickers, teams)
    .filter((section) => section.teamCode)
    .map((section) => {
      const total = section.stickers.length
      const owned = section.stickers.filter(
        (sticker) => collection[sticker.code]?.owned,
      ).length

      return {
        ...section,
        total,
        owned,
        missing: Math.max(0, total - owned),
        percentage: total ? Math.round((owned / total) * 100) : 0,
      }
    })
}
