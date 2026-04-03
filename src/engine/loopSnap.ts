import type { NoteView } from '../types'

/** Deduplicated, sorted onset times (ascending). Chords share one entry. */
export function uniqueOnsets(notes: NoteView[]): number[] {
  const set = new Set<number>()
  for (const n of notes) set.add(n.time)
  return [...set].sort((a, b) => a - b)
}

/** Deduplicated, sorted note-end times (ascending). */
export function uniqueEnds(notes: NoteView[]): number[] {
  const set = new Set<number>()
  for (const n of notes) set.add(n.time + n.duration)
  return [...set].sort((a, b) => a - b)
}

/** Onset <= `t` closest to `t`, or the first onset if none qualify. */
export function onsetAtOrBefore(onsets: number[], t: number): number {
  if (onsets.length === 0) return t
  let lo = 0
  let hi = onsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (onsets[mid]! <= t) lo = mid
    else hi = mid - 1
  }
  return onsets[lo]! <= t ? onsets[lo]! : onsets[0]!
}

/** End >= `t` closest to `t`, or the last end if none qualify. */
export function endAtOrAfter(ends: number[], t: number): number {
  if (ends.length === 0) return t
  let lo = 0
  let hi = ends.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (ends[mid]! >= t) hi = mid
    else lo = mid + 1
  }
  return ends[lo]! >= t ? ends[lo]! : ends[ends.length - 1]!
}

/** First onset strictly after `t`, or null if none. */
export function nextOnsetAfter(onsets: number[], t: number): number | null {
  for (const o of onsets) {
    if (o > t + 0.001) return o
  }
  return null
}

/** Last onset strictly before `t`, or null if none. */
export function prevOnsetBefore(onsets: number[], t: number): number | null {
  for (let i = onsets.length - 1; i >= 0; i--) {
    if (onsets[i]! < t - 0.001) return onsets[i]!
  }
  return null
}

/**
 * Map CC 0-127 to an index in `times` (sorted array).
 * CC 0 → first entry, CC 127 → last entry.
 */
export function ccToTimeIndex(cc: number, times: number[]): number {
  if (times.length <= 1) return 0
  const n = times.length
  return Math.min(n - 1, Math.round((cc / 127) * (n - 1)))
}
