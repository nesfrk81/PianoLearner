import { Midi } from '@tonejs/midi'
import type { NoteView, ParsedMidiTrackInfo } from '../types'

export function parseMidiBuffer(buf: ArrayBuffer): Midi {
  return new Midi(buf)
}

export function trackSummaries(midi: Midi): ParsedMidiTrackInfo[] {
  return midi.tracks.map((t, index) => ({
    index,
    name: t.name || `Track ${index + 1}`,
    noteCount: t.notes.length,
    durationSec: t.duration,
  }))
}

export function trackHasNotes(midi: Midi, index: number): boolean {
  const t = midi.tracks[index]
  return t != null && t.notes.length > 0
}

export function notesForTrack(midi: Midi, index: number): NoteView[] {
  const t = midi.tracks[index]
  if (!t) return []
  return t.notes.map((n, i) => ({
    id: `${index}-${i}-${n.time}-${n.midi}`,
    midi: n.midi,
    time: n.time,
    duration: n.duration,
    velocity: n.velocity,
  }))
}

/** Valid unique sorted indices with notes only; if empty or all invalid, defaults to first track that has notes (or 0). */
export function normalizeTrackIndices(midi: Midi, indices: number[]): number[] {
  const max = midi.tracks.length
  if (max === 0) return []
  const u = [...new Set(indices)]
    .filter(
      (i) =>
        Number.isFinite(i) &&
        i >= 0 &&
        i < max &&
        trackHasNotes(midi, i),
    )
    .sort((a, b) => a - b)
  if (u.length === 0) {
    const first = trackSummaries(midi).find((s) => s.noteCount > 0)?.index ?? 0
    return [first]
  }
  return u
}

export function notesForTracks(midi: Midi, indices: number[]): NoteView[] {
  const norm = normalizeTrackIndices(midi, indices)
  if (norm.length === 0) return []
  const merged: NoteView[] = []
  for (const i of norm) {
    merged.push(...notesForTrack(midi, i))
  }
  merged.sort((a, b) => a.time - b.time || a.midi - b.midi)
  return merged
}

/** All note events from all tracks (for full playback). */
export function allNotesFlat(midi: Midi): NoteView[] {
  const out: NoteView[] = []
  midi.tracks.forEach((t, ti) => {
    t.notes.forEach((n, i) => {
      out.push({
        id: `${ti}-${i}-${n.time}-${n.midi}`,
        midi: n.midi,
        time: n.time,
        duration: n.duration,
        velocity: n.velocity,
      })
    })
  })
  return out.sort((a, b) => a.time - b.time || a.midi - b.midi)
}

export function getTimeSignature(
  midi: Midi,
): { numerator: number; denominator: number } {
  const ts = midi.header.timeSignatures[0]
  if (ts) {
    return { numerator: ts.timeSignature[0], denominator: ts.timeSignature[1] }
  }
  return { numerator: 4, denominator: 4 }
}
