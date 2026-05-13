const SHARE_INTRO = 'Llevo mi registro en https://mi-album-2026.vercel.app/'

function withShareIntro(text) {
  return `${SHARE_INTRO}\r\n\r\n${text}`
}

function buildFlagEmojiFromTeamCode(teamCode) {
  if (!teamCode || typeof teamCode !== 'string') {
    return ''
  }

  const normalizedCode = teamCode.toLowerCase()
  const customFlags = {
    'gb-eng': '🏴',
    'gb-sct': '🏴',
    'gb-wls': '🏴',
  }

  if (customFlags[normalizedCode]) {
    return customFlags[normalizedCode]
  }

  if (!/^[a-z]{2}$/.test(normalizedCode)) {
    return ''
  }

  return normalizedCode
    .toUpperCase()
    .split('')
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('')
}

function buildGroupTitle(sticker, groupName) {
  const flagEmoji = buildFlagEmojiFromTeamCode(sticker.teamCode)
  return flagEmoji ? `${flagEmoji} ${groupName}` : groupName
}

export function buildMissingText(stickers) {
  if (!stickers.length) {
    return withShareIntro('No me faltan estampitas del álbum base.')
  }

  const grouped = {}
  stickers.forEach((sticker) => {
    const groupName = sticker.teamNameEs || sticker.teamName || sticker.section || 'Base'
    const groupTitle = buildGroupTitle(sticker, groupName)
    if (!grouped[groupTitle]) {
      grouped[groupTitle] = []
    }
    grouped[groupTitle].push(sticker.code)
  })

  const groupNames = Object.keys(grouped)
  if (groupNames.length === 1) {
    const groupName = groupNames[0]
    return withShareIntro(`Me faltan *${groupName.toUpperCase()}*:\r\n${grouped[groupName].map(c => `- ${c}`).join('\r\n')}`)
  }

  const lines = ['Me faltan:']
  for (const [groupName, codes] of Object.entries(grouped)) {
    lines.push(`*${groupName.toUpperCase()}*:\r\n${codes.map(c => `- ${c}`).join('\r\n')}`)
  }

  return withShareIntro(lines.join('\r\n\r\n'))
}

export function buildDuplicateText(stickers, collection) {
  if (!stickers.length) {
    return withShareIntro('No tengo estampitas repetidas registradas.')
  }

  const grouped = {}

  stickers.forEach((sticker) => {
    const groupName = sticker.teamNameEs || sticker.teamName || sticker.section || 'Base'
    const groupTitle = buildGroupTitle(sticker, groupName)
    if (!grouped[groupTitle]) {
      grouped[groupTitle] = { codes: [], count: 0 }
    }
    const duplicates = collection[sticker.code]?.duplicates ?? 0
    grouped[groupTitle].codes.push(duplicates > 1 ? `${sticker.code} (x${duplicates})` : sticker.code)
    grouped[groupTitle].count += duplicates
  })

  const groupNames = Object.keys(grouped)
  if (groupNames.length === 1) {
    const groupName = groupNames[0]
    return withShareIntro(`Tengo repetidas de *${groupName.toUpperCase()}*:\r\n${grouped[groupName].codes.map(c => `- ${c}`).join('\r\n')}`)
  }

  const lines = ['Tengo repetidas para intercambiar:']
  for (const [groupName, data] of Object.entries(grouped)) {
    lines.push(`*${groupName.toUpperCase()}*:\r\n${data.codes.map(c => `- ${c}`).join('\r\n')}`)
  }

  return withShareIntro(lines.join('\r\n\r\n'))
}
