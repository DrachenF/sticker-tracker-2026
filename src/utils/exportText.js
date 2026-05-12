const SHARE_INTRO = 'Llevo mi registro en https://mi-album-2026.vercel.app/'

function withShareIntro(text) {
  return `${SHARE_INTRO}\r\n\r\n${text}`
}

export function buildMissingText(stickers) {
  if (!stickers.length) {
    return withShareIntro('No me faltan estampitas del álbum base.')
  }

  const grouped = {}
  stickers.forEach((sticker) => {
    const groupName = sticker.teamNameEs || sticker.teamName || sticker.section || 'Base'
    if (!grouped[groupName]) {
      grouped[groupName] = []
    }
    grouped[groupName].push(sticker.code)
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
  let totalDuplicates = 0

  stickers.forEach((sticker) => {
    const groupName = sticker.teamNameEs || sticker.teamName || sticker.section || 'Base'
    if (!grouped[groupName]) {
      grouped[groupName] = { codes: [], count: 0 }
    }
    const duplicates = collection[sticker.code]?.duplicates ?? 0
    totalDuplicates += duplicates
    grouped[groupName].codes.push(duplicates > 1 ? `${sticker.code} (x${duplicates})` : sticker.code)
    grouped[groupName].count += duplicates
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
