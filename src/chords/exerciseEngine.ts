/**
 * Exercise state machine for the Chord Learning feature.
 *
 * The engine is metronome-driven: each `beat()` advances an internal beat
 * counter, emits the current chord (and next chord, if any), and records
 * hit/miss statistics when the current chord window closes.
 *
 * Exercise kinds:
 *   - `ladder`         — same chord, climb octaves every `beatsPerChord`.
 *   - `circleForward`  — walk clockwise through the circle of fifths.
 *   - `circleBackward` — walk counter-clockwise (fourths).
 *   - `circleMinor`    — same movement, minor quality.
 *   - `randomGame`     — shuffled list of chords drawn from a pool.
 *
 * Matching is pitch-class lenient (see `heldContainsChord` in `chordModel.ts`).
 */

import type { ChordSpec, ExerciseConfig } from '../types'
import {
  CIRCLE_FIFTHS_MAJOR,
  chordPitchClasses,
  circleBackwardFrom,
  circleForwardFrom,
  heldContainsChord,
} from './chordModel'

export interface ChordWindowStats {
  chord: ChordSpec
  /** Approximate octave used for this window (for the `ladder` exercise). */
  octave: number
  hit: boolean
}

export interface ExerciseSnapshot {
  config: ExerciseConfig
  current: ChordSpec | null
  next: ChordSpec | null
  /** Octave currently used for keyboard highlighting / display. */
  currentOctave: number
  /** 0-based index inside the chord sequence. */
  chordIndex: number
  /** 0-based beat within the current chord window (0 … beatsPerChord-1). */
  beatInChord: number
  /** Total chords in the sequence; null for looping exercises. */
  totalChords: number | null
  /** Completed windows so far. */
  history: readonly ChordWindowStats[]
  /** Whether the last window finished and there is no next chord. */
  finished: boolean
  /** Running accuracy in 0–1, computed over `history`. */
  accuracy: number
}

interface InternalState {
  config: ExerciseConfig
  sequence: ChordSpec[]
  octaves: number[]
  chordIndex: number
  beatInChord: number
  history: ChordWindowStats[]
  heldMatchedThisWindow: boolean
  finished: boolean
}

const FALLBACK_CHORD: ChordSpec = CIRCLE_FIFTHS_MAJOR[0]!

function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function buildSequence(config: ExerciseConfig): {
  sequence: ChordSpec[]
  octaves: number[]
} {
  switch (config.kind) {
    case 'ladder': {
      const chord = config.ladderChord ?? FALLBACK_CHORD
      const octaves = config.ladderOctaves ?? 5
      const seq: ChordSpec[] = []
      const octs: number[] = []
      const baseOct = 3
      for (let i = 0; i < octaves; i++) {
        seq.push(chord)
        octs.push(baseOct + i)
      }
      return { sequence: seq, octaves: octs }
    }
    case 'circleForward': {
      const seq = circleForwardFrom(config.startRoot ?? 0)
      return { sequence: seq.slice(), octaves: seq.map(() => 4) }
    }
    case 'circleBackward': {
      const seq = circleBackwardFrom(config.startRoot ?? 0)
      return { sequence: seq.slice(), octaves: seq.map(() => 4) }
    }
    case 'circleMinor': {
      const seq = circleForwardFrom(config.startRoot ?? 0).map((c) => ({
        ...c,
        quality: 'min' as const,
        label: `${c.label}m`,
      }))
      return { sequence: seq, octaves: seq.map(() => 4) }
    }
    case 'randomGame': {
      const pool = config.randomPool ?? CIRCLE_FIFTHS_MAJOR
      const count = Math.max(1, config.randomCount ?? 12)
      const picks: ChordSpec[] = []
      for (let i = 0; i < count; i++) {
        const bag = shuffle(pool)
        picks.push(bag[i % bag.length]!)
      }
      return { sequence: picks, octaves: picks.map(() => 4) }
    }
  }
}

export class ExerciseEngine {
  private state: InternalState

  constructor(config: ExerciseConfig) {
    this.state = this.buildState(config)
  }

  reset(config: ExerciseConfig = this.state.config): void {
    this.state = this.buildState(config)
  }

  private buildState(config: ExerciseConfig): InternalState {
    const { sequence, octaves } = buildSequence(config)
    return {
      config,
      sequence,
      octaves,
      chordIndex: 0,
      beatInChord: 0,
      history: [],
      heldMatchedThisWindow: false,
      finished: sequence.length === 0,
    }
  }

  /**
   * Observe held MIDI notes at any point during a chord window. The first
   * time the chord is detected in the window, the window is marked as a hit.
   */
  observeHeld(held: ReadonlySet<number>): void {
    if (this.state.finished || this.state.heldMatchedThisWindow) return
    const cur = this.state.sequence[this.state.chordIndex]
    if (!cur) return
    const required = chordPitchClasses(cur.root, cur.quality)
    if (heldContainsChord(held, required)) {
      this.state.heldMatchedThisWindow = true
    }
  }

  /**
   * Advance by one metronome beat. Returns the snapshot after advancement.
   * When the beat is a chord-boundary beat, the previous window is recorded
   * and the chord pointer moves forward.
   */
  beat(): ExerciseSnapshot {
    if (this.state.finished) return this.snapshot()
    const { config } = this.state
    const cur = this.state.sequence[this.state.chordIndex]
    if (!cur) {
      this.state.finished = true
      return this.snapshot()
    }
    this.state.beatInChord += 1
    if (this.state.beatInChord >= config.beatsPerChord) {
      const octave = this.state.octaves[this.state.chordIndex] ?? 4
      this.state.history.push({
        chord: cur,
        octave,
        hit: this.state.heldMatchedThisWindow,
      })
      this.state.heldMatchedThisWindow = false
      this.state.chordIndex += 1
      this.state.beatInChord = 0
      if (this.state.chordIndex >= this.state.sequence.length) {
        this.state.finished = true
      }
    }
    return this.snapshot()
  }

  snapshot(): ExerciseSnapshot {
    const { state } = this
    const current = state.sequence[state.chordIndex] ?? null
    const next = state.sequence[state.chordIndex + 1] ?? null
    const octave = state.octaves[state.chordIndex] ?? 4
    const hits = state.history.filter((h) => h.hit).length
    const accuracy =
      state.history.length === 0 ? 0 : hits / state.history.length
    return {
      config: state.config,
      current,
      next,
      currentOctave: octave,
      chordIndex: state.chordIndex,
      beatInChord: state.beatInChord,
      totalChords: state.sequence.length,
      history: state.history.slice(),
      finished: state.finished,
      accuracy,
    }
  }

  /** Chords whose window closed with a miss, deduped by label. */
  missedChords(): ChordSpec[] {
    const seen = new Set<string>()
    const out: ChordSpec[] = []
    for (const h of this.state.history) {
      if (h.hit) continue
      if (seen.has(h.chord.label)) continue
      seen.add(h.chord.label)
      out.push(h.chord)
    }
    return out
  }
}
