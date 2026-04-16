/**
 * Chord Learning panel — always-visible practice surface for the Chord
 * subsystem. Renders with or without a loaded MIDI file. Sits next to the
 * song UI and is wired entirely through `usePianoLearner`.
 *
 * Contents:
 *   - Mode tabs: Free Practice | Lessons
 *   - Metronome strip (start/stop, BPM numeric + slider, beat dots)
 *   - Free Practice: chord select + big label + held-chord readout + mini piano
 *   - Lesson view: title, intro, instructions, current chord + next,
 *     beat indicator, accuracy, missed chords on finish
 *   - Lessons list grouped by module with unlock / progress state
 */

import { useCallback, useMemo, useState } from 'react'
import {
  chordLabel,
  chordPitchClasses,
  COMMON_CHORDS,
  pcMod,
} from '../chords/chordModel'
import {
  LESSONS,
  MODULES,
  lessonById,
  lessonOrder,
} from '../chords/lessonCatalog'
import { MAX_BPM, MIN_BPM } from '../chords/metronome'
import type { LessonProgressMap } from '../chords/chordUserPreferences'
import type { ExerciseSnapshot } from '../chords/exerciseEngine'
import type { ChordSpec, LessonId } from '../types'

export interface ChordPracticePanelProps {
  audioReady: boolean
  onEnableAudio: () => void | Promise<void>

  bpm: number
  setBpm: (n: number) => void
  /**
   * Starting tempo of the currently loaded MIDI file (null when no file is
   * loaded). In Free Practice the playback speed is scaled by `bpm / fileBpm`
   * — so setting `bpm === fileBpm` gives native 1.00× playback.
   */
  fileBpm: number | null
  metronomeRunning: boolean
  /**
   * Smart start/stop. When the metronome is stopped and an active lesson is
   * in its finished state, this resets the lesson instead of starting —
   * mirrored on the MIDI-bound metronome key (see `usePianoLearner`).
   */
  toggleMetronome: () => void | Promise<void>

  selectedChordIndex: number
  setSelectedChordIndex: (i: number) => void
  selectedChord: ChordSpec
  heldChord: { label: string; extras: number } | null

  activeLessonId: LessonId | null
  exerciseSnapshot: ExerciseSnapshot | null
  lessonProgress: LessonProgressMap
  startLesson: (id: LessonId) => void | Promise<void>
  exitLesson: () => void
  restartLesson: () => void

  /** Preview-next-chord UI setting (owned by usePianoLearner, configured in Settings). */
  previewNextChord: boolean

  /** Optional: USB MIDI device name for a small status line. */
  midiConnected: string | null
}

type Tab = 'free' | 'lessons'

/* ---------------- small pure helpers ---------------- */

/**
 * Compact "MIDI tempo · 1.00× speed" chip shown in the metronome strip while
 * a MIDI file is loaded in Free Practice. The button snaps the chord BPM
 * back to the file's authored tempo (native playback).
 */
function PlaybackSpeedChip({
  bpm,
  fileBpm,
  onMatch,
}: {
  bpm: number
  fileBpm: number
  onMatch: () => void
}) {
  const ratio = fileBpm > 0 ? bpm / fileBpm : 1
  const atNative = Math.abs(ratio - 1) < 0.005
  return (
    <span className="chord-playback-chip" role="status" aria-live="polite">
      <span className="muted chord-playback-chip-label">MIDI</span>
      <span className="chord-playback-chip-bpm">{Math.round(fileBpm)} BPM</span>
      <span className="muted chord-playback-chip-sep">·</span>
      <span
        className={
          'chord-playback-chip-rate' +
          (atNative ? '' : ' chord-playback-chip-rate--off')
        }
        title={
          atNative
            ? 'Playback at the MIDI file\u2019s authored tempo'
            : `Playback at ${ratio.toFixed(2)}\u00D7 the MIDI file\u2019s tempo`
        }
      >
        {ratio.toFixed(2)}&times;
      </span>
      <button
        type="button"
        className="chord-playback-chip-btn"
        onClick={onMatch}
        disabled={atNative}
        title="Set chord BPM to the MIDI file\u2019s authored tempo (1.00\u00D7)"
      >
        Match
      </button>
    </span>
  )
}

/** Render dots for beat-in-chord; filled up to `beat`. */
function BeatDots({
  beat,
  beatsPerChord,
}: {
  beat: number
  beatsPerChord: number
}) {
  const dots = []
  for (let i = 0; i < beatsPerChord; i++) {
    dots.push(
      <span
        key={i}
        className={
          'chord-beat-dot' + (i < beat ? ' chord-beat-dot--on' : '')
        }
        aria-hidden
      />,
    )
  }
  return (
    <div
      className="chord-beat-dots"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={beatsPerChord}
      aria-valuenow={beat}
      aria-label={`Beat ${beat} of ${beatsPerChord}`}
    >
      {dots}
    </div>
  )
}

/**
 * Mini keyboard diagram: one octave, white + black keys, highlights pitch
 * classes that are part of `chord` using the accent colour. Used in
 * Free Practice and in the lesson hero when an exercise is active.
 */
function ChordKeyboardPreview({
  chord,
  title,
}: {
  chord: ChordSpec | null
  title?: string
}) {
  const pcs = useMemo(
    () => (chord ? chordPitchClasses(chord.root, chord.quality) : new Set<number>()),
    [chord],
  )
  const whites = [0, 2, 4, 5, 7, 9, 11]
  const blacks: { pc: number; afterWhite: number }[] = [
    { pc: 1, afterWhite: 0 },
    { pc: 3, afterWhite: 1 },
    { pc: 6, afterWhite: 3 },
    { pc: 8, afterWhite: 4 },
    { pc: 10, afterWhite: 5 },
  ]
  const whiteWidth = 28
  const totalWidth = whiteWidth * whites.length
  const height = 100
  const blackWidth = whiteWidth * 0.6
  const blackHeight = height * 0.62

  return (
    <svg
      className="chord-mini-kb"
      viewBox={`0 0 ${totalWidth} ${height}`}
      width="100%"
      role="img"
      aria-label={title ?? 'Chord keyboard preview'}
    >
      {whites.map((pc, i) => {
        const on = pcs.has(pc)
        return (
          <rect
            key={`w-${pc}`}
            x={i * whiteWidth}
            y={0}
            width={whiteWidth}
            height={height}
            className={'chord-mini-kb-w' + (on ? ' chord-mini-kb-on' : '')}
            rx={2}
          />
        )
      })}
      {blacks.map(({ pc, afterWhite }) => {
        const on = pcs.has(pc)
        const x = (afterWhite + 1) * whiteWidth - blackWidth / 2
        return (
          <rect
            key={`b-${pc}`}
            x={x}
            y={0}
            width={blackWidth}
            height={blackHeight}
            className={'chord-mini-kb-b' + (on ? ' chord-mini-kb-on' : '')}
            rx={2}
          />
        )
      })}
    </svg>
  )
}

/* ---------------- panel ---------------- */

export function ChordPracticePanel({
  audioReady,
  onEnableAudio,
  bpm,
  setBpm,
  fileBpm,
  metronomeRunning,
  toggleMetronome,
  selectedChordIndex,
  setSelectedChordIndex,
  selectedChord,
  heldChord,
  activeLessonId,
  exerciseSnapshot,
  lessonProgress,
  startLesson,
  exitLesson,
  restartLesson,
  previewNextChord,
  midiConnected,
}: ChordPracticePanelProps) {
  /**
   * User-chosen tab. When a lesson is active we show "Lessons"; clicking
   * "Free Practice" while a lesson is active exits that lesson (see
   * {@link selectFreePractice}) so tabs behave as you would expect.
   */
  const [userTab, setUserTab] = useState<Tab>(activeLessonId ? 'lessons' : 'free')
  const tab: Tab = activeLessonId ? 'lessons' : userTab

  const selectFreePractice = useCallback(() => {
    if (activeLessonId) exitLesson()
    setUserTab('free')
  }, [activeLessonId, exitLesson])

  const selectLessons = useCallback(() => {
    setUserTab('lessons')
  }, [])

  const activeLesson = activeLessonId ? lessonById(activeLessonId) : null

  /** A lesson is unlocked iff: it's the first, OR the previous lesson reached its unlockAccuracy. */
  const isUnlocked = useCallback(
    (id: LessonId): boolean => {
      const i = lessonOrder(id)
      if (i <= 0) return true
      const prev = LESSONS[i - 1]!
      const prog = lessonProgress[prev.id]
      return (prog?.accuracy ?? 0) >= prev.unlockAccuracy
    },
    [lessonProgress],
  )

  const onBpmSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number.parseInt(e.target.value, 10)
    if (Number.isFinite(v)) setBpm(v)
  }

  /**
   * Metronome Start/Stop. The smart "finished lesson → reset back to lesson"
   * behaviour lives in the hook's `toggleMetronome`, so both this button and
   * the MIDI-bound metronome key share a single code path.
   */
  const onToggleMetronome = async () => {
    if (!audioReady) {
      await onEnableAudio()
      return
    }
    await toggleMetronome()
  }

  return (
    <section className="panel chord-panel" aria-label="Chord practice">
      <header className="chord-panel-head">
        <h2 className="chord-panel-title">Chord Practice</h2>
        <div className="chord-tabs" role="tablist" aria-label="Chord practice mode">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'free'}
            className={'chord-tab' + (tab === 'free' ? ' chord-tab--on' : '')}
            onClick={selectFreePractice}
            title={
              activeLessonId
                ? 'Exit the current lesson and switch to free practice'
                : 'Switch to free practice'
            }
          >
            Free Practice
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'lessons'}
            className={'chord-tab' + (tab === 'lessons' ? ' chord-tab--on' : '')}
            onClick={selectLessons}
          >
            Lessons
          </button>
        </div>
      </header>

      <div className="chord-metro">
        <button
          type="button"
          className={
            'btn chord-metro-toggle' +
            (metronomeRunning ? ' chord-metro-toggle--on' : '')
          }
          onClick={() => void onToggleMetronome()}
          title={
            !audioReady
              ? 'Tap to enable audio first'
              : metronomeRunning
                ? 'Stop metronome'
                : 'Start metronome'
          }
        >
          {metronomeRunning ? 'Stop' : 'Start'}
        </button>
        <label className="chord-bpm-label">
          BPM
          <input
            type="number"
            min={MIN_BPM}
            max={MAX_BPM}
            value={bpm}
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10)
              if (Number.isFinite(v)) setBpm(v)
            }}
            className="chord-bpm-num"
          />
        </label>
        <input
          type="range"
          min={MIN_BPM}
          max={MAX_BPM}
          step={1}
          value={bpm}
          onChange={onBpmSliderChange}
          className="chord-bpm-slider"
          aria-label="BPM"
        />
        <span className="muted chord-metro-hint">
          {metronomeRunning
            ? 'Click along — bind the start/stop and BPM knob in Settings → MIDI hardware.'
            : `Range ${MIN_BPM}–${MAX_BPM} BPM. Default 60.`}
        </span>
        {midiConnected ? (
          <span className="muted chord-metro-midi">MIDI: {midiConnected}</span>
        ) : null}
        {fileBpm != null && activeLessonId == null ? (
          <PlaybackSpeedChip
            bpm={bpm}
            fileBpm={fileBpm}
            onMatch={() => setBpm(Math.round(fileBpm))}
          />
        ) : null}
      </div>

      {tab === 'free' ? (
        <FreePracticeView
          selectedChordIndex={selectedChordIndex}
          setSelectedChordIndex={setSelectedChordIndex}
          selectedChord={selectedChord}
          heldChord={heldChord}
        />
      ) : (
        <LessonsView
          activeLesson={activeLesson}
          exerciseSnapshot={exerciseSnapshot}
          heldChord={heldChord}
          lessonProgress={lessonProgress}
          isUnlocked={isUnlocked}
          startLesson={startLesson}
          exitLesson={exitLesson}
          restartLesson={restartLesson}
          previewNext={previewNextChord}
        />
      )}
    </section>
  )
}

/* ---------------- Free Practice view ---------------- */

function FreePracticeView({
  selectedChordIndex,
  setSelectedChordIndex,
  selectedChord,
  heldChord,
}: {
  selectedChordIndex: number
  setSelectedChordIndex: (i: number) => void
  selectedChord: ChordSpec
  heldChord: { label: string; extras: number } | null
}) {
  const idx = Math.max(0, Math.min(COMMON_CHORDS.length - 1, selectedChordIndex))

  const step = (delta: number) => {
    const n = COMMON_CHORDS.length
    setSelectedChordIndex((((idx + delta) % n) + n) % n)
  }

  const matchesSelected =
    heldChord != null &&
    pcMod(selectedChord.root) === pcMod(heldChordRootFromLabel(heldChord.label))

  return (
    <div className="chord-free">
      <div className="chord-free-row">
        <label className="chord-picker-label">
          Chord
          <select
            className="chord-picker"
            value={idx}
            onChange={(e) =>
              setSelectedChordIndex(Number.parseInt(e.target.value, 10))
            }
          >
            {COMMON_CHORDS.map((c, i) => (
              <option key={`${c.label}-${i}`} value={i}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div className="chord-picker-step">
          <button
            type="button"
            className="btn small"
            onClick={() => step(-1)}
            aria-label="Previous chord"
            title="Previous chord"
          >
            ◀
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => step(1)}
            aria-label="Next chord"
            title="Next chord"
          >
            ▶
          </button>
        </div>
        <p className="muted chord-picker-hint">
          Bind a knob to “Chord picker” in Settings → MIDI hardware to scroll
          these with hardware. All major + minor triads around the circle of
          fifths.
        </p>
      </div>

      <div className="chord-hero">
        <div className="chord-hero-current">
          <span className="chord-hero-label">Selected chord</span>
          <span className="chord-hero-name">{chordLabel(selectedChord)}</span>
          <ChordKeyboardPreview
            chord={selectedChord}
            title={`Notes for ${chordLabel(selectedChord)}`}
          />
        </div>
        <div className="chord-held">
          <span className="chord-held-label">Held chord</span>
          <span
            className={
              'chord-held-name' +
              (heldChord ? '' : ' chord-held-name--empty') +
              (matchesSelected ? ' chord-held-name--match' : '')
            }
          >
            {heldChord?.label ?? '—'}
          </span>
          <span className="muted chord-held-hint">
            Detected from keys you are pressing on your MIDI keyboard (pitch
            classes — any octave).
          </span>
        </div>
      </div>

      <p className="hint chord-free-hint">
        Pick a chord on the left; play those notes on your keyboard. The Held
        chord panel names what you are holding. Start the metronome above to
        keep time.
      </p>
    </div>
  )
}

/** Recover a root pitch-class from a chord label like "C", "Gm", "Db", "F#m". */
function heldChordRootFromLabel(label: string): number {
  if (!label) return -1
  const first = label[0]!
  const second = label[1] ?? ''
  const root =
    first === 'C'
      ? 0
      : first === 'D'
        ? 2
        : first === 'E'
          ? 4
          : first === 'F'
            ? 5
            : first === 'G'
              ? 7
              : first === 'A'
                ? 9
                : first === 'B'
                  ? 11
                  : -1
  if (root < 0) return -1
  if (second === '#') return pcMod(root + 1)
  if (second === 'b') return pcMod(root - 1)
  return root
}

/* ---------------- Lessons view ---------------- */

function LessonsView({
  activeLesson,
  exerciseSnapshot,
  heldChord,
  lessonProgress,
  isUnlocked,
  startLesson,
  exitLesson,
  restartLesson,
  previewNext,
}: {
  activeLesson: ReturnType<typeof lessonById>
  exerciseSnapshot: ExerciseSnapshot | null
  heldChord: { label: string } | null
  lessonProgress: LessonProgressMap
  isUnlocked: (id: LessonId) => boolean
  startLesson: (id: LessonId) => void | Promise<void>
  exitLesson: () => void
  restartLesson: () => void
  previewNext: boolean
}) {
  if (activeLesson && exerciseSnapshot) {
    return (
      <ActiveLessonView
        lesson={activeLesson}
        snapshot={exerciseSnapshot}
        heldChord={heldChord}
        onExit={exitLesson}
        onRestart={restartLesson}
        previewNext={previewNext}
      />
    )
  }
  return (
    <div className="chord-lesson-list">
      {MODULES.map((m) => (
        <div key={m.id} className="chord-lesson-module">
          <div className="chord-lesson-module-head">
            <h3 className="chord-lesson-module-title">{m.title}</h3>
            <span className="muted chord-lesson-module-goal">{m.goal}</span>
          </div>
          <ul className="chord-lesson-items">
            {LESSONS.filter((l) => l.moduleId === m.id).map((l) => {
              const unlocked = isUnlocked(l.id)
              const prog = lessonProgress[l.id]
              const accPct =
                prog?.accuracy != null
                  ? Math.round(prog.accuracy * 100)
                  : null
              return (
                <li
                  key={l.id}
                  className={
                    'chord-lesson-item' +
                    (unlocked ? '' : ' chord-lesson-item--locked')
                  }
                >
                  <div className="chord-lesson-item-main">
                    <span className="chord-lesson-id">Lesson {l.id}</span>
                    <span className="chord-lesson-title">{l.title}</span>
                  </div>
                  <div className="chord-lesson-item-meta">
                    {accPct != null ? (
                      <span
                        className={
                          'chord-lesson-acc' +
                          (prog!.accuracy >= l.unlockAccuracy
                            ? ' chord-lesson-acc--pass'
                            : '')
                        }
                      >
                        {accPct}%
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                    <button
                      type="button"
                      className="btn small"
                      disabled={!unlocked}
                      onClick={() => void startLesson(l.id)}
                      title={
                        unlocked
                          ? 'Start lesson'
                          : `Reach ${Math.round(
                              LESSONS[lessonOrder(l.id) - 1]!.unlockAccuracy *
                                100,
                            )}% on the previous lesson to unlock`
                      }
                    >
                      {unlocked ? 'Start' : 'Locked'}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function ActiveLessonView({
  lesson,
  snapshot,
  heldChord,
  onExit,
  onRestart,
  previewNext,
}: {
  lesson: NonNullable<ReturnType<typeof lessonById>>
  snapshot: ExerciseSnapshot
  heldChord: { label: string } | null
  onExit: () => void
  onRestart: () => void
  previewNext: boolean
}) {
  const current = snapshot.current
  const next = snapshot.next
  const beat = snapshot.beatInChord
  const accuracyPct = Math.round(snapshot.accuracy * 100)
  const hits = snapshot.history.filter((h) => h.hit).length
  const misses = snapshot.history.length - hits
  const missedChords = useMemo(() => {
    const seen = new Set<string>()
    const out: ChordSpec[] = []
    for (const h of snapshot.history) {
      if (h.hit) continue
      if (seen.has(h.chord.label)) continue
      seen.add(h.chord.label)
      out.push(h.chord)
    }
    return out
  }, [snapshot.history])

  return (
    <div className="chord-lesson-active">
      <header className="chord-lesson-active-head">
        <div>
          <span className="muted chord-lesson-active-id">Lesson {lesson.id}</span>
          <h3 className="chord-lesson-active-title">{lesson.title}</h3>
        </div>
        <div className="chord-lesson-active-actions">
          <button type="button" className="btn small" onClick={onRestart}>
            Restart
          </button>
          <button type="button" className="btn small" onClick={onExit}>
            Exit
          </button>
        </div>
      </header>

      <div className="chord-lesson-copy">
        <p className="chord-lesson-intro">{lesson.intro}</p>
        <ol className="chord-lesson-instructions">
          {lesson.instructions.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      </div>

      {snapshot.finished ? (
        <div className="chord-lesson-finish">
          <h4 className="chord-lesson-finish-title">{lesson.completionMessage}</h4>
          <p className="chord-lesson-finish-stats">
            Accuracy: <strong>{accuracyPct}%</strong> ({hits} hit /{' '}
            {misses} miss)
          </p>
          {missedChords.length > 0 ? (
            <p className="chord-lesson-finish-missed">
              Missed chords to practice:{' '}
              {missedChords.map((c, i) => (
                <span key={c.label + i} className="chord-lesson-missed-pill">
                  {c.label}
                </span>
              ))}
            </p>
          ) : null}
          <div className="chord-lesson-finish-actions">
            <button type="button" className="btn primary" onClick={onRestart}>
              Play again
            </button>
            <button type="button" className="btn" onClick={onExit}>
              Back to lessons
            </button>
          </div>
        </div>
      ) : (
        <div className="chord-hero chord-hero--lesson">
          <div className="chord-hero-current">
            <span className="chord-hero-label">Current</span>
            <span className="chord-hero-name">
              {current ? chordLabel(current) : '—'}
            </span>
            <ChordKeyboardPreview chord={current} />
            <BeatDots
              beat={beat}
              beatsPerChord={snapshot.config.beatsPerChord}
            />
          </div>
          <div className="chord-hero-next">
            <span className="chord-hero-label">Next</span>
            <span className="chord-hero-name chord-hero-name--sm">
              {next ? chordLabel(next) : '—'}
            </span>
            {previewNext && next ? (
              <ChordKeyboardPreview
                chord={next}
                title={`Notes for upcoming chord ${chordLabel(next)}`}
              />
            ) : null}
          </div>
          <div className="chord-held chord-held--lesson">
            <span className="chord-held-label">Held</span>
            <span
              className={
                'chord-held-name' +
                (heldChord ? '' : ' chord-held-name--empty')
              }
            >
              {heldChord?.label ?? '—'}
            </span>
          </div>
        </div>
      )}

      <div className="chord-lesson-progress">
        <span className="muted">
          {snapshot.totalChords != null
            ? `Chord ${Math.min(
                snapshot.chordIndex + 1,
                snapshot.totalChords,
              )} / ${snapshot.totalChords}`
            : ''}
        </span>
        <span className="muted">Accuracy: {accuracyPct}%</span>
      </div>
    </div>
  )
}
