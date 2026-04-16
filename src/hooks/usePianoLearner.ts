import { Midi } from '@tonejs/midi'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import type { Soundfont } from 'smplr'
import {
  loadAcousticGrandPiano,
  resetPianoInstrumentCache,
} from '../audio/pianoInstrument'
import { computeFingeringMap } from '../engine/fingering'
import { PlaybackController } from '../engine/playbackController'
import {
  buildCcTrigger,
  defaultMidiHardwareBindings,
  findMatchingBindingFields,
  isCcMessage,
  isTriggerLearnMode,
  learnFromMessage,
  loadMidiHardwareBindings,
  matchesCcControl,
  matchesHardwareButtonTrigger,
  saveMidiHardwareBindings,
  type MidiHardwareBindings,
  type MidiLearnMode,
} from '../midi/midiHardwareBindings'
import { formatMidiMessage, shouldLogMidiMessage } from '../midi/midiMonitorFormat'
import {
  deleteMidiFile,
  getMidiFile,
  listStoredMidiMeta,
  loadPlaylistPersist,
  putMidiFile,
  savePlaylistPersist,
} from '../midi/midiPlaylistStorage'
import {
  normalizeTrackIndices,
  notesForTracks,
  trackSummaries,
} from '../midi/midiModel'
import {
  loadMidiVelocitySensitivity,
  saveMidiVelocitySensitivity,
} from '../midi/midiUserPreferences'
import type { ChordSpec, HandFilter, LessonId, PracticeMode } from '../types'
import {
  ccToTimeIndex,
  endAtOrAfter,
  onsetAtOrBefore,
  uniqueEnds,
  uniqueOnsets,
} from '../engine/loopSnap'
import {
  MAX_BPM,
  Metronome,
  MIN_BPM,
} from '../chords/metronome'
import { ExerciseEngine, type ExerciseSnapshot } from '../chords/exerciseEngine'
import {
  chordMidiNotes,
  COMMON_CHORDS,
  detectChordFromHeld,
  type DetectedChord,
} from '../chords/chordModel'
import { lessonById } from '../chords/lessonCatalog'
import {
  loadActiveLessonId,
  loadBpm,
  loadLessonProgress,
  loadPreviewNextChord,
  loadSelectedChordIndex,
  saveActiveLessonId,
  saveBpm,
  saveLessonProgress,
  savePreviewNextChord,
  saveSelectedChordIndex,
  type LessonProgressMap,
} from '../chords/chordUserPreferences'

/** Fixed wall-clock step for ←/→ (musical beat length varies with tempo and confuses scrubbing). */
const ARROW_NUDGE_SEC = 0.5

function sameTrackIndexList(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export type UsePianoLearnerOptions = {
  /** Called after loop is cleared (Escape, MIDI stop, Clear loop) — e.g. close sheet overlay. */
  onLoopCleared?: () => void
  /** Set loop (1s window) centered on current playhead — MIDI “record” / learned control. */
  onLoopAtPlayhead?: () => void
  /**
   * When `.current` is true, Space / arrows / Home do not control transport (e.g. settings modal open).
   * MIDI learn mode blocks those keys inside the hook regardless.
   */
  keyboardTransportBlockedRef?: MutableRefObject<boolean>
}

export function usePianoLearner(options: UsePianoLearnerOptions = {}) {
  const { onLoopCleared, onLoopAtPlayhead, keyboardTransportBlockedRef } =
    options
  const onLoopAtPlayheadRef = useRef(onLoopAtPlayhead)
  const ctxRef = useRef<AudioContext | null>(null)
  const pianoRef = useRef<Soundfont | null>(null)
  const controllerRef = useRef<PlaybackController | null>(null)
  const userStopsRef = useRef<Map<number, ReturnType<Soundfont['start']>>>(
    new Map(),
  )
  const rafRef = useRef<number>(0)

  const [audioReady, setAudioReady] = useState(false)
  const [sfLoadTotal, setSfLoadTotal] = useState(0)
  const [sfLoadDone, setSfLoadDone] = useState(0)

  const [midi, setMidi] = useState<Midi | null>(null)
  const [fileName, setFileName] = useState<string>('')
  const [playlist, setPlaylist] = useState<{ id: string; name: string }[]>([])
  const [currentPlaylistId, setCurrentPlaylistId] = useState<string | null>(null)
  const [playlistHydrated, setPlaylistHydrated] = useState(false)
  const [selectedTrackIndices, setSelectedTrackIndicesState] = useState<
    number[]
  >([0])
  const [mode, setMode] = useState<PracticeMode>('listen')
  const [playing, setPlaying] = useState(false)
  const [songTime, setSongTime] = useState(0)
  const [splitMidi, setSplitMidi] = useState(60)
  /** Multiplier for USB MIDI note-on velocity (1 = as sent; higher = louder at same touch). */
  const [midiVelocitySensitivity, setMidiVelocitySensitivity] = useState(
    loadMidiVelocitySensitivity,
  )

  const [handFilter, setHandFilter] = useState<HandFilter>('both')

  const [loopEnabled, setLoopEnabled] = useState(false)
  const [loopA, setLoopA] = useState(0)
  const [loopB, setLoopB] = useState(8)
  const [loopCenter, setLoopCenter] = useState<number | null>(null)

  const [midiConnected, setMidiConnected] = useState<string | null>(null)

  const [midiHardwareBindings, setMidiHardwareBindings] =
    useState<MidiHardwareBindings>(() => loadMidiHardwareBindings())
  const [midiLearnMode, setMidiLearnMode] = useState<MidiLearnMode | null>(null)
  const [midiActivityLog, setMidiActivityLog] = useState<string[]>([])
  /**
   * Binding fields whose MIDI source was just touched (press/release, or a
   * knob that is currently moving). Used by the MIDI mapping UI to flash the
   * row so the user can see what the key/knob they pressed is already bound
   * to. Auto-clears after a short idle window per field — see the per-field
   * timers on {@link activeBindingTimersRef} below.
   */
  const [activeBindingFields, setActiveBindingFields] = useState<
    ReadonlySet<keyof MidiHardwareBindings>
  >(() => new Set())
  const activeBindingTimersRef = useRef<
    Partial<Record<keyof MidiHardwareBindings, ReturnType<typeof setTimeout>>>
  >({})

  const bindingsRef = useRef(midiHardwareBindings)
  const midiLearnModeRef = useRef(midiLearnMode)

  /**
   * CC trigger learn: first CC captured here, waiting for a second (release).
   * If a second CC on the same controller arrives quickly, it's a momentary
   * button → store pressValue = firstValue (fire only on press, ignore release).
   * If the timeout fires first, it's a toggle button → no pressValue (fire on any value).
   */
  const ccLearnPendingRef = useRef<{
    mode: Parameters<typeof buildCcTrigger>[0]
    channel: number
    controller: number
    firstValue: number
    timer: ReturnType<typeof setTimeout>
  } | null>(null)

  const songTimeRef = useRef(songTime)
  const loopARef = useRef(loopA)
  const loopBRef = useRef(loopB)
  const loopEnabledRef = useRef(loopEnabled)
  const loopCenterRef = useRef(loopCenter)
  const noteOnsetsRef = useRef<number[]>([])
  const noteEndsRef = useRef<number[]>([])

  /** Soft-takeover: knob is ignored until it crosses the current parameter value. */
  const knobPickedUp = useRef({
    loopStart: false,
    loopEnd: false,
    loopShift: false,
    trackFocus: false,
    metronomeBpm: false,
    chordPicker: false,
  })
  /** Which MIDI file track index the hardware “track toggle” acts on (tracks with notes only). */
  const trackFocusRef = useRef<number | null>(null)
  /** Mirrors {@link trackFocusRef} for UI (track dropdown highlights + opens on knob). */
  const [midiTrackFocusIndex, setMidiTrackFocusIndex] = useState<number | null>(
    null,
  )
  /** Incremented when the MIDI track focus knob updates focus — opens the tracks dropdown. */
  const [midiTrackDropdownBump, setMidiTrackDropdownBump] = useState(0)
  useLayoutEffect(() => {
    onLoopAtPlayheadRef.current = onLoopAtPlayhead
    bindingsRef.current = midiHardwareBindings
    midiLearnModeRef.current = midiLearnMode
    songTimeRef.current = songTime
    loopARef.current = loopA
    loopBRef.current = loopB
    loopEnabledRef.current = loopEnabled
    loopCenterRef.current = loopCenter
  }, [
    onLoopAtPlayhead,
    midiHardwareBindings,
    midiLearnMode,
    songTime,
    loopA,
    loopB,
    loopEnabled,
    loopCenter,
  ])

  const [userPressedMidi, setUserPressedMidi] = useState<Set<number>>(
    () => new Set(),
  )
  const [waitExpectedMidi, setWaitExpectedMidi] = useState<Set<number> | null>(null)

  const userPressedMidiRef = useRef(userPressedMidi)
  useLayoutEffect(() => {
    userPressedMidiRef.current = userPressedMidi
  }, [userPressedMidi])

  /* ---------------- Chord Learning state ---------------- */
  const metronomeRef = useRef<Metronome | null>(null)
  const exerciseRef = useRef<ExerciseEngine | null>(null)
  const [bpm, setBpmState] = useState<number>(() => loadBpm())
  const [metronomeRunning, setMetronomeRunning] = useState(false)
  const [selectedChordIndex, setSelectedChordIndexState] = useState<number>(
    () => loadSelectedChordIndex(),
  )
  const [activeLessonId, setActiveLessonIdState] = useState<LessonId | null>(
    () => loadActiveLessonId(),
  )
  const [exerciseSnapshot, setExerciseSnapshot] =
    useState<ExerciseSnapshot | null>(null)
  const [lessonProgress, setLessonProgress] = useState<LessonProgressMap>(
    () => loadLessonProgress(),
  )
  /**
   * "Preview next chord" — when on, the lesson hero also renders the mini
   * piano under the "Next" label, not just the chord name. Exposed here so
   * the Settings modal (canonical toggle) and the Chord panel read the same
   * value. Persisted; defaults to on for new users.
   */
  const [previewNextChord, setPreviewNextChordState] = useState<boolean>(
    () => loadPreviewNextChord(),
  )

  const bpmRef = useRef(bpm)
  useLayoutEffect(() => {
    bpmRef.current = bpm
  }, [bpm])

  const selectedChord: ChordSpec =
    COMMON_CHORDS[selectedChordIndex % COMMON_CHORDS.length] ??
    COMMON_CHORDS[0]!

  const heldChord = useMemo<DetectedChord | null>(
    () => detectChordFromHeld(userPressedMidi),
    [userPressedMidi],
  )

  /**
   * Keyboard notes to highlight as "expected" for chord practice. The panel
   * surfaces this to `AlignedKeybed` via `expectedMidi` (same channel the song
   * mode uses). Returns an empty set when neither a chord is selected nor an
   * exercise is running.
   */
  const chordExpectedMidi = useMemo<Set<number>>(() => {
    if (exerciseSnapshot?.current) {
      return new Set(
        chordMidiNotes(
          exerciseSnapshot.current.root,
          exerciseSnapshot.current.quality,
          exerciseSnapshot.currentOctave,
        ),
      )
    }
    if (!activeLessonId) {
      return new Set(
        chordMidiNotes(selectedChord.root, selectedChord.quality, 4),
      )
    }
    return new Set<number>()
  }, [exerciseSnapshot, activeLessonId, selectedChord])

  const ensureAudio = useCallback(async () => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext()
    }
    const ctx = ctxRef.current
    if (ctx.state !== 'running' && ctx.state !== 'closed') {
      await ctx.resume().catch(() => {
        /* resume can fail if context is closing; ignore */
      })
    }
    if (!pianoRef.current) {
      try {
        const p = await loadAcousticGrandPiano(ctx, (done, total) => {
          setSfLoadDone(done)
          setSfLoadTotal(total)
        })
        pianoRef.current = p
        if (!controllerRef.current) {
          controllerRef.current = new PlaybackController(ctx, () => pianoRef.current)
        }
      } catch (e) {
        resetPianoInstrumentCache()
        throw e
      }
    }
    if (!metronomeRef.current) {
      const m = new Metronome(ctx)
      m.setBpm(bpmRef.current)
      m.onBeat(() => {
        const eng = exerciseRef.current
        if (eng) {
          eng.observeHeld(userPressedMidiRef.current)
          const snap = eng.beat()
          setExerciseSnapshot(snap)
          if (snap.finished) {
            metronomeRef.current?.stop()
            setMetronomeRunning(false)
          }
        }
      })
      metronomeRef.current = m
    }
    setAudioReady(true)
    return ctx
  }, [])

  const tracks = useMemo(
    () => (midi ? trackSummaries(midi) : []),
    [midi],
  )

  const setSelectedTrackIndices = useCallback(
    (indices: number[] | ((prev: number[]) => number[])) => {
      setSelectedTrackIndicesState((prev) => {
        const next = typeof indices === 'function' ? indices(prev) : indices
        if (!midi) {
          const u = [...new Set(next)]
            .filter((i) => Number.isFinite(i) && i >= 0)
            .sort((a, b) => a - b)
          return u.length > 0 ? u : [0]
        }
        return normalizeTrackIndices(midi, next)
      })
    },
    [midi],
  )

  useEffect(() => {
    if (!midi) return
    setSelectedTrackIndicesState((prev) => {
      const next = normalizeTrackIndices(midi, prev)
      return sameTrackIndexList(next, prev) ? prev : next
    })
  }, [midi])

  useEffect(() => {
    if (!midi) {
      trackFocusRef.current = null
      setMidiTrackFocusIndex(null)
      return
    }
    const selectable = trackSummaries(midi)
      .filter((s) => s.noteCount > 0)
      .map((s) => s.index)
      .sort((a, b) => a - b)
    if (selectable.length === 0) {
      trackFocusRef.current = null
      setMidiTrackFocusIndex(null)
      return
    }
    const cur = trackFocusRef.current
    if (cur == null || !selectable.includes(cur)) {
      trackFocusRef.current = selectable[0]
    }
    setMidiTrackFocusIndex(trackFocusRef.current)
  }, [midi])

  const playbackNotes = useMemo(() => {
    if (!midi) return []
    const raw = notesForTracks(midi, selectedTrackIndices)
    if (handFilter === 'both') return raw
    return raw.filter((n) =>
      handFilter === 'left' ? n.midi < splitMidi : n.midi >= splitMidi,
    )
  }, [midi, selectedTrackIndices, handFilter, splitMidi])

  const noteOnsets = useMemo(() => uniqueOnsets(playbackNotes), [playbackNotes])
  const noteEnds = useMemo(() => uniqueEnds(playbackNotes), [playbackNotes])

  /**
   * Starting BPM declared in the MIDI file's first tempo event. Used as the
   * baseline for playback-rate scaling in Free Practice: the controller's
   * `timeScale = chordBpm / fileBpm`, so setting the chord BPM to this value
   * gives native 1.00× playback. `null` when no file is loaded or the file
   * has no tempo metadata.
   */
  const fileBpm = useMemo<number | null>(() => {
    if (!midi) return null
    const t = midi.header.tempos?.[0]?.bpm
    return typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : 120
  }, [midi])

  useLayoutEffect(() => {
    noteOnsetsRef.current = noteOnsets
    noteEndsRef.current = noteEnds
  }, [noteOnsets, noteEnds])

  const fingeringMap = useMemo(() => {
    if (!midi) return new Map<string, number>()
    let notes = notesForTracks(midi, selectedTrackIndices)
    if (handFilter !== 'both') {
      notes = notes.filter((n) =>
        handFilter === 'left' ? n.midi < splitMidi : n.midi >= splitMidi,
      )
    }
    return computeFingeringMap(
      notes.map((n) => ({ time: n.time, midi: n.midi })),
      splitMidi,
    )
  }, [midi, selectedTrackIndices, splitMidi, handFilter])

  const applyMidiFromBuffer = useCallback(
    async (buf: ArrayBuffer, name: string) => {
      setLoopEnabled(false)
      onLoopCleared?.()
      await ensureAudio()
      const m = new Midi(buf)
      setFileName(name)
      setMidi(m)
      /* Pick up the file's starting BPM so Free Practice uses it as the
         playback baseline (1.00× speed at that tempo). Skip if a lesson is
         active — lessons own their own BPM via `suggestedBpm`. */
      const firstTempo = m.header.tempos?.[0]?.bpm
      if (
        typeof firstTempo === 'number' &&
        Number.isFinite(firstTempo) &&
        activeLessonIdRef.current == null
      ) {
        const clamped = Math.max(
          MIN_BPM,
          Math.min(MAX_BPM, Math.round(firstTempo)),
        )
        setBpmState(clamped)
        metronomeRef.current?.setBpm(clamped)
      }
      const summaries = trackSummaries(m)
      const firstWithNotes = summaries.find((s) => s.noteCount > 0)?.index ?? 0
      setSelectedTrackIndicesState([firstWithNotes])
      const ctl = controllerRef.current
      if (ctl) {
        ctl.setMidi(m)
        ctl.setSelectedTracks([firstWithNotes])
        ctl.mode = mode
        ctl.seek(0)
        ctl.pause()
        ctl.loop = null
        setPlaying(false)
        setSongTime(0)
        const dur = m.duration
        setLoopA(0)
        setLoopB(Math.min(8, dur || 8))
        knobPickedUp.current = {
          loopStart: false,
          loopEnd: false,
          loopShift: false,
          trackFocus: false,
          metronomeBpm: knobPickedUp.current.metronomeBpm,
          chordPicker: knobPickedUp.current.chordPicker,
        }
        setWaitExpectedMidi(null)
      }
    },
    [ensureAudio, mode, onLoopCleared],
  )

  const applyMidiFromBufferRef = useRef(applyMidiFromBuffer)
  applyMidiFromBufferRef.current = applyMidiFromBuffer

  const newMidiId = () =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  /** Add one or more MIDI files to the cache and playlist; loads the last file added. */
  const addMidiFiles = useCallback(
    async (files: FileList | readonly File[]) => {
      const list = Array.from(files).filter((f) => /\.(mid|midi)$/i.test(f.name))
      if (list.length === 0) return
      await ensureAudio()
      let ids = [...loadPlaylistPersist().ids]
      const appended: { id: string; name: string }[] = []
      let lastId = ''
      let lastBuf: ArrayBuffer | null = null
      let lastName = ''
      for (const file of list) {
        const buf = await file.arrayBuffer()
        const copy = buf.slice(0)
        const id = newMidiId()
        await putMidiFile({
          id,
          name: file.name,
          addedAt: Date.now(),
          buffer: copy,
        })
        ids.push(id)
        appended.push({ id, name: file.name })
        lastId = id
        lastBuf = copy
        lastName = file.name
      }
      savePlaylistPersist({ ids, currentId: lastId })
      setPlaylist((prev) => [...prev, ...appended])
      setCurrentPlaylistId(lastId)
      if (lastBuf) await applyMidiFromBuffer(lastBuf, lastName)
    },
    [applyMidiFromBuffer, ensureAudio],
  )

  const selectPlaylistSong = useCallback(
    async (id: string) => {
      const row = await getMidiFile(id)
      if (!row) return
      savePlaylistPersist({ ...loadPlaylistPersist(), currentId: id })
      setCurrentPlaylistId(id)
      await applyMidiFromBuffer(row.buffer.slice(0), row.name)
    },
    [applyMidiFromBuffer],
  )

  const removePlaylistSong = useCallback(
    async (id: string) => {
      const persist = loadPlaylistPersist()
      const oldIds = persist.ids
      const idx = oldIds.indexOf(id)
      const newIds = oldIds.filter((x) => x !== id)
      await deleteMidiFile(id)
      let newCurrent = persist.currentId
      if (persist.currentId === id) {
        if (newIds.length === 0) newCurrent = null
        else {
          const i = Math.min(Math.max(0, idx), newIds.length - 1)
          newCurrent = newIds[i]!
        }
      }
      savePlaylistPersist({ ids: newIds, currentId: newCurrent })
      setPlaylist((prev) => prev.filter((p) => p.id !== id))
      setCurrentPlaylistId(newCurrent)
      if (persist.currentId === id) {
        if (newCurrent) {
          const row = await getMidiFile(newCurrent)
          if (row) await applyMidiFromBuffer(row.buffer.slice(0), row.name)
        } else {
          setLoopEnabled(false)
          onLoopCleared?.()
          await ensureAudio()
          setMidi(null)
          setFileName('')
          setWaitExpectedMidi(null)
          const ctl = controllerRef.current
          if (ctl) {
            ctl.setMidi(null)
            ctl.pause()
            ctl.seek(0)
            setPlaying(false)
            setSongTime(0)
            setLoopA(0)
            setLoopB(8)
            ctl.loop = null
          }
          knobPickedUp.current = {
            loopStart: false,
            loopEnd: false,
            loopShift: false,
            trackFocus: false,
            metronomeBpm: knobPickedUp.current.metronomeBpm,
            chordPicker: knobPickedUp.current.chordPicker,
          }
        }
      }
    },
    [applyMidiFromBuffer, ensureAudio, onLoopCleared],
  )

  const nextPlaylistSong = useCallback(async () => {
    if (playlist.length === 0) return
    const ids = playlist.map((p) => p.id)
    const i = currentPlaylistId ? ids.indexOf(currentPlaylistId) : 0
    const cur = i < 0 ? 0 : i
    const nextIdx = (cur + 1) % ids.length
    await selectPlaylistSong(ids[nextIdx]!)
  }, [playlist, currentPlaylistId, selectPlaylistSong])

  const previousPlaylistSong = useCallback(async () => {
    if (playlist.length === 0) return
    const ids = playlist.map((p) => p.id)
    const i = currentPlaylistId ? ids.indexOf(currentPlaylistId) : 0
    const cur = i < 0 ? 0 : i
    const prevIdx = (cur - 1 + ids.length) % ids.length
    await selectPlaylistSong(ids[prevIdx]!)
  }, [playlist, currentPlaylistId, selectPlaylistSong])

  const nextPlaylistSongRef = useRef(nextPlaylistSong)
  const prevPlaylistSongRef = useRef(previousPlaylistSong)
  nextPlaylistSongRef.current = nextPlaylistSong
  prevPlaylistSongRef.current = previousPlaylistSong

  const activeLessonIdRef = useRef(activeLessonId)
  const selectedChordIndexRef = useRef(selectedChordIndex)
  useLayoutEffect(() => {
    activeLessonIdRef.current = activeLessonId
    selectedChordIndexRef.current = selectedChordIndex
  }, [activeLessonId, selectedChordIndex])

  /**
   * In Free Practice (no lesson active), the chord-practice BPM drives the
   * playback rate of the loaded MIDI file: `timeScale = bpm / fileBpm`. When
   * a lesson is active we force 1.00× so lesson BPMs don't distort song
   * playback. `audioReady` is in the deps so we also push an initial rate
   * right after the controller is created.
   */
  useEffect(() => {
    const ctl = controllerRef.current
    if (!ctl) return
    const scale =
      activeLessonId == null && fileBpm != null && fileBpm > 0
        ? bpm / fileBpm
        : 1
    ctl.setTimeScale(scale)
  }, [bpm, fileBpm, activeLessonId, audioReady])

  /** Forward refs for chord callbacks consumed inside the long-lived MIDI `onMsg`. */
  const toggleMetronomeRef = useRef<() => void | Promise<void>>(() => {})
  const setBpmRef = useRef<(n: number) => void>(() => {})
  const setSelectedChordIndexRef = useRef<(i: number) => void>(() => {})

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const persist = loadPlaylistPersist()
        const metas = await listStoredMidiMeta()
        const metaById = new Map(metas.map((m) => [m.id, m]))
        let ids = persist.ids.filter((id) => metaById.has(id))
        if (ids.length === 0 && metas.length > 0) {
          ids = [...metas]
            .sort((a, b) => a.addedAt - b.addedAt)
            .map((m) => m.id)
        }
        let currentId =
          persist.currentId && ids.includes(persist.currentId)
            ? persist.currentId
            : ids[0] ?? null
        savePlaylistPersist({ ids, currentId })
        const pl = ids.map((id) => ({
          id,
          name: metaById.get(id)!.name,
        }))
        if (cancelled) return
        setPlaylist(pl)
        setCurrentPlaylistId(currentId)
        if (currentId) {
          const row = await getMidiFile(currentId)
          if (row && !cancelled) {
            await applyMidiFromBufferRef.current(row.buffer.slice(0), row.name)
          }
        }
      } catch {
        /* IndexedDB unavailable or corrupt — still show UI */
      }
      if (!cancelled) setPlaylistHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const ctl = controllerRef.current
    if (!ctl) return
    ctl.mode = mode
    if (mode !== 'wait') {
      ctl.resetWaitState()
      setWaitExpectedMidi(null)
    }
  }, [mode])

  useEffect(() => {
    const ctl = controllerRef.current
    if (!ctl) return
    ctl.setHandFilter(handFilter, splitMidi)
  }, [handFilter, splitMidi])

  useEffect(() => {
    const ctl = controllerRef.current
    if (!ctl || !midi) return
    ctl.setSelectedTracks(selectedTrackIndices)
  }, [selectedTrackIndices, midi])

  const togglePlay = useCallback(async () => {
    await ensureAudio()
    const ctl = controllerRef.current
    const ctx = ctxRef.current
    if (!ctl || !ctx || !midi) return
    if (ctl.playing) {
      ctl.pause()
      setPlaying(false)
      setSongTime(ctl.getSongTime())
      setWaitExpectedMidi(null)
    } else {
      ctl.start()
      setPlaying(true)
    }
  }, [ensureAudio, midi])

  /** MIDI Stop — pause only (does not clear loop). */
  const pausePlayback = useCallback(() => {
    const ctl = controllerRef.current
    if (!ctl?.playing) return
    ctl.pause()
    setPlaying(false)
    setSongTime(ctl.getSongTime())
    setWaitExpectedMidi(null)
  }, [])

  const seek = useCallback((t: number) => {
    const ctl = controllerRef.current
    if (ctl) {
      ctl.seek(t)
      setSongTime(ctl.getSongTime())
      setWaitExpectedMidi(ctl.getWaitExpectedMidi())
    } else {
      setSongTime(t)
      setWaitExpectedMidi(null)
    }
  }, [])

  const nudgePlayhead = useCallback(
    (direction: number) => {
      if (!midi) return
      const ctl = controllerRef.current
      if (!ctl) return
      const now = ctl.getSongTime()
      const dt = Math.sign(direction) * ARROW_NUDGE_SEC
      const t = Math.max(0, Math.min(midi.duration, now + dt))
      seek(t)
    },
    [midi, seek],
  )

  const jumpToStart = useCallback(() => {
    seek(0)
  }, [seek])

  const initLoopAtCenter = useCallback(
    (center: number) => {
      const onsets = noteOnsetsRef.current
      const ends = noteEndsRef.current
      if (onsets.length === 0 || ends.length === 0) return
      const a = onsetAtOrBefore(onsets, center)
      let b = endAtOrAfter(ends, center)
      if (b <= a + 0.05) b = a + 0.05
      setLoopCenter(center)
      setLoopA(a)
      setLoopB(b)
      setLoopEnabled(true)
      knobPickedUp.current = {
        loopStart: false,
        loopEnd: false,
        loopShift: false,
        trackFocus: knobPickedUp.current.trackFocus,
        metronomeBpm: knobPickedUp.current.metronomeBpm,
        chordPicker: knobPickedUp.current.chordPicker,
      }
    },
    [setLoopA, setLoopB, setLoopEnabled],
  )
  const initLoopAtCenterRef = useRef(initLoopAtCenter)
  useLayoutEffect(() => {
    initLoopAtCenterRef.current = initLoopAtCenter
  }, [initLoopAtCenter])

  const clearLoop = useCallback(() => {
    setLoopEnabled(false)
    setLoopCenter(null)
    knobPickedUp.current = {
      loopStart: false,
      loopEnd: false,
      loopShift: false,
      trackFocus: false,
      metronomeBpm: knobPickedUp.current.metronomeBpm,
      chordPicker: knobPickedUp.current.chordPicker,
    }
    onLoopCleared?.()
  }, [onLoopCleared])

  const MODES: PracticeMode[] = ['listen', 'follow', 'wait']
  const HANDS: HandFilter[] = ['both', 'right', 'left']

  const cycleMode = useCallback(() => {
    setMode((prev) => MODES[(MODES.indexOf(prev) + 1) % MODES.length]!)
  }, [])

  const cycleHand = useCallback(() => {
    setHandFilter((prev) => HANDS[(HANDS.indexOf(prev) + 1) % HANDS.length]!)
  }, [])

  useEffect(() => {
    saveMidiHardwareBindings(midiHardwareBindings)
  }, [midiHardwareBindings])

  useEffect(() => {
    saveMidiVelocitySensitivity(midiVelocitySensitivity)
  }, [midiVelocitySensitivity])

  useEffect(() => {
    if (ccLearnPendingRef.current) {
      clearTimeout(ccLearnPendingRef.current.timer)
      ccLearnPendingRef.current = null
    }
  }, [midiLearnMode])

  const clearMidiActivityLog = useCallback(() => setMidiActivityLog([]), [])

  const resetMidiHardwareBindings = useCallback(() => {
    setMidiHardwareBindings({ ...defaultMidiHardwareBindings })
  }, [])

  useEffect(() => {
    const timers = activeBindingTimersRef.current
    return () => {
      for (const t of Object.values(timers)) {
        if (t != null) clearTimeout(t)
      }
    }
  }, [])

  /* ---------------- Chord Learning API ---------------- */

  const setBpm = useCallback((value: number) => {
    const clamped = Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(value)))
    setBpmState(clamped)
    metronomeRef.current?.setBpm(clamped)
  }, [])

  useEffect(() => {
    saveBpm(bpm)
  }, [bpm])

  useEffect(() => {
    saveSelectedChordIndex(selectedChordIndex)
  }, [selectedChordIndex])

  useEffect(() => {
    saveActiveLessonId(activeLessonId)
  }, [activeLessonId])

  useEffect(() => {
    saveLessonProgress(lessonProgress)
  }, [lessonProgress])

  const setPreviewNextChord = useCallback((value: boolean) => {
    setPreviewNextChordState(value)
    savePreviewNextChord(value)
  }, [])

  const setSelectedChordIndex = useCallback((index: number) => {
    const len = COMMON_CHORDS.length
    const next = ((index % len) + len) % len
    setSelectedChordIndexState(next)
  }, [])

  const startMetronome = useCallback(async () => {
    await ensureAudio()
    metronomeRef.current?.setBpm(bpmRef.current)
    metronomeRef.current?.start()
    setMetronomeRunning(true)
  }, [ensureAudio])

  const stopMetronome = useCallback(() => {
    metronomeRef.current?.stop()
    setMetronomeRunning(false)
  }, [])

  const startLesson = useCallback(
    async (id: LessonId) => {
      const lesson = lessonById(id)
      if (!lesson) return
      await ensureAudio()
      exerciseRef.current = new ExerciseEngine(lesson.exercise)
      setExerciseSnapshot(exerciseRef.current.snapshot())
      setActiveLessonIdState(id)
      setBpm(lesson.suggestedBpm)
    },
    [ensureAudio, setBpm],
  )

  const exitLesson = useCallback(() => {
    stopMetronome()
    exerciseRef.current = null
    setExerciseSnapshot(null)
    setActiveLessonIdState(null)
  }, [stopMetronome])

  const restartLesson = useCallback(() => {
    const id = activeLessonId
    if (!id) return
    const lesson = lessonById(id)
    if (!lesson) return
    stopMetronome()
    exerciseRef.current = new ExerciseEngine(lesson.exercise)
    setExerciseSnapshot(exerciseRef.current.snapshot())
  }, [activeLessonId, stopMetronome])

  /**
   * Smart Start/Stop — used by the on-screen Start button, the MIDI-bound
   * metronome key, and any future surfaces. Order of checks:
   *   1) Metronome is running → stop it.
   *   2) Metronome is stopped AND an active lesson just finished → reset the
   *      exercise engine back to its first chord, but leave the metronome
   *      stopped. The user is now looking at a fresh lesson view; a second
   *      press actually starts the round.
   *   3) Otherwise → start the metronome.
   *
   * Reading `exerciseRef.current?.snapshot().finished` instead of the React
   * `exerciseSnapshot` state keeps this callback stable (no dep churn on
   * every beat) while still observing the engine's current state.
   */
  const toggleMetronome = useCallback(async () => {
    if (metronomeRef.current?.running) {
      stopMetronome()
      return
    }
    const snap = exerciseRef.current?.snapshot()
    if (snap?.finished && activeLessonIdRef.current) {
      restartLesson()
      return
    }
    await startMetronome()
  }, [restartLesson, startMetronome, stopMetronome])

  /** Record best-seen accuracy when an exercise finishes. */
  useEffect(() => {
    if (!exerciseSnapshot?.finished || !activeLessonId) return
    setLessonProgress((prev) => {
      const prior = prev[activeLessonId]?.accuracy ?? 0
      if (exerciseSnapshot.accuracy <= prior) return prev
      return {
        ...prev,
        [activeLessonId]: {
          accuracy: exerciseSnapshot.accuracy,
          updatedAt: Date.now(),
        },
      }
    })
  }, [exerciseSnapshot?.finished, exerciseSnapshot?.accuracy, activeLessonId])

  useLayoutEffect(() => {
    toggleMetronomeRef.current = toggleMetronome
    setBpmRef.current = setBpm
    setSelectedChordIndexRef.current = setSelectedChordIndex
  }, [toggleMetronome, setBpm, setSelectedChordIndex])

  /* Feed held chord into the running exercise so hits can be detected between beats. */
  useEffect(() => {
    exerciseRef.current?.observeHeld(userPressedMidi)
  }, [userPressedMidi])

  /* Tear down the metronome when the hook unmounts (audio context closes too). */
  useEffect(() => {
    return () => {
      metronomeRef.current?.dispose()
      metronomeRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!playing) return
    const loop = () => {
      const ctl = controllerRef.current
      if (ctl?.playing) {
        ctl.tick()
        setSongTime(ctl.getSongTime())
        setWaitExpectedMidi(ctl.getWaitExpectedMidi())
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing])

  useEffect(() => {
    const wake = () => {
      const ctx = ctxRef.current
      if (ctx && ctx.state !== 'closed' && ctx.state !== 'running') {
        void ctx.resume()
      }
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') wake()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', wake)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', wake)
    }
  }, [])

  const playUserNote = useCallback(
    (midiNum: number, velocity = 0.85) => {
      const p = pianoRef.current
      const ctx = ctxRef.current
      if (!p || !ctx) return
      if (ctx.state !== 'running' && ctx.state !== 'closed') {
        void ctx.resume()
      }
      userStopsRef.current.get(midiNum)?.()
      const v =
        velocity <= 1
          ? Math.round(velocity * 127)
          : Math.min(127, Math.round(velocity))
      const stop = p.start({
        note: midiNum,
        velocity: Math.max(1, v),
        time: ctx.currentTime,
        duration: 2,
      })
      userStopsRef.current.set(midiNum, stop)
    },
    [],
  )

  const stopUserNote = useCallback((midiNum: number) => {
    userStopsRef.current.get(midiNum)?.(ctxRef.current?.currentTime)
    userStopsRef.current.delete(midiNum)
  }, [])

  const onUserNoteOn = useCallback(
    (midiNum: number, vel?: number) => {
      setUserPressedMidi((prev) => new Set(prev).add(midiNum))
      let amp = 0.85
      if (vel != null) {
        const boosted = Math.min(127, Math.round(vel * midiVelocitySensitivity))
        amp = boosted / 127
      }
      playUserNote(midiNum, amp)
      controllerRef.current?.userNoteOn(midiNum)
    },
    [midiVelocitySensitivity, playUserNote],
  )

  const onUserNoteOff = useCallback((midiNum: number) => {
    setUserPressedMidi((prev) => {
      const n = new Set(prev)
      n.delete(midiNum)
      return n
    })
    stopUserNote(midiNum)
  }, [stopUserNote])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return

      const blockTransport =
        !!midiLearnModeRef.current || !!keyboardTransportBlockedRef?.current
      if (blockTransport) {
        if (
          e.code === 'Space' ||
          e.code === 'ArrowLeft' ||
          e.code === 'ArrowRight' ||
          e.code === 'Home'
        ) {
          e.preventDefault()
          return
        }
      }

      /* Transport: allow OS key-repeat so arrows scrub smoothly */
      if (e.code === 'ArrowLeft') {
        e.preventDefault()
        nudgePlayhead(-1)
        return
      }
      if (e.code === 'ArrowRight') {
        e.preventDefault()
        nudgePlayhead(1)
        return
      }
      if (e.code === 'Home') {
        e.preventDefault()
        jumpToStart()
        return
      }

      if (e.repeat) return
      if (e.code === 'Space') {
        e.preventDefault()
        void togglePlay()
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [
    keyboardTransportBlockedRef,
    jumpToStart,
    nudgePlayhead,
    togglePlay,
  ])

  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
      return
    }
    let cancelled = false
    let detach: (() => void) | undefined

    const onMsg = (ev: MIDIMessageEvent) => {
      const data = ev.data
      if (!data?.length) return
      const st = data[0]
      if (st === undefined) return

      if (shouldLogMidiMessage(data)) {
        const ts = new Date().toISOString().slice(11, 23)
        const line = `${ts}  ${formatMidiMessage(data)}`
        setMidiActivityLog((prev) => [line, ...prev].slice(0, 48))
      }

      /* Light up the mapping row for any binding this message matches. Works
         whether or not a learn is in progress, so the user always sees what
         the key / knob they just touched is currently bound to. */
      const matchedFields = findMatchingBindingFields(
        bindingsRef.current,
        data,
      )
      if (matchedFields.length > 0) {
        setActiveBindingFields((prev) => {
          let changed = false
          const next = new Set(prev)
          for (const f of matchedFields) {
            if (!next.has(f)) {
              next.add(f)
              changed = true
            }
          }
          return changed ? next : prev
        })
        for (const f of matchedFields) {
          const existing = activeBindingTimersRef.current[f]
          if (existing != null) clearTimeout(existing)
          activeBindingTimersRef.current[f] = setTimeout(() => {
            delete activeBindingTimersRef.current[f]
            setActiveBindingFields((prev) => {
              if (!prev.has(f)) return prev
              const nextSet = new Set(prev)
              nextSet.delete(f)
              return nextSet
            })
          }, 900)
        }
      }

      const learnMode = midiLearnModeRef.current
      if (learnMode) {
        if (isTriggerLearnMode(learnMode) && isCcMessage(data)) {
          const ch = data[0]! & 0x0f
          const cc = data[1]!
          const val = data[2] ?? 0
          const pending = ccLearnPendingRef.current

          if (
            pending &&
            pending.mode === learnMode &&
            pending.channel === ch &&
            pending.controller === cc
          ) {
            clearTimeout(pending.timer)
            ccLearnPendingRef.current = null
            const result = buildCcTrigger(
              learnMode, ch, cc, pending.firstValue, bindingsRef.current,
            )
            bindingsRef.current = result
            setMidiHardwareBindings(result)
            setMidiLearnMode(null)
            /* Release message — don't fall through (would double-fire). */
            return
          }

          if (pending) clearTimeout(pending.timer)
          const timer = setTimeout(() => {
            if (ccLearnPendingRef.current?.timer !== timer) return
            ccLearnPendingRef.current = null
            const result = buildCcTrigger(
              learnMode, ch, cc, undefined, bindingsRef.current,
            )
            bindingsRef.current = result
            setMidiHardwareBindings(result)
            setMidiLearnMode(null)
          }, 500)
          ccLearnPendingRef.current = {
            mode: learnMode, channel: ch, controller: cc, firstValue: val, timer,
          }
          return
        }

        if (ccLearnPendingRef.current) {
          /* A CC learn is in progress — ignore non-CC traffic (active sensing,
             note on/off, timing clock, etc.) while we wait for the second CC
             or the 500 ms timeout. */
          return
        }
        const next = learnFromMessage(learnMode, data, bindingsRef.current)
        if (next) {
          bindingsRef.current = next
          setMidiHardwareBindings(next)
          setMidiLearnMode(null)
        } else {
          return
        }
      }

      const bind = bindingsRef.current

      if (bind.stop && matchesHardwareButtonTrigger(bind.stop, data)) {
        pausePlayback()
        return
      }
      if (bind.play && matchesHardwareButtonTrigger(bind.play, data)) {
        void togglePlay()
        return
      }
      if (bind.jumpToStart && matchesHardwareButtonTrigger(bind.jumpToStart, data)) {
        jumpToStart()
        return
      }
      if (bind.cycleMode && matchesHardwareButtonTrigger(bind.cycleMode, data)) {
        cycleMode()
        return
      }
      if (bind.cycleHand && matchesHardwareButtonTrigger(bind.cycleHand, data)) {
        cycleHand()
        return
      }
      if (bind.trackToggle && matchesHardwareButtonTrigger(bind.trackToggle, data)) {
        if (!midi) return
        const selectable = trackSummaries(midi)
          .filter((s) => s.noteCount > 0)
          .map((s) => s.index)
          .sort((a, b) => a - b)
        if (selectable.length === 0) return
        let focus = trackFocusRef.current
        if (focus == null || !selectable.includes(focus)) {
          focus = selectable[0]
          trackFocusRef.current = focus
          setMidiTrackFocusIndex(focus)
        }
        setSelectedTrackIndices((prev) => {
          const nextSet = new Set(prev)
          if (nextSet.has(focus)) {
            if (nextSet.size <= 1) return prev
            nextSet.delete(focus)
          } else {
            nextSet.add(focus)
          }
          return Array.from(nextSet).sort((a, b) => a - b)
        })
        return
      }
      if (bind.nextSong && matchesHardwareButtonTrigger(bind.nextSong, data)) {
        void nextPlaylistSongRef.current()
        return
      }
      if (bind.previousSong && matchesHardwareButtonTrigger(bind.previousSong, data)) {
        void prevPlaylistSongRef.current()
        return
      }
      if (
        bind.metronomeToggle &&
        matchesHardwareButtonTrigger(bind.metronomeToggle, data)
      ) {
        void toggleMetronomeRef.current()
        return
      }

      const loopTrig = bind.loopAtPlayhead
      if (loopTrig && matchesHardwareButtonTrigger(loopTrig, data)) {
        if (loopEnabledRef.current) {
          clearLoop()
        } else {
          initLoopAtCenterRef.current(songTimeRef.current)
          onLoopAtPlayheadRef.current?.()
        }
        return
      }

      if (bind.stop == null && st === 0xfc) {
        pausePlayback()
        return
      }
      if (bind.play == null && (st === 0xfa || st === 0xfb)) {
        void togglePlay()
        return
      }

      if ((st & 0xf0) === 0xb0 && data.length >= 3) {
        const v = data[2] ?? 0
        if (bind.metronomeBpmKnob && matchesCcControl(bind.metronomeBpmKnob, data)) {
          const targetBpm = Math.round(
            MIN_BPM + (v / 127) * (MAX_BPM - MIN_BPM),
          )
          const pu = knobPickedUp.current
          const PICKUP_THRESH = 3
          const currentCc = Math.round(
            ((bpmRef.current - MIN_BPM) / (MAX_BPM - MIN_BPM)) * 127,
          )
          if (!pu.metronomeBpm) {
            if (Math.abs(v - currentCc) <= PICKUP_THRESH) pu.metronomeBpm = true
            else return
          }
          setBpmRef.current(targetBpm)
          return
        }
        if (bind.chordPickerKnob && matchesCcControl(bind.chordPickerKnob, data)) {
          if (activeLessonIdRef.current != null) return
          const n = COMMON_CHORDS.length
          const pu = knobPickedUp.current
          const PICKUP_THRESH = 3
          const currentCc = Math.round(
            (selectedChordIndexRef.current / Math.max(1, n - 1)) * 127,
          )
          if (!pu.chordPicker) {
            if (Math.abs(v - currentCc) <= PICKUP_THRESH) pu.chordPicker = true
            else return
          }
          const slot = Math.min(n - 1, Math.round((v / 127) * (n - 1)))
          setSelectedChordIndexRef.current(slot)
          return
        }
        if (bind.trackFocusKnob && matchesCcControl(bind.trackFocusKnob, data)) {
          if (!midi) return
          const selectable = trackSummaries(midi)
            .filter((s) => s.noteCount > 0)
            .map((s) => s.index)
            .sort((a, b) => a - b)
          if (selectable.length === 0) return
          const n = selectable.length
          const pu = knobPickedUp.current
          const PICKUP_THRESH = 3
          if (!pu.trackFocus) {
            const focusIdx = trackFocusRef.current ?? selectable[0]
            let slot = selectable.indexOf(focusIdx)
            if (slot < 0) slot = 0
            const currentCc =
              n <= 1 ? 64 : Math.round((slot / (n - 1)) * 127)
            if (Math.abs(v - currentCc) <= PICKUP_THRESH) pu.trackFocus = true
            else return
          }
          const slot =
            n <= 1 ? 0 : Math.min(n - 1, Math.round((v / 127) * (n - 1)))
          const nextFocus = selectable[slot]
          trackFocusRef.current = nextFocus
          setMidiTrackFocusIndex(nextFocus)
          setMidiTrackDropdownBump((b) => b + 1)
          return
        }
      }

      const d = midi?.duration ?? 0
      const center = loopCenterRef.current
      if (d > 0 && center != null && (st & 0xf0) === 0xb0 && data.length >= 3) {
        const v = data[2] ?? 0
        const pu = knobPickedUp.current
        const PICKUP_THRESH = 3
        const onsets = noteOnsetsRef.current
        const ends = noteEndsRef.current

        if (bind.loopStartKnob && matchesCcControl(bind.loopStartKnob, data)) {
          const candidates = onsets.filter((t) => t <= center + 0.001)
          if (candidates.length === 0) return
          const idx = ccToTimeIndex(v, candidates)
          const currentIdx = candidates.reduce(
            (best, t, i) =>
              Math.abs(t - loopARef.current) < Math.abs(candidates[best]! - loopARef.current) ? i : best,
            0,
          )
          const currentCc = candidates.length <= 1 ? 64 : Math.round((currentIdx / (candidates.length - 1)) * 127)
          if (!pu.loopStart) {
            if (Math.abs(v - currentCc) <= PICKUP_THRESH) pu.loopStart = true
            else return
          }
          const newA = candidates[idx]!
          if (newA < loopBRef.current - 0.04) setLoopA(newA)
          return
        }
        if (bind.loopEndKnob && matchesCcControl(bind.loopEndKnob, data)) {
          const candidates = ends.filter((t) => t >= center - 0.001)
          if (candidates.length === 0) return
          const idx = ccToTimeIndex(v, candidates)
          const currentIdx = candidates.reduce(
            (best, t, i) =>
              Math.abs(t - loopBRef.current) < Math.abs(candidates[best]! - loopBRef.current) ? i : best,
            0,
          )
          const currentCc = candidates.length <= 1 ? 64 : Math.round((currentIdx / (candidates.length - 1)) * 127)
          if (!pu.loopEnd) {
            if (Math.abs(v - currentCc) <= PICKUP_THRESH) pu.loopEnd = true
            else return
          }
          const newB = candidates[idx]!
          if (newB > loopARef.current + 0.04) setLoopB(Math.min(d, newB))
          return
        }
        if (bind.loopShiftKnob && matchesCcControl(bind.loopShiftKnob, data)) {
          if (onsets.length === 0) return
          const region = loopBRef.current - loopARef.current
          if (region < 0.05) return
          const idx = ccToTimeIndex(v, onsets)
          const currentIdx = onsets.reduce(
            (best, t, i) =>
              Math.abs(t - loopARef.current) < Math.abs(onsets[best]! - loopARef.current) ? i : best,
            0,
          )
          const currentCc = onsets.length <= 1 ? 64 : Math.round((currentIdx / (onsets.length - 1)) * 127)
          if (!pu.loopShift) {
            if (Math.abs(v - currentCc) <= PICKUP_THRESH) pu.loopShift = true
            else return
          }
          const newA = onsets[idx]!
          const newB = Math.min(d, newA + region)
          setLoopA(newA)
          setLoopB(newB)
          setLoopCenter(newA + (newB - newA) / 2)
          seek(newA)
          return
        }
      }

      if (data.length < 2) return
      const note = data[1]
      const vel = data[2]
      const ch = st & 0xf0
      if (ch === 0x90) {
        if (vel !== undefined && vel > 0) onUserNoteOn(note, vel)
        else onUserNoteOff(note)
      } else if (ch === 0x80) {
        onUserNoteOff(note)
      }
    }

    const sync = (access: MIDIAccess) => {
      setMidiConnected([...access.inputs.values()][0]?.name ?? null)
    }

    void navigator
      .requestMIDIAccess({ sysex: false })
      .then((access) => {
        if (cancelled) {
          for (const inp of access.inputs.values()) {
            inp.removeEventListener('midimessage', onMsg)
          }
          return
        }
        for (const inp of access.inputs.values()) {
          inp.addEventListener('midimessage', onMsg)
        }
        const onState = () => sync(access)
        access.addEventListener('statechange', onState)
        sync(access)
        detach = () => {
          for (const inp of access.inputs.values()) {
            inp.removeEventListener('midimessage', onMsg)
          }
          access.removeEventListener('statechange', onState)
        }
      })
      .catch(() => setMidiConnected(null))

    return () => {
      cancelled = true
      detach?.()
    }
  }, [
    clearLoop,
    cycleHand,
    cycleMode,
    jumpToStart,
    midi,
    onUserNoteOn,
    onUserNoteOff,
    pausePlayback,
    setLoopA,
    setLoopB,
    setLoopEnabled,
    setSelectedTrackIndices,
    togglePlay,
  ])

  useEffect(() => {
    const ctl = controllerRef.current
    if (!ctl || !midi) return
    if (loopEnabled && loopB > loopA + 0.05) {
      ctl.loop = { a: loopA, b: loopB }
    } else {
      ctl.loop = null
    }
  }, [loopEnabled, loopA, loopB, midi])

  return {
    ensureAudio,
    audioReady,
    sfLoadDone,
    sfLoadTotal,
    midi,
    fileName,
    tracks,
    selectedTrackIndices,
    setSelectedTrackIndices,
    midiTrackFocusIndex,
    midiTrackDropdownBump,
    mode,
    setMode,
    playing,
    togglePlay,
    pausePlayback,
    songTime,
    seek,
    splitMidi,
    setSplitMidi,
    midiVelocitySensitivity,
    setMidiVelocitySensitivity,
    addMidiFiles,
    playlist,
    currentPlaylistId,
    playlistHydrated,
    selectPlaylistSong,
    removePlaylistSong,
    handFilter,
    setHandFilter,
    fingeringMap,
    userPressedMidi,
    waitExpectedMidi,
    controllerRef,
    midiConnected,
    playbackNotes,
    loopEnabled,
    setLoopEnabled,
    loopA,
    setLoopA,
    loopB,
    setLoopB,
    loopCenter,
    initLoopAtCenter,
    noteOnsets,
    noteEnds,
    nudgePlayhead,
    jumpToStart,
    nextPlaylistSong,
    previousPlaylistSong,
    clearLoop,
    midiHardwareBindings,
    setMidiHardwareBindings,
    midiLearnMode,
    setMidiLearnMode,
    midiActivityLog,
    clearMidiActivityLog,
    resetMidiHardwareBindings,
    activeBindingFields,
    /* Chord Learning */
    bpm,
    setBpm,
    fileBpm,
    metronomeRunning,
    toggleMetronome,
    startMetronome,
    stopMetronome,
    selectedChordIndex,
    setSelectedChordIndex,
    selectedChord,
    heldChord,
    chordExpectedMidi,
    activeLessonId,
    exerciseSnapshot,
    startLesson,
    exitLesson,
    restartLesson,
    lessonProgress,
    previewNextChord,
    setPreviewNextChord,
  }
}
