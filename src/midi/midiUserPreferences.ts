/** USB MIDI note-on velocity multiplier (settings slider 1–3×). */
const STORAGE_KEY = 'pianoLearner.midiVelocitySensitivity'
const DEFAULT = 1.5
const MIN = 1
const MAX = 3

export function loadMidiVelocitySensitivity(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null) return DEFAULT
    const n = Number.parseFloat(raw)
    if (!Number.isFinite(n)) return DEFAULT
    return Math.min(MAX, Math.max(MIN, n))
  } catch {
    return DEFAULT
  }
}

export function saveMidiVelocitySensitivity(value: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    /* ignore quota / private mode */
  }
}
