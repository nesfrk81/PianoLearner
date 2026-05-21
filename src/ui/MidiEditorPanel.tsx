import { Midi } from '@tonejs/midi'
import type { Note } from '@tonejs/midi/dist/Note'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react'
import { trackSummaries } from '../midi/midiModel'
import {
  drawGrid,
  drawKeys,
  drawPlayhead,
  drawRuler,
  scrollToIncludeTime,
  type ScrollFollowMode,
} from './midiEditorDraw'
import {
  cellKey,
  clientToContent,
  computeLayout,
  isGridContentPointer,
  KEY_W,
  noteHitBounds,
  pitchRangeForTracks,
  PLAYHEAD_NUDGE_SEC,
  preserveScrollTime,
  rowTop,
  RULER_H,
  STROKE_MOVE_PX,
  scrollLeftForTime,
  timelineLeftSec,
  timeToX,
  type EditorLayout,
} from './midiEditorLayout'
import {
  defaultNoteDurationSec,
  extraEditSec,
  MIN_DURATION_SEC,
  snapDurationFromStart,
  snapSeconds,
} from './midiEditorSnap'
import {
  readMidiEditorColors,
  setupCanvas,
  type CanvasSizeCache,
  type MidiEditorColors,
} from './midiEditorTheme'
import { TrackMultiselectDropdown } from './TrackMultiselectDropdown'

const UNDO_CAP = 80

function editorPropsEqual(
  a: MidiEditorPanelProps,
  b: MidiEditorPanelProps,
): boolean {
  if (a.playing && b.playing && a.songTime !== b.songTime) {
    return (
      a.midi === b.midi &&
      a.fileName === b.fileName &&
      a.playing === b.playing &&
      a.initialSelectedTrackIndices === b.initialSelectedTrackIndices &&
      a.onClose === b.onClose &&
      a.applyMidiEdit === b.applyMidiEdit &&
      a.commitMidiToIndexedDb === b.commitMidiToIndexedDb &&
      a.onSelectedTrackIndicesChange === b.onSelectedTrackIndicesChange &&
      a.onTogglePlay === b.onTogglePlay &&
      a.getLiveSongTime === b.getLiveSongTime &&
      a.transportFrameRef === b.transportFrameRef &&
      a.onSeek === b.onSeek
    )
  }
  return (
    a.midi === b.midi &&
    a.fileName === b.fileName &&
    a.playing === b.playing &&
    a.songTime === b.songTime &&
    a.initialSelectedTrackIndices === b.initialSelectedTrackIndices &&
    a.onClose === b.onClose &&
    a.applyMidiEdit === b.applyMidiEdit &&
    a.commitMidiToIndexedDb === b.commitMidiToIndexedDb &&
    a.onSelectedTrackIndicesChange === b.onSelectedTrackIndicesChange &&
    a.onTogglePlay === b.onTogglePlay &&
    a.getLiveSongTime === b.getLiveSongTime &&
    a.transportFrameRef === b.transportFrameRef &&
    a.onSeek === b.onSeek
  )
}

type HitKind = 'move' | 'resizeL' | 'resizeR'

type DragEntry = {
  note: Note
  origTime: number
  origMidi: number
  origDuration: number
  fixEnd?: number
}

type DragState = {
  kind: HitKind
  notes: DragEntry[]
  startClientX: number
  startClientY: number
}

type PaintedNoteRef = { trackIndex: number; note: Note }

type PaintStrokeState = {
  mode: 'paint'
  startClientX: number
  startClientY: number
  startTimeSec: number
  startMidi: number
  notes: PaintedNoteRef[]
  dragged: boolean
}

type EraseStrokeState = {
  mode: 'erase'
  lastCellKey: string | null
  startClientX: number
  startClientY: number
  active: boolean
}

type StrokeState = PaintStrokeState | EraseStrokeState

function maxNoteEnd(midi: Midi): number {
  let max = 0
  for (const tr of midi.tracks) {
    for (const n of tr.notes) {
      max = Math.max(max, n.time + n.duration)
    }
  }
  return max
}

function findNoteIndex(notes: readonly Note[], target: Note): number {
  return notes.findIndex(
    (n) =>
      n.ticks === target.ticks &&
      n.durationTicks === target.durationTicks &&
      n.midi === target.midi,
  )
}

function isFormControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

function sameTrackIndexList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export type MidiEditorPanelProps = {
  midi: Midi
  initialSelectedTrackIndices: number[]
  fileName: string
  onClose: () => void
  applyMidiEdit: (next: Midi) => void
  commitMidiToIndexedDb: () => void | Promise<void>
  onSelectedTrackIndicesChange?: (indices: number[]) => void
  playing: boolean
  onTogglePlay: () => void
  songTime: number
  getLiveSongTime: () => number
  /** Filled by the editor; invoked from the transport rAF after `tick()`. */
  transportFrameRef: MutableRefObject<((timeSec: number) => void) | null>
  onSeek: (timeSec: number) => void
}

function MidiEditorPanelInner({
  midi: midiProp,
  initialSelectedTrackIndices,
  fileName,
  onClose,
  applyMidiEdit,
  commitMidiToIndexedDb,
  onSelectedTrackIndicesChange,
  playing,
  onTogglePlay,
  songTime,
  getLiveSongTime,
  transportFrameRef,
  onSeek,
}: MidiEditorPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const gridViewportRef = useRef<HTMLDivElement>(null)
  const rulerViewportRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const keysRef = useRef<HTMLCanvasElement>(null)
  const rulerRef = useRef<HTMLCanvasElement>(null)
  const gridRef = useRef<HTMLCanvasElement>(null)
  const playheadGridRef = useRef<HTMLCanvasElement>(null)
  const playheadRulerRef = useRef<HTMLCanvasElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)

  const layoutRef = useRef<EditorLayout | null>(null)
  const ppsRef = useRef(0)
  const timelineLeftRef = useRef(0)
  const lastPaintScrollRef = useRef({ left: -1, top: -1 })
  const colorsRef = useRef<MidiEditorColors>(readMidiEditorColors())
  const keysCache = useRef<CanvasSizeCache>({ cssW: 0, cssH: 0, dpr: 0 })
  const rulerCache = useRef<CanvasSizeCache>({ cssW: 0, cssH: 0, dpr: 0 })
  const gridCache = useRef<CanvasSizeCache>({ cssW: 0, cssH: 0, dpr: 0 })
  const playheadGridCache = useRef<CanvasSizeCache>({ cssW: 0, cssH: 0, dpr: 0 })
  const playheadRulerCache = useRef<CanvasSizeCache>({ cssW: 0, cssH: 0, dpr: 0 })

  const localMidiRef = useRef<Midi>(midiProp.clone())
  const selectedRef = useRef<number[]>([...initialSelectedTrackIndices])
  const undoRef = useRef<Uint8Array[]>([])
  const lastSentRef = useRef<Midi | null>(null)
  const scrollToNotesRef = useRef(true)
  const dragRef = useRef<DragState | null>(null)
  const strokeRef = useRef<StrokeState | null>(null)
  const strokeUndoRef = useRef(false)
  const followPlayheadRef = useRef(true)
  const savingRef = useRef(false)
  const userScrollingRef = useRef(false)
  const userScrollTimerRef = useRef(0)
  const programmaticScrollRef = useRef(false)

  const [localMidi, setLocalMidi] = useState(() => midiProp.clone())
  const [selectedTrackIndices, setSelectedTrackIndices] = useState<number[]>(
    () => [...initialSelectedTrackIndices],
  )

  const editorTracks = useMemo(() => trackSummaries(localMidi), [localMidi])
  const spanSec = Math.max(localMidi.duration, maxNoteEnd(localMidi), 1)
  const extraSec = extraEditSec(localMidi)
  const pitch = useMemo(
    () => pitchRangeForTracks(localMidi, selectedTrackIndices),
    [localMidi, selectedTrackIndices],
  )
  const timelineLeft = useMemo(
    () => timelineLeftSec(localMidi),
    [localMidi],
  )

  const clampSongTime = useCallback(
    (t: number, start = timelineLeft) =>
      Math.max(start, Math.min(spanSec, t)),
    [spanSec, timelineLeft],
  )

  useEffect(() => {
    if (midiProp === lastSentRef.current) return
    const next = midiProp.clone()
    localMidiRef.current = next
    setLocalMidi(next)
    undoRef.current = []
    scrollToNotesRef.current = true
  }, [midiProp])

  useEffect(() => {
    localMidiRef.current = localMidi
  }, [localMidi])

  useEffect(() => {
    setSelectedTrackIndices((prev) =>
      sameTrackIndexList(prev, initialSelectedTrackIndices)
        ? prev
        : [...initialSelectedTrackIndices],
    )
  }, [initialSelectedTrackIndices])

  useEffect(() => {
    selectedRef.current = selectedTrackIndices
    scrollToNotesRef.current = true
  }, [selectedTrackIndices])

  const setEditorSelectedTrackIndices = useCallback(
    (next: number[] | ((prev: number[]) => number[])) => {
      setSelectedTrackIndices((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        if (sameTrackIndexList(prev, resolved)) return prev
        onSelectedTrackIndicesChange?.(resolved)
        return resolved
      })
    },
    [onSelectedTrackIndicesChange],
  )

  useEffect(() => {
    colorsRef.current = readMidiEditorColors()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const refresh = () => {
      colorsRef.current = readMidiEditorColors()
    }
    mq.addEventListener('change', refresh)
    return () => mq.removeEventListener('change', refresh)
  }, [])

  const readLayout = useCallback((): EditorLayout | null => {
    const scroll = scrollRef.current
    const gridViewport = gridViewportRef.current
    if (!scroll) return null
    const viewportW = Math.max(
      1,
      gridViewport?.clientWidth ?? scroll.clientWidth,
    )
    const layout = computeLayout(
      scroll,
      pitch,
      spanSec,
      extraSec,
      viewportW,
      timelineLeft,
    )
    layout.scrollLeft = scroll.scrollLeft
    layout.scrollTop = scroll.scrollTop
    return layout
  }, [extraSec, pitch, spanSec, timelineLeft])

  const scrollToTime = useCallback(
    (
      timeSec: number,
      marginPx = 48,
      layoutIn?: EditorLayout | null,
      mode: ScrollFollowMode = 'edge',
    ): boolean => {
      const scroll = scrollRef.current
      const layout = layoutIn ?? layoutRef.current
      if (!scroll || !layout) return false
      programmaticScrollRef.current = true
      return scrollToIncludeTime(scroll, layout, timeSec, marginPx, mode)
    },
    [],
  )

  const updatePlayhead = useCallback(
    (timeSec?: number) => {
      const layout = readLayout()
      if (!layout) return
      layoutRef.current = layout
      const t = timeSec ?? clampSongTime(getLiveSongTime())
      const colors = colorsRef.current
      const gridCanvas = playheadGridRef.current
      if (gridCanvas) {
        const ctx = setupCanvas(
          gridCanvas,
          layout.viewportW,
          layout.viewportH,
          playheadGridCache.current,
        )
        if (ctx) drawPlayhead(ctx, layout, t, colors, layout.viewportH)
      }
      const rulerCanvas = playheadRulerRef.current
      if (rulerCanvas) {
        const ctx = setupCanvas(
          rulerCanvas,
          layout.viewportW,
          RULER_H,
          playheadRulerCache.current,
        )
        if (ctx) drawPlayhead(ctx, layout, t, colors, RULER_H)
      }
    },
    [clampSongTime, getLiveSongTime, readLayout, spanSec],
  )

  const paintViewport = useCallback(
    (opts?: { force?: boolean }) => {
      const scroll = scrollRef.current
      if (!scroll) return
      const sl = scroll.scrollLeft
      const st = scroll.scrollTop
      const prev = lastPaintScrollRef.current
      const hScrollChanged = prev.left !== sl
      const vScrollChanged = prev.top !== st
      if (!opts?.force && !hScrollChanged && !vScrollChanged) {
        return
      }
      lastPaintScrollRef.current = { left: sl, top: st }

      const layout = computeLayout(
        scroll,
        pitch,
        spanSec,
        extraSec,
        undefined,
        timelineLeft,
      )
      layout.scrollLeft = sl
      layout.scrollTop = st
      layoutRef.current = layout

      const colors = colorsRef.current
      const midi = localMidiRef.current
      const tracks = selectedRef.current
      const paintTimeline = opts?.force || hScrollChanged

      if (paintTimeline) {
        const rulerCanvas = rulerRef.current
        if (rulerCanvas) {
          const ctx = setupCanvas(rulerCanvas, layout.viewportW, RULER_H, rulerCache.current)
          if (ctx) drawRuler(ctx, layout, colors)
        }

        const gridCanvas = gridRef.current
        if (gridCanvas) {
          const ctx = setupCanvas(
            gridCanvas,
            layout.viewportW,
            layout.viewportH,
            gridCache.current,
          )
          if (ctx) drawGrid(ctx, layout, colors, midi, tracks)
        }
      }

      if (opts?.force || vScrollChanged) {
        const keysCanvas = keysRef.current
        if (keysCanvas) {
          const ctx = setupCanvas(
            keysCanvas,
            KEY_W,
            layout.viewportH,
            keysCache.current,
          )
          if (ctx) drawKeys(ctx, layout, colors)
        }
      }
    },
    [extraSec, pitch, spanSec, timelineLeft],
  )

  const followPlayhead = useCallback(
    (timeSec: number, mode: ScrollFollowMode = 'jump'): boolean => {
      if (!followPlayheadRef.current || userScrollingRef.current) return false
      const scroll = scrollRef.current
      const layout = layoutRef.current
      if (!scroll || !layout) return false
      return scrollToTime(timeSec, 64, layout, mode)
    },
    [scrollToTime],
  )

  const syncPlayhead = useCallback(
    (opts?: { follow?: boolean; timeSec?: number; followMode?: ScrollFollowMode }) => {
      const t =
        opts?.timeSec ??
        clampSongTime(getLiveSongTime())
      if (opts?.follow) followPlayhead(t, opts.followMode ?? 'jump')
      updatePlayhead(t)
    },
    [clampSongTime, followPlayhead, getLiveSongTime, spanSec, updatePlayhead],
  )

  const syncLayoutAndPaint = useCallback(
    (opts?: { preserveTime?: boolean; scrollToNotes?: boolean }) => {
      const scroll = scrollRef.current
      const prevPps = ppsRef.current
      const layout = readLayout()
      if (!scroll || !layout) return

      if (opts?.scrollToNotes) {
        scrollToNotesRef.current = false
        programmaticScrollRef.current = true
        scroll.scrollLeft = 0
        layout.scrollLeft = 0
        layout.scrollTop = scroll.scrollTop
      } else if (opts?.preserveTime && prevPps > 0 && prevPps !== layout.pps) {
        programmaticScrollRef.current = true
        preserveScrollTime(scroll, prevPps, timelineLeftRef.current, layout)
        layout.scrollLeft = scroll.scrollLeft
      }

      layoutRef.current = layout
      ppsRef.current = layout.pps
      timelineLeftRef.current = layout.timelineLeft
      const spacer = spacerRef.current
      if (spacer) {
        spacer.style.width = `${layout.contentW}px`
        spacer.style.height = `${layout.contentH}px`
      }
      lastPaintScrollRef.current = { left: -1, top: -1 }
      paintViewport({ force: true })
      syncPlayhead()
    },
    [clampSongTime, getLiveSongTime, paintViewport, readLayout, scrollToTime, syncPlayhead],
  )

  useLayoutEffect(() => {
    syncLayoutAndPaint({
      preserveTime: true,
      scrollToNotes: scrollToNotesRef.current,
    })
  }, [localMidi, selectedTrackIndices, pitch, spanSec, extraSec, timelineLeft, syncLayoutAndPaint])

  useEffect(() => {
    const scroll = scrollRef.current
    const pane = paneRef.current
    const gridViewport = gridViewportRef.current
    if (!scroll || !pane) return
    const ro = new ResizeObserver(() => {
      syncLayoutAndPaint({ preserveTime: true })
    })
    ro.observe(scroll)
    ro.observe(pane)
    if (gridViewport) ro.observe(gridViewport)
    return () => ro.disconnect()
  }, [syncLayoutAndPaint])

  useEffect(() => {
    if (playing) return
    const t = clampSongTime(songTime)
    syncPlayhead({ follow: true, timeSec: t, followMode: 'edge' })
  }, [clampSongTime, songTime, playing, spanSec, syncPlayhead])

  useEffect(() => {
    if (!playing) {
      transportFrameRef.current = null
      return
    }
    transportFrameRef.current = (t: number) => {
      const nextTime = clampSongTime(t)
      if (followPlayhead(nextTime, 'follow')) {
        paintViewport()
      }
      updatePlayhead(nextTime)
    }
    return () => {
      transportFrameRef.current = null
    }
  }, [
    clampSongTime,
    followPlayhead,
    paintViewport,
    playing,
    spanSec,
    transportFrameRef,
    updatePlayhead,
  ])

  useEffect(() => {
    bodyRef.current?.focus()
  }, [])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY > 0 ? -PLAYHEAD_NUDGE_SEC : PLAYHEAD_NUDGE_SEC
      onSeek(clampSongTime(getLiveSongTime() + delta))
    }
    scroll.addEventListener('wheel', onWheel, { passive: false })
    return () => scroll.removeEventListener('wheel', onWheel)
  }, [clampSongTime, getLiveSongTime, onSeek])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const onNativeScroll = () => {
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false
      } else {
        userScrollingRef.current = true
        if (userScrollTimerRef.current) {
          window.clearTimeout(userScrollTimerRef.current)
        }
        userScrollTimerRef.current = window.setTimeout(() => {
          userScrollingRef.current = false
        }, 800)
      }

      paintViewport()
      const liveTime = getLiveSongTime()
      updatePlayhead(liveTime)
    }
    scroll.addEventListener('scroll', onNativeScroll, { passive: true })
    return () => {
      scroll.removeEventListener('scroll', onNativeScroll)
      if (userScrollTimerRef.current) window.clearTimeout(userScrollTimerRef.current)
    }
  }, [getLiveSongTime, paintViewport, updatePlayhead])

  const pushUndo = useCallback(() => {
    const snap = localMidiRef.current.toArray()
    const stack = undoRef.current
    stack.push(snap)
    if (stack.length > UNDO_CAP) stack.shift()
  }, [])

  const performUndo = useCallback(() => {
    const stack = undoRef.current
    if (stack.length === 0) return
    const buf = stack.pop()!
    const next = new Midi(buf)
    localMidiRef.current = next
    setLocalMidi(next)
    applyMidiEdit(next)
    syncLayoutAndPaint()
  }, [applyMidiEdit, syncLayoutAndPaint])

  const flushParent = useCallback(
    (notifyParent: boolean) => {
      const m = localMidiRef.current
      if (notifyParent) {
        lastSentRef.current = m
        applyMidiEdit(m)
      }
      syncLayoutAndPaint()
    },
    [applyMidiEdit, syncLayoutAndPaint],
  )

  const findTrackNoteAt = useCallback(
    (
      track: { notes: Note[] },
      midiNote: number,
      timeSec: number,
    ): Note | undefined =>
      track.notes.find(
        (n) => n.midi === midiNote && Math.abs(n.time - timeSec) < 1e-4,
      ),
    [],
  )

  const snapAt = useCallback(
    (sec: number, midi: Midi) => snapSeconds(sec, midi, timelineLeft),
    [timelineLeft],
  )

  const placePaintNotes = useCallback(
    (
      midiNote: number,
      startSec: number,
      durationSec: number,
    ): PaintedNoteRef[] => {
      const midi = localMidiRef.current
      const t = snapAt(startSec, midi)
      const dur = snapDurationFromStart(t, durationSec, midi)
      const created: PaintedNoteRef[] = []
      for (const ti of selectedRef.current) {
        const tr = midi.tracks[ti]
        if (!tr) continue
        tr.notes = tr.notes.filter(
          (n) =>
            !(
              n.midi === midiNote &&
              n.time + n.duration > t + 1e-4 &&
              n.time < t + dur - 1e-4
            ),
        )
        tr.addNote({
          midi: midiNote,
          time: t,
          duration: dur,
          velocity: 0.85,
        })
        const added = findTrackNoteAt(tr, midiNote, t)
        if (added) created.push({ trackIndex: ti, note: added })
      }
      return created
    },
    [findTrackNoteAt, snapAt],
  )

  const setPaintNotesDuration = useCallback(
    (refs: PaintedNoteRef[], startSec: number, endSec: number) => {
      const midi = localMidiRef.current
      const t0 = snapAt(startSec, midi)
      const end = Math.max(t0 + MIN_DURATION_SEC, snapAt(endSec, midi))
      const dur = snapDurationFromStart(t0, end - t0, midi)
      for (const { note } of refs) {
        note.time = t0
        note.duration = dur
      }
    },
    [snapAt],
  )

  const revertPaintStroke = useCallback(
    (st: PaintStrokeState) => {
      const midi = localMidiRef.current
      for (const { trackIndex, note } of st.notes) {
        const tr = midi.tracks[trackIndex]
        if (!tr) continue
        const idx = findNoteIndex(tr.notes, note)
        if (idx >= 0) tr.notes.splice(idx, 1)
      }
      if (strokeUndoRef.current && undoRef.current.length > 0) {
        undoRef.current.pop()
        strokeUndoRef.current = false
      }
      lastPaintScrollRef.current = { left: -1, top: -1 }
      paintViewport({ force: true })
    },
    [paintViewport],
  )

  const eraseCell = useCallback((midiNote: number, timeSec: number) => {
    const midi = localMidiRef.current
    const t = snapAt(timeSec, midi)
    for (const ti of selectedRef.current) {
      const tr = midi.tracks[ti]
      if (!tr) continue
      tr.notes = tr.notes.filter(
        (n) => !(n.midi === midiNote && Math.abs(n.time - t) < 1e-4),
      )
    }
  }, [snapAt])

  const removeNotes = useCallback((notes: Note[]) => {
    const midi = localMidiRef.current
    for (const note of notes) {
      for (const ti of selectedRef.current) {
        const tr = midi.tracks[ti]
        if (!tr) continue
        const idx = findNoteIndex(tr.notes, note)
        if (idx >= 0) tr.notes.splice(idx, 1)
      }
    }
  }, [])

  const hitTest = useCallback(
    (cx: number, cy: number): { notes: Note[]; kind: HitKind | 'add' | null } => {
      const layout = layoutRef.current
      if (!layout || cx < 0 || cy < layout.padT) {
        return { notes: [], kind: null }
      }
      const stack: Note[] = []
      let kind: HitKind | null = null
      for (const ti of selectedRef.current) {
        const tr = localMidiRef.current.tracks[ti]
        if (!tr) continue
        for (let i = tr.notes.length - 1; i >= 0; i--) {
          const n = tr.notes[i]!
          const top = rowTop(n.midi, layout.padT, layout.rowH, layout.maxMidi)
          if (cy < top || cy > top + layout.rowH) continue
          const x0 = timeToX(n.time - layout.timelineLeft, layout.pps, layout.padL)
          const x1 = timeToX(
            n.time + n.duration - layout.timelineLeft,
            layout.pps,
            layout.padL,
          )
          const { hitX0, hitX1, resizeHalf } = noteHitBounds(x0, x1)
          if (cx < hitX0 || cx > hitX1) continue
          if (kind === null) {
            if (cx <= hitX0 + resizeHalf) kind = 'resizeL'
            else if (cx >= hitX1 - resizeHalf) kind = 'resizeR'
            else kind = 'move'
          }
          stack.push(n)
        }
      }
      if (stack.length === 0) return { notes: [], kind: 'add' }
      return { notes: stack, kind }
    },
    [],
  )

  const endStroke = useCallback(
    (commit: boolean) => {
      strokeRef.current = null
      if (commit) flushParent(true)
      else flushParent(false)
    },
    [flushParent],
  )

  const onGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const scroll = scrollRef.current
    const layout = layoutRef.current
    if (!scroll || !layout) return
    layoutRef.current = readLayout()
    const L = layoutRef.current!
    if (!isGridContentPointer(L, scroll, e.clientX, e.clientY)) return
    const { cx, cy } = clientToContent(L, scroll, e.clientX, e.clientY)

    if (e.button === 2) {
      e.preventDefault()
      const { notes, kind } = hitTest(cx, cy)
      if (kind === 'add') {
        strokeRef.current = {
          mode: 'erase',
          lastCellKey: null,
          startClientX: e.clientX,
          startClientY: e.clientY,
          active: false,
        }
        strokeUndoRef.current = false
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
      if (notes.length > 0) {
        pushUndo()
        removeNotes(notes)
        flushParent(true)
      }
      return
    }

    if (e.button !== 0) return

    const { timeSec, midi: startMidi } = clientToContent(L, scroll, e.clientX, e.clientY)
    const { notes, kind } = hitTest(cx, cy)
    if (kind === 'add') {
      const midi = localMidiRef.current
      const startTimeSec = snapAt(timeSec, midi)
      const defaultDur = defaultNoteDurationSec(midi)
      pushUndo()
      strokeUndoRef.current = true
      const placed = placePaintNotes(startMidi, startTimeSec, defaultDur)
      if (placed.length === 0) return
      lastPaintScrollRef.current = { left: -1, top: -1 }
      paintViewport({ force: true })
      strokeRef.current = {
        mode: 'paint',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startTimeSec,
        startMidi,
        notes: placed,
        dragged: false,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (kind === null || notes.length === 0) return

    pushUndo()
    strokeUndoRef.current = false
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      kind,
      notes: notes.map((note) => ({
        note,
        origTime: note.time,
        origMidi: note.midi,
        origDuration: note.duration,
        ...(kind === 'resizeL' ? { fixEnd: note.time + note.duration } : {}),
      })),
      startClientX: e.clientX,
      startClientY: e.clientY,
    }
  }

  const onGridPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const scroll = scrollRef.current
    if (!scroll) return
    const layout = readLayout()
    if (!layout) return
    layoutRef.current = layout

    const st = strokeRef.current
    if (!st && !isGridContentPointer(layout, scroll, e.clientX, e.clientY)) return
    if (st) {
      if (st.mode === 'paint') {
        const { timeSec } = clientToContent(
          layout,
          scroll,
          e.clientX,
          e.clientY,
        )
        const midi = localMidiRef.current
        const dist = Math.hypot(
          e.clientX - st.startClientX,
          e.clientY - st.startClientY,
        )
        if (dist >= STROKE_MOVE_PX) st.dragged = true
        const endSec = Math.max(
          st.startTimeSec,
          clampSongTime(snapAt(timeSec, midi)),
        )
        if (st.notes.length > 0) {
          setPaintNotesDuration(st.notes, st.startTimeSec, endSec)
        }
        lastPaintScrollRef.current = { left: -1, top: -1 }
        paintViewport({ force: true })
        return
      }

      const { timeSec, midi: md } = clientToContent(
        layout,
        scroll,
        e.clientX,
        e.clientY,
      )
      const dist = Math.hypot(
        e.clientX - st.startClientX,
        e.clientY - st.startClientY,
      )
      if (!st.active && dist >= STROKE_MOVE_PX) {
        st.active = true
        if (!strokeUndoRef.current) {
          pushUndo()
          strokeUndoRef.current = true
        }
      }
      if (st.active) {
        const key = cellKey(md, snapAt(timeSec, localMidiRef.current))
        if (key !== st.lastCellKey) {
          st.lastCellKey = key
          eraseCell(md, timeSec)
          lastPaintScrollRef.current = { left: -1, top: -1 }
          paintViewport({ force: true })
        }
      }
      return
    }

    const d = dragRef.current
    if (!d) return
    const midiSnap = localMidiRef.current
    const dx = e.clientX - d.startClientX
    const dt = dx / layout.pps
    const dmidi = Math.round((d.startClientY - e.clientY) / layout.rowH)

    for (const entry of d.notes) {
      const note = entry.note
      if (d.kind === 'move') {
        let nt = entry.origTime + dt
        let nm = entry.origMidi + dmidi
        nm = Math.max(layout.minMidi, Math.min(layout.maxMidi, nm))
        const maxStart = Math.max(layout.timelineLeft, spanSec - note.duration)
        nt = Math.max(layout.timelineLeft, Math.min(maxStart, nt))
        note.time = snapAt(nt, midiSnap)
        note.midi = nm
      } else if (d.kind === 'resizeR') {
        const spanLimit = Math.max(spanSec, entry.origTime + entry.origDuration + 16)
        let end = entry.origTime + entry.origDuration + dt
        end = Math.max(note.time + MIN_DURATION_SEC, end)
        end = Math.min(spanLimit, end)
        end = snapAt(end, midiSnap)
        note.duration = Math.max(MIN_DURATION_SEC, end - note.time)
      } else if (d.kind === 'resizeL') {
        const fixEnd = entry.fixEnd ?? entry.origTime + entry.origDuration
        const snappedEnd = snapAt(fixEnd, midiSnap)
        let start = entry.origTime + dt
        start = Math.max(
          layout.timelineLeft,
          Math.min(snappedEnd - MIN_DURATION_SEC, start),
        )
        start = snapAt(start, midiSnap)
        note.duration = Math.max(MIN_DURATION_SEC, snappedEnd - start)
        note.time = start
      }
    }
    lastPaintScrollRef.current = { left: -1, top: -1 }
    paintViewport({ force: true })
  }

  const onGridPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = strokeRef.current
    if (st?.mode === 'paint') {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      revertPaintStroke(st)
      strokeRef.current = null
      return
    }
    onGridPointerUp(e)
  }

  const onGridPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = strokeRef.current
    if (st?.mode === 'paint') {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      if (st.notes.length > 0 && !st.dragged) {
        const defaultDur = defaultNoteDurationSec(localMidiRef.current)
        setPaintNotesDuration(
          st.notes,
          st.startTimeSec,
          st.startTimeSec + defaultDur,
        )
        lastPaintScrollRef.current = { left: -1, top: -1 }
        paintViewport({ force: true })
      }
      endStroke(true)
      return
    }
    if (st) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      endStroke(true)
      return
    }
    if (!dragRef.current) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    dragRef.current = null
    flushParent(true)
  }

  const onRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const scroll = scrollRef.current
    const rulerViewport = rulerViewportRef.current
    if (!scroll || !rulerViewport) return
    const layout = readLayout()
    if (!layout) return
    const rect = rulerViewport.getBoundingClientRect()
    const cx = e.clientX - rect.left + scroll.scrollLeft
    const t = clampSongTime(
      (cx - layout.padL) / layout.pps + layout.timelineLeft,
    )
    onSeek(t)
    layoutRef.current = layout
    syncPlayhead({ follow: true, timeSec: t })
  }

  const onSave = async () => {
    if (savingRef.current) return
    savingRef.current = true
    try {
      await commitMidiToIndexedDb()
    } finally {
      savingRef.current = false
    }
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (isFormControl(ev.target)) return
      if (ev.code === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
        onClose()
        return
      }
      if (ev.code === 'Space') {
        ev.preventDefault()
        ev.stopPropagation()
        onTogglePlay()
        return
      }
      if (ev.code === 'ArrowLeft') {
        ev.preventDefault()
        ev.stopPropagation()
        onSeek(clampSongTime(getLiveSongTime() - PLAYHEAD_NUDGE_SEC))
        return
      }
      if (ev.code === 'ArrowRight') {
        ev.preventDefault()
        ev.stopPropagation()
        onSeek(clampSongTime(getLiveSongTime() + PLAYHEAD_NUDGE_SEC))
        return
      }
      if (ev.code === 'Home') {
        ev.preventDefault()
        ev.stopPropagation()
        const layout = readLayout()
        const start = 0
        onSeek(start)
        const scroll = scrollRef.current
        if (scroll && layout) {
          programmaticScrollRef.current = true
          scroll.scrollLeft = scrollLeftForTime(start, layout)
          paintViewport({ force: true })
        }
        syncPlayhead({ timeSec: start, follow: false })
        return
      }
      if (
        (ev.ctrlKey || ev.metaKey) &&
        ev.key.toLowerCase() === 'z' &&
        !ev.shiftKey
      ) {
        ev.preventDefault()
        ev.stopPropagation()
        performUndo()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    clampSongTime,
    getLiveSongTime,
    onClose,
    onSeek,
    onTogglePlay,
    paintViewport,
    performUndo,
    readLayout,
    spanSec,
    syncPlayhead,
    timelineLeft,
  ])

  return (
    <div className="midi-editor" aria-label="MIDI editor">
      <header className="midi-editor__head">
        <span className="midi-editor__title">
          Editing:{' '}
          <span className="midi-editor__filename" title={fileName}>
            {fileName}
          </span>
        </span>
        <div className="midi-editor__actions">
          <button
            type="button"
            className="btn"
            onClick={() => onTogglePlay()}
            title={playing ? 'Pause playback' : 'Play'}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="btn" onClick={() => void onSave()}>
            Save to library
          </button>
          <button
            type="button"
            className="btn midi-editor__close"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close editor"
          >
            ×
          </button>
        </div>
      </header>

      <div className="midi-editor__toolbar">
        <TrackMultiselectDropdown
          tracks={editorTracks}
          selectedTrackIndices={selectedTrackIndices}
          setSelectedTrackIndices={setEditorSelectedTrackIndices}
          label="Track"
          summarySuffix="selected"
        />
        <p className="midi-editor__hint">
          Space play/pause &middot; &larr;/&rarr;/wheel seek &middot; Home
          start &middot; Click ruler to seek &middot; Click or drag to paint
          (16th default; drag length) &middot; Right-drag erase &middot;
          Ctrl+Z undo &middot; Esc close
        </p>
      </div>

      <div ref={bodyRef} className="midi-editor__body" tabIndex={-1}>
        <div className="midi-editor__keys-col">
          <div
            className="midi-editor__corner"
            style={{ width: KEY_W, height: RULER_H }}
            aria-hidden
          />
          <div className="midi-editor__keys-view">
            <canvas ref={keysRef} className="midi-editor__keys-canvas" />
          </div>
        </div>

        <div ref={paneRef} className="midi-editor__pane">
          <div
            ref={rulerViewportRef}
            className="midi-editor__ruler-viewport"
            onPointerDown={onRulerPointerDown}
          >
            <canvas ref={rulerRef} className="midi-editor__ruler-canvas" />
            <canvas
              ref={playheadRulerRef}
              className="midi-editor__playhead-layer midi-editor__playhead-layer--ruler"
              aria-hidden
            />
          </div>

          <div ref={gridViewportRef} className="midi-editor__grid-viewport">
            <div
              ref={scrollRef}
              className="midi-editor__scroll"
              onPointerDown={onGridPointerDown}
              onPointerMove={onGridPointerMove}
              onPointerUp={onGridPointerUp}
              onPointerCancel={onGridPointerCancel}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div
                ref={spacerRef}
                className="midi-editor__spacer"
                style={{ width: 800, height: 400 }}
                aria-hidden
              />
            </div>
            <canvas ref={gridRef} className="midi-editor__grid-canvas" />
            <canvas
              ref={playheadGridRef}
              className="midi-editor__playhead-layer"
              aria-hidden
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export const MidiEditorPanel = memo(MidiEditorPanelInner, editorPropsEqual)
