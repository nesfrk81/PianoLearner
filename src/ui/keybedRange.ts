/** Preset keyboard widths: MIDI min/max inclusive (standard controller layouts). */
export const KEYBED_KEY_OPTIONS = [
  { keys: 37, minMidi: 60, maxMidi: 96, label: '37 keys (C4–C7)' },
  { keys: 49, minMidi: 48, maxMidi: 96, label: '49 keys (C3–C7)' },
  { keys: 61, minMidi: 36, maxMidi: 96, label: '61 keys (C2–C7)' },
  { keys: 76, minMidi: 28, maxMidi: 103, label: '76 keys (E1–G7)' },
  { keys: 88, minMidi: 21, maxMidi: 108, label: '88 keys (A0–C8)' },
] as const

export const DEFAULT_KEYBED_KEYS = 61

export function midiRangeForKeyCount(keyCount: number): {
  minMidi: number
  maxMidi: number
} {
  const row = KEYBED_KEY_OPTIONS.find((o) => o.keys === keyCount)
  if (row) return { minMidi: row.minMidi, maxMidi: row.maxMidi }
  const fallback = KEYBED_KEY_OPTIONS.find((o) => o.keys === DEFAULT_KEYBED_KEYS)!
  return { minMidi: fallback.minMidi, maxMidi: fallback.maxMidi }
}

export function normalizeKeybedKeyCount(n: number): number {
  if (KEYBED_KEY_OPTIONS.some((o) => o.keys === n)) return n
  return DEFAULT_KEYBED_KEYS
}

const STORAGE_KEY = 'pianoLearner.keybedKeyCount'

export function loadKeybedKeyCount(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null) return DEFAULT_KEYBED_KEYS
    const n = Number.parseInt(raw, 10)
    return normalizeKeybedKeyCount(n)
  } catch {
    return DEFAULT_KEYBED_KEYS
  }
}

export function saveKeybedKeyCount(keys: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(normalizeKeybedKeyCount(keys)))
  } catch {
    /* ignore */
  }
}
