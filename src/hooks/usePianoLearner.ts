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
  defaultMidiHardwareBindings,
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
import type { HandFilter, PracticeMode } from '../types'
import { midiForQwertyKey } from '../input/qwertyMap'

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
  const [octaveShift, setOctaveShift] = useState(0)
  /** Multiplier for USB MIDI note-on velocity (1 = as sent; higher = louder at same touch). */
  const [midiVelocitySensitivity, setMidiVelocitySensitivity] = useState(1.5)

  const [handFilter, setHandFilter] = useState<HandFilter>('both')

  const [loopEnabled, setLoopEnabled] = useState(false)
  const [loopA, setLoopA] = useState(0)
  const [loopB, setLoopB] = useState(8)

  const [midiConnected, setMidiConnected] = useState<string | null>(null)

  const [midiHardwareBindings, setMidiHardwareBindings] =
    useState<MidiHardwareBindings>(() => loadMidiHardwareBindings())
  const [midiLearnMode, setMidiLearnMode] = useState<MidiLearnMode | null>(null)
  const [midiActivityLog, setMidiActivityLog] = useState<string[]>([])

  const bindingsRef = useRef(midiHardwareBindings)
  const midiLearnModeRef = useRef(midiLearnMode)

  const songTimeRef = useRef(songTime)
  const loopARef = useRef(loopA)
  const loopBRef = useRef(loopB)
  const loopEnabledRef = useRef(loopEnabled)

  /** Soft-takeover: knob is ignored until it crosses the current parameter value. */
  const knobPickedUp = useRef({
    loopStart: false,
    loopEnd: false,
    loopShift: false,
    trackFocus: false,
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
  }, [
    onLoopAtPlayhead,
    midiHardwareBindings,
    midiLearnMode,
    songTime,
    loopA,
    loopB,
    loopEnabled,
  ])

  const [userPressedMidi, setUserPressedMidi] = useState<Set<number>>(
    () => new Set(),
  )
  const [waitExpectedMidi, setWaitExpectedMidi] = useState<Set<number> | null>(null)

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

  const clearLoop = useCallback(() => {
    setLoopEnabled(false)
    knobPickedUp.current = {
      loopStart: false,
      loopEnd: false,
      loopShift: false,
      trackFocus: false,
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

  const clearMidiActivityLog = useCallback(() => setMidiActivityLog([]), [])

  const resetMidiHardwareBindings = useCallback(() => {
    setMidiHardwareBindings({ ...defaultMidiHardwareBindings })
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
      const m = midiForQwertyKey(e.key, octaveShift)
      if (m != null) {
        e.preventDefault()
        onUserNoteOn(m)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const m = midiForQwertyKey(e.key, octaveShift)
      if (m != null) {
        e.preventDefault()
        onUserNoteOff(m)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [
    keyboardTransportBlockedRef,
    octaveShift,
    jumpToStart,
    nudgePlayhead,
    onUserNoteOff,
    onUserNoteOn,
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

      const learnMode = midiLearnModeRef.current
      if (learnMode) {
        const next = learnFromMessage(learnMode, data, bindingsRef.current)
        if (next) {
          bindingsRef.current = next
          setMidiHardwareBindings(next)
          setMidiLearnMode(null)
        }
        /* While learning, never run transport / notes — e.g. Start/Stop must bind, not play */
        return
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

      const loopTrig = bind.loopAtPlayhead
      if (loopTrig && matchesHardwareButtonTrigger(loopTrig, data)) {
        if (loopEnabledRef.current) {
          clearLoop()
        } else if (onLoopAtPlayheadRef.current) {
          onLoopAtPlayheadRef.current()
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
      if (d > 0 && (st & 0xf0) === 0xb0 && data.length >= 3) {
        const v = data[2] ?? 0
        const pu = knobPickedUp.current
        const PICKUP_THRESH = 3

        if (bind.loopStartKnob && matchesCcControl(bind.loopStartKnob, data)) {
          const currentCc = Math.round((loopARef.current / d) * 127)
          if (!pu.loopStart) {
            if (Math.abs(v - currentCc) <= PICKUP_THRESH) pu.loopStart = true
            else return
          }
          const t = (v / 127) * d
          setLoopEnabled(true)
          const b = loopBRef.current
          setLoopA(Math.max(0, Math.min(t, b - 0.05)))
          return
        }
        if (bind.loopEndKnob && matchesCcControl(bind.loopEndKnob, data)) {
          const currentCc = Math.round((loopBRef.current / d) * 127)
          if (!pu.loopEnd) {
            if (Math.abs(v - currentCc) <= PICKUP_THRESH) pu.loopEnd = true
            else return
          }
          const t = (v / 127) * d
          setLoopEnabled(true)
          const a = loopARef.current
          setLoopB(Math.max(a + 0.05, Math.min(d, t)))
          return
        }
        if (bind.loopShiftKnob && matchesCcControl(bind.loopShiftKnob, data)) {
          const a = loopARef.current
          const b = loopBRef.current
          const span = b - a
          if (span < 0.05) return
          const center = (a + span / 2) / d
          const currentCc = Math.round(center * 127)
          if (!pu.loopShift) {
            if (Math.abs(v - currentCc) <= PICKUP_THRESH) pu.loopShift = true
            else return
          }
          setLoopEnabled(true)
          const maxStart = d - span
          const newA = Math.max(0, Math.min(maxStart, (v / 127) * d - span / 2))
          const newB = newA + span
          setLoopA(newA)
          setLoopB(Math.min(d, newB))
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
    songTime,
    seek,
    splitMidi,
    setSplitMidi,
    octaveShift,
    setOctaveShift,
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
  }
}
