export type PracticeMode = 'listen' | 'follow' | 'wait'

export type HandFilter = 'both' | 'left' | 'right'

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

/**
 * Chord Learning feature types. Chord math and the catalogue live in
 * `src/chords/chordModel.ts`; the exercise state machine in
 * `src/chords/exerciseEngine.ts`; lessons in `src/chords/lessonCatalog.ts`.
 */
export type ChordQuality = 'maj' | 'min' | 'dim' | 'aug'

export interface ChordSpec {
  /** Root pitch class (0 = C … 11 = B). */
  root: number
  quality: ChordQuality
  /** Human label, e.g. `C`, `Gm`, `Bb`. */
  label: string
  /** Prefer flat accidentals for display (Db over C#, Eb over D#, …). */
  prefersFlats: boolean
}

export type ExerciseKind =
  | 'ladder'
  | 'circleForward'
  | 'circleBackward'
  | 'circleMinor'
  | 'randomGame'

/**
 * Declarative description of an exercise: how to build the chord sequence,
 * how many beats each chord is held, whether the octave shifts on the ladder,
 * etc. Consumed by `exerciseEngine.ts`.
 */
export interface ExerciseConfig {
  kind: ExerciseKind
  /** Beats per chord at the current BPM (default 4). */
  beatsPerChord: number
  /** For `ladder`: the chord to play; omit for list-based exercises. */
  ladderChord?: ChordSpec
  /** For `ladder`: number of octaves to climb before wrapping. */
  ladderOctaves?: number
  /** For `circleForward`, `circleBackward`, `circleMinor`: starting root pitch class. */
  startRoot?: number
  /** For `randomGame`: number of chords to generate per round. */
  randomCount?: number
  /** For `randomGame`: draw from this pool (defaults to circle-of-fifths majors). */
  randomPool?: readonly ChordSpec[]
}

export type LessonId =
  | '1.1'
  | '1.2'
  | '2.1'
  | '2.2'
  | '3.1'
  | '3.2'
  | '3.3'
  | '4.1'
  | '4.2'
  | '4.3'

export type ModuleId = 'm1' | 'm2' | 'm3' | 'm4'

export interface LessonScript {
  id: LessonId
  moduleId: ModuleId
  title: string
  intro: string
  instructions: readonly string[]
  completionMessage: string
  exercise: ExerciseConfig
  /** Recommended BPM (may be overridden by the metronome UI). */
  suggestedBpm: number
  /** Accuracy (0–1) required to unlock the next lesson; 0 = always unlocked. */
  unlockAccuracy: number
}
