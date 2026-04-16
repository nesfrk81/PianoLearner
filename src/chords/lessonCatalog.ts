/**
 * Chord Learning course: Modules 1–4, Lessons 1.1 – 4.3.
 *
 * The script text (title, intro, instructions, completion message) follows
 * the user-supplied scripts from the PRD. Lesson order defines unlock flow:
 * a lesson is unlocked when the previous one's accuracy >= `unlockAccuracy`
 * (0 = always unlocked).
 */

import {
  CIRCLE_FIFTHS_MAJOR,
  LESSON_1_2_CHORDS,
} from './chordModel'
import type { LessonId, LessonScript, ModuleId } from '../types'

export interface ModuleDescriptor {
  id: ModuleId
  title: string
  goal: string
}

export const MODULES: readonly ModuleDescriptor[] = [
  {
    id: 'm1',
    title: 'Module 1 — Chord Familiarity',
    goal: 'Learn shapes and basic movement.',
  },
  {
    id: 'm2',
    title: 'Module 2 — Timing & Flow',
    goal: 'No pauses between chords.',
  },
  {
    id: 'm3',
    title: 'Module 3 — Patterns (Circle of Fifths)',
    goal: 'Understand chord relationships.',
  },
  {
    id: 'm4',
    title: 'Module 4 — Real-Time Playing',
    goal: 'Instant chord recognition.',
  },
]

const CMAJ = CIRCLE_FIFTHS_MAJOR[0]!

export const LESSONS: readonly LessonScript[] = [
  {
    id: '1.1',
    moduleId: 'm1',
    title: 'Play Your First Chord Ladder',
    intro:
      "We're skipping beginner songs. You'll start playing real music using chords.",
    instructions: [
      'Play a C major chord.',
      'Hold for 4 beats.',
      'Move up to the next C and repeat.',
      'Continue to the top.',
    ],
    completionMessage:
      "Nice. You're building real muscle memory.",
    exercise: {
      kind: 'ladder',
      beatsPerChord: 4,
      ladderChord: CMAJ,
      ladderOctaves: 5,
    },
    suggestedBpm: 60,
    unlockAccuracy: 0,
  },
  {
    id: '1.2',
    moduleId: 'm1',
    title: 'Multiple Chords',
    intro:
      'Same ladder pattern, now with a few friends — C, G, D, and A.',
    instructions: [
      'Play each chord for 4 beats.',
      'Step up to the next chord in the list.',
      'Keep the movement smooth — no stopping.',
    ],
    completionMessage:
      "That's four chords under your fingers. You're closer than you think.",
    exercise: {
      kind: 'randomGame',
      beatsPerChord: 4,
      randomPool: LESSON_1_2_CHORDS,
      randomCount: LESSON_1_2_CHORDS.length,
    },
    suggestedBpm: 60,
    unlockAccuracy: 0.7,
  },
  {
    id: '2.1',
    moduleId: 'm2',
    title: 'Metronome Intro',
    intro:
      'Add the metronome at 60 BPM. Same chord ladder — but in time.',
    instructions: [
      'Start the metronome (60 BPM).',
      'Play the ladder chord on the downbeat.',
      'Hold until beat 4, then move up an octave.',
    ],
    completionMessage:
      'Steady. That is the hardest part done.',
    exercise: {
      kind: 'ladder',
      beatsPerChord: 4,
      ladderChord: CMAJ,
      ladderOctaves: 5,
    },
    suggestedBpm: 60,
    unlockAccuracy: 0.7,
  },
  {
    id: '2.2',
    moduleId: 'm2',
    title: 'Speed Tracking',
    intro:
      'Ladder again, but the tempo climbs: 60 → 80 → 100 BPM.',
    instructions: [
      'Run the ladder at 60 BPM.',
      'When clean, bump the BPM to 80.',
      'Repeat at 100 BPM. Use the knob if you bound it.',
    ],
    completionMessage:
      "If 100 feels fast, that's the point. Rest, repeat.",
    exercise: {
      kind: 'ladder',
      beatsPerChord: 4,
      ladderChord: CMAJ,
      ladderOctaves: 5,
    },
    suggestedBpm: 80,
    unlockAccuracy: 0.75,
  },
  {
    id: '3.1',
    moduleId: 'm3',
    title: 'Forward Circle',
    intro:
      'Chords are not random — they move. Fifths first: C → G → D → A → …',
    instructions: [
      'Play each chord for 4 beats.',
      'Follow the circle clockwise.',
      'Keep the tempo honest.',
    ],
    completionMessage:
      'Welcome to the roadmap. Now you know where songs live.',
    exercise: {
      kind: 'circleForward',
      beatsPerChord: 4,
      startRoot: 0,
    },
    suggestedBpm: 60,
    unlockAccuracy: 0.75,
  },
  {
    id: '3.2',
    moduleId: 'm3',
    title: 'Backward Circle',
    intro:
      'Fourths this time: C → F → Bb → Eb → … The other half of how songs move.',
    instructions: [
      'Play each chord for 4 beats.',
      'Follow the circle counter-clockwise.',
      'Expect the flats — spelling changes, the shape is the same.',
    ],
    completionMessage:
      'Both directions unlocked. That is most pop songs, handled.',
    exercise: {
      kind: 'circleBackward',
      beatsPerChord: 4,
      startRoot: 0,
    },
    suggestedBpm: 60,
    unlockAccuracy: 0.75,
  },
  {
    id: '3.3',
    moduleId: 'm3',
    title: 'Minor Version',
    intro:
      'Same pattern, minor chords. Darker sound, same movement.',
    instructions: [
      'Play each minor chord for 4 beats.',
      'Follow the circle clockwise.',
    ],
    completionMessage:
      'Minor is major with a secret. You just shared it.',
    exercise: {
      kind: 'circleMinor',
      beatsPerChord: 4,
      startRoot: 0,
    },
    suggestedBpm: 60,
    unlockAccuracy: 0.75,
  },
  {
    id: '4.1',
    moduleId: 'm4',
    title: 'The Random Chord Game',
    intro:
      "This is where real playing starts.",
    instructions: [
      'A chord appears every 4 beats.',
      'Play it before the next one.',
      'If you miss — KEEP GOING.',
    ],
    completionMessage:
      'Mistakes are fine. Stopping is not.',
    exercise: {
      kind: 'randomGame',
      beatsPerChord: 4,
      randomCount: 12,
    },
    suggestedBpm: 60,
    unlockAccuracy: 0.8,
  },
  {
    id: '4.2',
    moduleId: 'm4',
    title: 'Accuracy Training',
    intro:
      'Weak chords get circled. Practice those separately, then come back.',
    instructions: [
      'Run the round at 60 BPM.',
      'Review the circled misses at the end.',
      'Repeat until the weak chords become hits.',
    ],
    completionMessage:
      'The "circled" chords will disappear faster than you expect.',
    exercise: {
      kind: 'randomGame',
      beatsPerChord: 4,
      randomCount: 16,
    },
    suggestedBpm: 60,
    unlockAccuracy: 0.8,
  },
  {
    id: '4.3',
    moduleId: 'm4',
    title: 'Speed Mode',
    intro:
      'Hit 80% accuracy? Time to push. 70 → 100 BPM and beyond.',
    instructions: [
      'Start at 70 BPM.',
      'When clean, raise to 85, then 100.',
      'If accuracy drops below 80%, drop back 10 BPM.',
    ],
    completionMessage:
      'You can play real chord progressions in time. That is music.',
    exercise: {
      kind: 'randomGame',
      beatsPerChord: 4,
      randomCount: 16,
    },
    suggestedBpm: 85,
    unlockAccuracy: 0.8,
  },
]

export function lessonById(id: LessonId): LessonScript | null {
  return LESSONS.find((l) => l.id === id) ?? null
}

export function lessonsForModule(id: ModuleId): readonly LessonScript[] {
  return LESSONS.filter((l) => l.moduleId === id)
}

/** Index of `id` in `LESSONS`; -1 if not found. */
export function lessonOrder(id: LessonId): number {
  return LESSONS.findIndex((l) => l.id === id)
}
