const STORAGE_KEY = 'sticker-tracker-2026-collection'
const BOOK_CUSTOMIZATION_KEY = 'sticker-tracker-2026-book-customization'
const SOUND_ENABLED_KEY = 'sticker-tracker-2026-sound-enabled'
const BACKUP_HEADER = 'STICKER_TRACKER_ALBU_V1'
const BACKUP_SALT = 'album-base-2026'
const MAX_FLAGS = 7

function normalizeEntry(entry) {
  const duplicates = Math.max(0, Number(entry?.duplicates) || 0)
  const owned = Boolean(entry?.owned) || duplicates > 0 || Boolean(entry?.pasted)

  return {
    owned,
    duplicates,
    pasted: owned ? Boolean(entry?.pasted) : false,
  }
}

function normalizeCollection(rawCollection) {
  if (
    !rawCollection ||
    typeof rawCollection !== 'object' ||
    Array.isArray(rawCollection)
  ) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(rawCollection)
      .map(([code, value]) => [code, normalizeEntry(value)])
      .filter(([, value]) => value.owned || value.duplicates > 0 || value.pasted),
  )
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function roundLayoutValue(value) {
  return Math.round(value * 10) / 10
}

function normalizeBookFlag(flag, index) {
  if (typeof flag === 'string') {
    return {
      id: `${flag}-${index}`,
      code: flag,
      x: 50,
      y: 30,
      rotation: 0,
    }
  }

  if (!flag?.code) {
    return null
  }

  return {
    id: flag.id || `${flag.code}-${index}`,
    code: String(flag.code),
    x: roundLayoutValue(clamp(Number(flag.x) || 50, 10, 90)),
    y: roundLayoutValue(clamp(Number(flag.y) || 30, 14, 86)),
    rotation: Math.round(clamp(Number(flag.rotation) || 0, -35, 35)),
  }
}

function normalizeBookCustomization(rawCustomization) {
  if (
    !rawCustomization ||
    typeof rawCustomization !== 'object' ||
    Array.isArray(rawCustomization)
  ) {
    return null
  }

  return {
    bookColor: String(rawCustomization.bookColor || '#1d4ed8'),
    hasCustomBookColor: Boolean(rawCustomization.hasCustomBookColor),
    bookFlags: Array.isArray(rawCustomization.bookFlags)
      ? rawCustomization.bookFlags
        .map(normalizeBookFlag)
        .filter(Boolean)
        .slice(0, MAX_FLAGS)
      : [],
  }
}

function readBookCustomizationState() {
  try {
    const storedValue = window.localStorage.getItem(BOOK_CUSTOMIZATION_KEY)
    return storedValue ? normalizeBookCustomization(JSON.parse(storedValue)) : null
  } catch {
    return null
  }
}

function saveBookCustomizationState(customization) {
  const normalizedCustomization = normalizeBookCustomization(customization)

  if (!normalizedCustomization) {
    window.localStorage.removeItem(BOOK_CUSTOMIZATION_KEY)
    return null
  }

  window.localStorage.setItem(
    BOOK_CUSTOMIZATION_KEY,
    JSON.stringify(normalizedCustomization),
  )
  return normalizedCustomization
}

function encodeBackupPayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  const saltBytes = new TextEncoder().encode(BACKUP_SALT)
  const encodedBytes = bytes.map((byte, index) => (
    byte ^ saltBytes[index % saltBytes.length]
  ))
  const binary = Array.from(encodedBytes, (byte) => String.fromCharCode(byte)).join('')

  return `${BACKUP_HEADER}.${btoa(binary)}`
}

function decodeBackupPayload(rawText) {
  const trimmedText = rawText.trim()

  if (!trimmedText.startsWith(`${BACKUP_HEADER}.`)) {
    return null
  }

  try {
    const encodedText = trimmedText.slice(BACKUP_HEADER.length + 1)
    const encodedBytes = Uint8Array.from(
      atob(encodedText),
      (character) => character.charCodeAt(0),
    )
    const saltBytes = new TextEncoder().encode(BACKUP_SALT)
    const decodedBytes = encodedBytes.map((byte, index) => (
      byte ^ saltBytes[index % saltBytes.length]
    ))

    return JSON.parse(new TextDecoder().decode(decodedBytes))
  } catch {
    throw new Error('El archivo .albu no se pudo decodificar.')
  }
}

export function loadCollectionState() {
  try {
    const storedValue = window.localStorage.getItem(STORAGE_KEY)
    return storedValue ? normalizeCollection(JSON.parse(storedValue)) : {}
  } catch {
    return {}
  }
}

export function saveCollectionState(collection) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(normalizeCollection(collection)),
  )
}

export function resetCollectionState() {
  window.localStorage.removeItem(STORAGE_KEY)
}

export function exportCollectionBackup(collection, options = {}) {
  return encodeBackupPayload({
    app: 'Sticker Tracker 2026',
    format: 'albu',
    version: 2,
    exportedAt: new Date().toISOString(),
    collection: normalizeCollection(collection),
    customization: normalizeBookCustomization(
      options.bookCustomization ?? readBookCustomizationState(),
    ),
    settings: {
      isSoundEnabled: Boolean(options.isSoundEnabled),
    },
  })
}

export function importCollectionBackup(rawText) {
  let parsedBackup

  const decodedBackup = decodeBackupPayload(rawText)

  if (decodedBackup) {
    parsedBackup = decodedBackup
  } else {
    try {
      parsedBackup = JSON.parse(rawText)
    } catch {
      throw new Error('El archivo no es un respaldo valido de Sticker Tracker.')
    }
  }

  if (!parsedBackup || typeof parsedBackup !== 'object') {
    throw new Error('El respaldo no tiene un formato valido.')
  }

  const nextCollection = normalizeCollection(
    parsedBackup.collection ?? parsedBackup,
  )
  const nextCustomization = normalizeBookCustomization(parsedBackup.customization)
  const nextSoundEnabled =
    typeof parsedBackup.settings?.isSoundEnabled === 'boolean'
      ? parsedBackup.settings.isSoundEnabled
      : null

  saveCollectionState(nextCollection)

  if (nextCustomization) {
    saveBookCustomizationState(nextCustomization)
    document.documentElement.style.setProperty(
      '--album-theme-color',
      nextCustomization.hasCustomBookColor ? nextCustomization.bookColor : '#ffffff',
    )
  }

  if (nextSoundEnabled !== null) {
    window.localStorage.setItem(SOUND_ENABLED_KEY, nextSoundEnabled ? 'true' : 'false')
  }

  return {
    collection: nextCollection,
    customization: nextCustomization,
    isSoundEnabled: nextSoundEnabled,
  }
}
