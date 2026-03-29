import type { Midi } from '@tonejs/midi'
import { getTimeSignature } from '../midi/midiModel'
import type { LoopSnap } from '../types'

function bpmAtStart(midi: Midi): number {
  const t = midi.header.tempos[0]
  return t?.bpm ?? 120
}

export function snapSeconds(sec: number, midi: Midi, snap: LoopSnap): number {
  if (snap === 'off') return Math.max(0, sec)
  const bpm = bpmAtStart(midi)
  const beatDur = 60 / bpm
  if (snap === 'beat') {
    return Math.max(0, Math.round(sec / beatDur) * beatDur)
  }
  const { numerator } = getTimeSignature(midi)
  const barDur = beatDur * numerator
  return Math.max(0, Math.round(sec / barDur) * barDur)
}
