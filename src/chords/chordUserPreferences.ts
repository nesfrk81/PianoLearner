/**
 * Persistence layer for the Chord Learning feature.
 *
 * Follows the same pattern as `midiUserPreferences.ts` — tiny modules that
 * load / save a single value to `localStorage` and swallow quota / private-mode
 * errors silently.
 */

import { DEFAULT_BPM, MAX_BPM, MIN_BPM } from './metronome'
import type { LessonId } from '../types'

const BPM_KEY = 'pianoLearner.chord.bpm'
const SELECTED_CHORD_KEY = 'pianoLearner.chord.selectedChordIndex'
const PROGRESS_KEY = 'pianoLearner.chord.lessonProgress'
const ACTIVE_LESSON_KEY = 'pianoLearner.chord.activeLessonId'
const PREVIEW_NEXT_KEY = 'pianoLearner.chord.previewNextChord'

export interface LessonProgress {
  /** Highest accuracy recorded for this lesson (0–1). */
  accuracy: number
  /** Wall-clock of the best run. */
  updatedAt: number
}

export type LessonProgressMap = Partial<Record<LessonId, LessonProgress>>

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function loadBpm(): number {
  try {
    const raw = localStorage.getItem(BPM_KEY)
    if (raw == null) return DEFAULT_BPM
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n)) return DEFAULT_BPM
    return clamp(n, MIN_BPM, MAX_BPM)
  } catch {
    return DEFAULT_BPM
  }
}

export function saveBpm(value: number): void {
  try {
    localStorage.setItem(BPM_KEY, String(clamp(value, MIN_BPM, MAX_BPM)))
  } catch {
    /* ignore */
  }
}

export function loadSelectedChordIndex(): number {
  try {
    const raw = localStorage.getItem(SELECTED_CHORD_KEY)
    if (raw == null) return 0
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

export function saveSelectedChordIndex(value: number): void {
  try {
    localStorage.setItem(SELECTED_CHORD_KEY, String(Math.max(0, value | 0)))
  } catch {
    /* ignore */
  }
}

export function loadLessonProgress(): LessonProgressMap {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: LessonProgressMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const rec = v as { accuracy?: unknown; updatedAt?: unknown }
      const acc = Number(rec.accuracy)
      const ts = Number(rec.updatedAt)
      if (!Number.isFinite(acc)) continue
      out[k as LessonId] = {
        accuracy: clamp(acc, 0, 1),
        updatedAt: Number.isFinite(ts) ? ts : Date.now(),
      }
    }
    return out
  } catch {
    return {}
  }
}

export function saveLessonProgress(map: LessonProgressMap): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

export function loadActiveLessonId(): LessonId | null {
  try {
    const raw = localStorage.getItem(ACTIVE_LESSON_KEY)
    return raw ? (raw as LessonId) : null
  } catch {
    return null
  }
}

export function saveActiveLessonId(id: LessonId | null): void {
  try {
    if (id == null) localStorage.removeItem(ACTIVE_LESSON_KEY)
    else localStorage.setItem(ACTIVE_LESSON_KEY, id)
  } catch {
    /* ignore */
  }
}

export function loadPreviewNextChord(): boolean {
  try {
    const raw = localStorage.getItem(PREVIEW_NEXT_KEY)
    /* Default ON so new learners see the upcoming chord shape without hunting
       for the setting. Persisted only when the user explicitly changes it. */
    if (raw == null) return true
    return raw === '1' || raw === 'true'
  } catch {
    return true
  }
}

export function savePreviewNextChord(value: boolean): void {
  try {
    localStorage.setItem(PREVIEW_NEXT_KEY, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}
