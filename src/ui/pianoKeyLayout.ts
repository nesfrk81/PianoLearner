/**
 * Piano-accurate horizontal layout: 7 white keys / octave, 5 black keys in 2+3 groups.
 * No black key between E–F or B–C.
 */

export function isWhiteKey(midi: number): boolean {
  const k = midi % 12
  return k === 0 || k === 2 || k === 4 || k === 5 || k === 7 || k === 9 || k === 11
}

/** White-key index 0..6 within octave (C..B) */
const PC_TO_WHITE: Record<number, number> = {
  0: 0,
  2: 1,
  4: 2,
  5: 3,
  7: 4,
  9: 5,
  11: 6,
}

/** Layout units per octave: 7 equal white keys; black keys sit between pairs */
const WW = 100
const BW = Math.round(WW * 0.58)
export const OCTAVE_UNITS = 7 * WW

type RelGeom = { left: number; width: number; isBlack: boolean }

/** Position of key `midi` relative to the C at start of its octave (midi0 = C). */
export function relKeyGeom(midi: number): RelGeom {
  const n = midi % 12
  if (isWhiteKey(midi)) {
    const wi = PC_TO_WHITE[n]!
    return { left: wi * WW, width: WW, isBlack: false }
  }
  // Black keys: C#, D#, F#, G#, A# only
  const left =
    n === 1
      ? 1 * WW - BW / 2
      : n === 3
        ? 2 * WW - BW / 2
        : n === 6
          ? 4 * WW - BW / 2
          : n === 8
            ? 5 * WW - BW / 2
            : n === 10
              ? 6 * WW - BW / 2
              : 0
  return { left, width: BW, isBlack: true }
}

/** Absolute left edge (layout units) from global midi 0 */
export function globalKeyLeft(midi: number): number {
  const oct = Math.floor(midi / 12)
  return oct * OCTAVE_UNITS + relKeyGeom(midi).left
}

export function midiRangeInclusive(minMidi: number, maxMidi: number): number[] {
  const out: number[] = []
  for (let m = minMidi; m <= maxMidi; m++) out.push(m)
  return out
}

/**
 * Normalized rects: `left` and `width` are fractions of the visible keybed [0,1].
 */
export function getKeyRectsNormalized(
  minMidi: number,
  maxMidi: number,
): Map<number, { left: number; width: number }> {
  const gMax = relKeyGeom(maxMidi)
  const leftEdge = globalKeyLeft(minMidi)
  const rightEdge = globalKeyLeft(maxMidi) + gMax.width
  const span = Math.max(1e-6, rightEdge - leftEdge)

  const map = new Map<number, { left: number; width: number }>()
  for (let m = minMidi; m <= maxMidi; m++) {
    const g = relKeyGeom(m)
    const gl = globalKeyLeft(m)
    map.set(m, {
      left: (gl - leftEdge) / span,
      width: g.width / span,
    })
  }
  return map
}
