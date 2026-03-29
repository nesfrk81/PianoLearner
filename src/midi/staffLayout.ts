/**
 * Map MIDI pitch to vertical position on treble or bass staff (0 = top line of staff, 1 = bottom).
 * Uses splitMidi for RH/LH; linear within each clef’s typical range for stable layout.
 */

export function clefForMidi(midi: number, splitMidi: number): 'treble' | 'bass' {
  return midi >= splitMidi ? 'treble' : 'bass'
}

const TREBLE_RANGE = { min: 55, max: 84 }
const BASS_RANGE = { min: 28, max: 62 }

export function midiToStaffYFrac(
  midi: number,
  clef: 'treble' | 'bass',
): number {
  const r = clef === 'treble' ? TREBLE_RANGE : BASS_RANGE
  const clamped = Math.max(r.min, Math.min(r.max, midi))
  const t = (clamped - r.min) / (r.max - r.min)
  return 1 - t
}

