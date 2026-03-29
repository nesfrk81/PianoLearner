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
import { loadAcousticGrandPiano } from '../audio/pianoInstrument'
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
import { allNotesFlat, notesForTrack, trackSummaries } from '../midi/midiModel'
import type { PracticeMode } from '../types'
import { midiForQwertyKey } from '../input/qwertyMap'

/** Fixed wall-clock step for ←/→ (musical beat length varies with tempo and confuses scrubbing). */
const ARROW_NUDGE_SEC = 0.5

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
  const [selectedTrackIndex, setSelectedTrackIndex] = useState(0)
  const [soloTrack, setSoloTrack] = useState(true)
  const [mode, setMode] = useState<PracticeMode>('listen')
  const [playing, setPlaying] = useState(false)
  const [songTime, setSongTime] = useState(0)
  const [splitMidi, setSplitMidi] = useState(60)
  const [octaveShift, setOctaveShift] = useState(0)
  /** Multiplier for USB MIDI note-on velocity (1 = as sent; higher = louder at same touch). */
  const [midiVelocitySensitivity, setMidiVelocitySensitivity] = useState(1.5)

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

  const ensureAudio = useCallback(async () => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext()
    }
    const ctx = ctxRef.current
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
    if (!pianoRef.current) {
      const p = await loadAcousticGrandPiano(ctx, (done, total) => {
        setSfLoadDone(done)
        setSfLoadTotal(total)
      })
      pianoRef.current = p
      if (!controllerRef.current) {
        controllerRef.current = new PlaybackController(ctx, () => pianoRef.current)
      }
    }
    setAudioReady(true)
    return ctx
  }, [])

  const tracks = useMemo(
    () => (midi ? trackSummaries(midi) : []),
    [midi],
  )

  const playbackNotes = useMemo(() => {
    if (!midi) return []
    return soloTrack
      ? notesForTrack(midi, selectedTrackIndex)
      : allNotesFlat(midi)
  }, [midi, selectedTrackIndex, soloTrack])

  const fingeringMap = useMemo(() => {
    if (!midi) return new Map<string, number>()
    const notes = notesForTrack(midi, selectedTrackIndex)
    return computeFingeringMap(
      notes.map((n) => ({ time: n.time, midi: n.midi })),
      splitMidi,
    )
  }, [midi, selectedTrackIndex, splitMidi])

  const loadMidiFile = useCallback(
    async (file: File) => {
      await ensureAudio()
      const buf = await file.arrayBuffer()
      const m = new Midi(buf)
      setFileName(file.name)
      setMidi(m)
      const summaries = trackSummaries(m)
      const firstWithNotes = summaries.find((s) => s.noteCount > 0)?.index ?? 0
      setSelectedTrackIndex(firstWithNotes)
      const ctl = controllerRef.current
      if (ctl) {
        ctl.setMidi(m)
        ctl.setSelectedTrack(firstWithNotes)
        ctl.soloTrack = soloTrack
        ctl.mode = mode
        ctl.seek(0)
        ctl.pause()
        ctl.loop = null
        setPlaying(false)
        setSongTime(0)
        const dur = m.duration
        setLoopA(0)
        setLoopB(Math.min(8, dur || 8))
      }
    },
    [ensureAudio, mode, soloTrack],
  )

  useEffect(() => {
    const ctl = controllerRef.current
    if (!ctl) return
    ctl.soloTrack = soloTrack
  }, [soloTrack])

  useEffect(() => {
    const ctl = controllerRef.current
    if (!ctl) return
    ctl.mode = mode
    if (mode !== 'wait') ctl.resetWaitState()
  }, [mode])

  useEffect(() => {
    const ctl = controllerRef.current
    if (!ctl || !midi) return
    ctl.setSelectedTrack(selectedTrackIndex)
  }, [selectedTrackIndex, midi])

  const togglePlay = useCallback(async () => {
    await ensureAudio()
    const ctl = controllerRef.current
    const ctx = ctxRef.current
    if (!ctl || !ctx || !midi) return
    if (ctl.playing) {
      ctl.pause()
      setPlaying(false)
      setSongTime(ctl.getSongTime())
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
  }, [])

  const seek = useCallback((t: number) => {
    const ctl = controllerRef.current
    if (ctl) {
      ctl.seek(t)
      setSongTime(ctl.getSongTime())
    } else {
      setSongTime(t)
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
    onLoopCleared?.()
  }, [onLoopCleared])

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
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing])

  const playUserNote = useCallback(
    (midiNum: number, velocity = 0.85) => {
      const p = pianoRef.current
      const ctx = ctxRef.current
      if (!p || !ctx) return
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

      const d = midi?.duration ?? 0
      if (d > 0 && (st & 0xf0) === 0xb0 && data.length >= 3) {
        const v = data[2] ?? 0
        const t = (v / 127) * d
        if (bind.loopStartKnob && matchesCcControl(bind.loopStartKnob, data)) {
          setLoopEnabled(true)
          const b = loopBRef.current
          setLoopA(Math.max(0, Math.min(t, b - 0.05)))
          return
        }
        if (bind.loopEndKnob && matchesCcControl(bind.loopEndKnob, data)) {
          setLoopEnabled(true)
          const a = loopARef.current
          setLoopB(Math.max(a + 0.05, Math.min(d, t)))
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
    midi,
    onUserNoteOn,
    onUserNoteOff,
    pausePlayback,
    setLoopA,
    setLoopB,
    setLoopEnabled,
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
    selectedTrackIndex,
    setSelectedTrackIndex,
    soloTrack,
    setSoloTrack,
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
    loadMidiFile,
    fingeringMap,
    userPressedMidi,
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
