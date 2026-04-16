/**
 * Chord catalog, pitch-class math, and lenient chord detection used by the
 * Chord Learning feature (see `ChordPracticePanel`). Qualities are kept small
 * on purpose — maj + min cover the circle-of-fifths flow described in the PRD;
 * dim/aug are recognised by the detector but not used by the current catalog.
 */

import type { ChordQuality, ChordSpec } from '../types'

/** Pitch-class intervals (semitones above the root) for each known quality. */
const QUALITY_INTERVALS: Record<ChordQuality, readonly number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
}

/** Canonical sharp spelling per pitch class (0 = C … 11 = B). */
const SHARP_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const

/** Flat spelling, used when the chord is naturally spelled with flats. */
const FLAT_NAMES = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const

/** Forward circle of fifths (major roots, pitch-class 0..11). */
export const CIRCLE_FIFTHS_MAJOR: readonly ChordSpec[] = [
  { root: 0, quality: 'maj', label: 'C', prefersFlats: false },
  { root: 7, quality: 'maj', label: 'G', prefersFlats: false },
  { root: 2, quality: 'maj', label: 'D', prefersFlats: false },
  { root: 9, quality: 'maj', label: 'A', prefersFlats: false },
  { root: 4, quality: 'maj', label: 'E', prefersFlats: false },
  { root: 11, quality: 'maj', label: 'B', prefersFlats: false },
  { root: 6, quality: 'maj', label: 'F#', prefersFlats: false },
  { root: 1, quality: 'maj', label: 'Db', prefersFlats: true },
  { root: 8, quality: 'maj', label: 'Ab', prefersFlats: true },
  { root: 3, quality: 'maj', label: 'Eb', prefersFlats: true },
  { root: 10, quality: 'maj', label: 'Bb', prefersFlats: true },
  { root: 5, quality: 'maj', label: 'F', prefersFlats: true },
]

/** Forward circle of fifths, minor qualities (relative minor mapping not used here — just minor on each root). */
export const CIRCLE_FIFTHS_MINOR: readonly ChordSpec[] = CIRCLE_FIFTHS_MAJOR.map(
  (c) => ({ ...c, quality: 'min', label: `${c.label}m` }),
)

/** Short ordered list used by Lesson 1.2 ("Add G, D, A"). */
export const LESSON_1_2_CHORDS: readonly ChordSpec[] = [
  CIRCLE_FIFTHS_MAJOR[0]!, // C
  CIRCLE_FIFTHS_MAJOR[1]!, // G
  CIRCLE_FIFTHS_MAJOR[2]!, // D
  CIRCLE_FIFTHS_MAJOR[3]!, // A
]

/** All common triads the user can pick from in Free Practice (major + minor, 24). */
export const COMMON_CHORDS: readonly ChordSpec[] = [
  ...CIRCLE_FIFTHS_MAJOR,
  ...CIRCLE_FIFTHS_MINOR,
]

/** Normalise a pitch class into 0..11. */
export function pcMod(n: number): number {
  const r = n % 12
  return r < 0 ? r + 12 : r
}

/** Human label for a root pitch class. */
export function rootName(root: number, prefersFlats = false): string {
  const pc = pcMod(root)
  return prefersFlats ? FLAT_NAMES[pc]! : SHARP_NAMES[pc]!
}

/** Label like `C`, `Gm`, `Dbm`, `F#`. */
export function chordLabel(spec: ChordSpec): string {
  const base = rootName(spec.root, spec.prefersFlats)
  switch (spec.quality) {
    case 'maj':
      return base
    case 'min':
      return `${base}m`
    case 'dim':
      return `${base}dim`
    case 'aug':
      return `${base}aug`
  }
}

/** Pitch-class set (0..11) for a chord quality rooted at `root`. */
export function chordPitchClasses(
  root: number,
  quality: ChordQuality,
): Set<number> {
  const intervals = QUALITY_INTERVALS[quality]
  const s = new Set<number>()
  for (const iv of intervals) s.add(pcMod(root + iv))
  return s
}

/**
 * Return MIDI note numbers for a chord, placed in `baseOctave` (middle C = 4),
 * voicing = root position. Used by `AlignedKeybed`'s `expectedMidi`.
 */
export function chordMidiNotes(
  root: number,
  quality: ChordQuality,
  baseOctave = 4,
): number[] {
  const intervals = QUALITY_INTERVALS[quality]
  const rootMidi = (baseOctave + 1) * 12 + pcMod(root)
  return intervals.map((iv) => rootMidi + iv)
}

/**
 * Lenient chord match: returns true when every required pitch class from
 * `required` is present in `held`. Extra pitch classes in `held` are ignored
 * (matches the "pitch-class, any octave, extras OK" rule in the PRD).
 */
export function heldContainsChord(
  held: ReadonlySet<number>,
  required: ReadonlySet<number>,
): boolean {
  if (required.size === 0) return false
  const pcs = new Set<number>()
  for (const m of held) pcs.add(pcMod(m))
  for (const r of required) {
    if (!pcs.has(r)) return false
  }
  return true
}

/** Unique pitch classes held as a Set. */
export function heldPitchClasses(held: ReadonlySet<number>): Set<number> {
  const s = new Set<number>()
  for (const m of held) s.add(pcMod(m))
  return s
}

const QUALITY_ORDER: readonly ChordQuality[] = ['maj', 'min', 'dim', 'aug']

export type DetectedChord = {
  root: number
  quality: ChordQuality
  label: string
  /** How many pitch classes are held that are NOT part of the detected chord. */
  extras: number
}

/**
 * Detect a chord from a set of held MIDI notes.
 *
 * Scoring (highest first):
 *   1. minimal extras,
 *   2. completeness (all chord tones covered),
 *   3. quality preference order (maj > min > dim > aug),
 *   4. lowest-held note as root bias.
 *
 * Returns null if fewer than 3 distinct pitch classes are held.
 */
export function detectChordFromHeld(
  held: ReadonlySet<number>,
): DetectedChord | null {
  if (held.size < 3) return null
  const pcs = heldPitchClasses(held)
  if (pcs.size < 3) return null

  /* Lowest held note bias: used to pick among otherwise-equal scores. */
  let lowest = Number.POSITIVE_INFINITY
  for (const m of held) if (m < lowest) lowest = m
  const lowestPc = Number.isFinite(lowest) ? pcMod(lowest) : -1

  let best: (DetectedChord & { score: number }) | null = null
  for (let root = 0; root < 12; root++) {
    for (const quality of QUALITY_ORDER) {
      const required = chordPitchClasses(root, quality)
      let missing = 0
      for (const r of required) if (!pcs.has(r)) missing++
      if (missing > 0) continue
      let extras = 0
      for (const pc of pcs) if (!required.has(pc)) extras++
      const qBonus = QUALITY_ORDER.length - QUALITY_ORDER.indexOf(quality)
      const rootBonus = root === lowestPc ? 1 : 0
      const score = -extras * 10 + qBonus + rootBonus
      if (!best || score > best.score) {
        const spec: ChordSpec = { root, quality, label: '', prefersFlats: false }
        best = {
          root,
          quality,
          label: chordLabel({ ...spec, label: '' }),
          extras,
          score,
        }
      }
    }
  }
  return best ? { root: best.root, quality: best.quality, label: best.label, extras: best.extras } : null
}

/** Forward circle starting at `startRoot` (major) — useful for exercises. */
export function circleForwardFrom(startRoot: number): readonly ChordSpec[] {
  const i = CIRCLE_FIFTHS_MAJOR.findIndex((c) => c.root === pcMod(startRoot))
  const from = i < 0 ? 0 : i
  const out: ChordSpec[] = []
  for (let k = 0; k < CIRCLE_FIFTHS_MAJOR.length; k++) {
    out.push(CIRCLE_FIFTHS_MAJOR[(from + k) % CIRCLE_FIFTHS_MAJOR.length]!)
  }
  return out
}

/** Backward circle (fourths) starting at `startRoot` (major). */
export function circleBackwardFrom(startRoot: number): readonly ChordSpec[] {
  const i = CIRCLE_FIFTHS_MAJOR.findIndex((c) => c.root === pcMod(startRoot))
  const from = i < 0 ? 0 : i
  const n = CIRCLE_FIFTHS_MAJOR.length
  const out: ChordSpec[] = []
  for (let k = 0; k < n; k++) {
    out.push(CIRCLE_FIFTHS_MAJOR[(from - k + n * 2) % n]!)
  }
  return out
}
