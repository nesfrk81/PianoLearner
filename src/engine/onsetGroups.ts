import type { NoteView } from '../types'

const EPS = 0.02

export interface OnsetGroup {
  time: number
  mids: number[]
}

export function groupNotesByOnset(notes: NoteView[]): OnsetGroup[] {
  if (notes.length === 0) return []
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi)
  const out: OnsetGroup[] = []
  let t0 = sorted[0]!.time
  let mids: number[] = [sorted[0]!.midi]
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!
    if (Math.abs(n.time - t0) < EPS) {
      mids.push(n.midi)
    } else {
      out.push({ time: t0, mids: [...new Set(mids)].sort((a, b) => a - b) })
      t0 = n.time
      mids = [n.midi]
    }
  }
  out.push({ time: t0, mids: [...new Set(mids)].sort((a, b) => a - b) })
  return out
}
