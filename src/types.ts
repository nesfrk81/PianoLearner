export type PracticeMode = 'listen' | 'follow' | 'wait'

export type LoopSnap = 'off' | 'beat' | 'bar'

export interface LoopRegion {
  aSec: number
  bSec: number
}

export interface ParsedMidiTrackInfo {
  index: number
  name: string
  noteCount: number
  durationSec: number
}

export interface NoteView {
  id: string
  midi: number
  time: number
  duration: number
  velocity: number
}
