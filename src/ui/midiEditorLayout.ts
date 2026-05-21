/** Layout constants for the inline MIDI editor. */
/** Left padding in px; keep 0 so t=0 aligns with the grid/ruler left edge. */
export const PAD_L = 0
export const PAD_R = 12
export const PAD_T = 0
export const PAD_B = 8
export const KEY_W = 56
export const RULER_H = 24
export const WINDOW_SEC = 10
export const PLAYHEAD_NUDGE_SEC = 0.5
export const EDGE_PX = 12
export const MIN_NOTE_WIDTH_PX = 24
export const STROKE_MOVE_PX = 4
export const MIN_ROW_H = 10

const RULER_LABEL_MIN_PX = 56
const RULER_LABEL_STEPS_SEC = [0.5, 1, 2, 5, 10, 15, 30, 60] as const
const PRE_ZERO_PAD_SEC = 0.5
const PRE_ZERO_FLOOR_SEC = -1

export type PitchRange = { minMidi: number; maxMidi: number }

export type EditorLayout = {
  viewportW: number
  viewportH: number
  scrollLeft: number
  scrollTop: number
  pps: number
  padL: number
  padT: number
  padR: number
  padB: number
  rowH: number
  minMidi: number
  maxMidi: number
  contentW: number
  contentH: number
  /** Absolute file time at the left edge of the editable timeline. */
  timelineLeft: number
}

/** Earliest note onset on selected tracks (absolute file seconds). */
export function earliestNoteTimeSec(
  midi: { tracks: { notes: { time: number }[] }[] },
  trackIndices: readonly number[],
): number {
  let min = Infinity
  for (const ti of trackIndices) {
    const tr = midi.tracks[ti]
    if (!tr) continue
    for (const n of tr.notes) {
      min = Math.min(min, n.time)
    }
  }
  return Number.isFinite(min) ? min : 0
}

/** Earliest note in the whole file (all tracks). */
export function earliestNoteTimeInMidi(midi: {
  tracks: { notes: { time: number }[] }[]
}): number {
  let min = Infinity
  for (const tr of midi.tracks) {
    for (const n of tr.notes) {
      min = Math.min(min, n.time)
    }
  }
  return Number.isFinite(min) ? min : 0
}

/** Left edge of the editor timeline in absolute file seconds. */
export function timelineLeftSec(midi: {
  tracks: { notes: { time: number }[] }[]
}): number {
  const earliest = earliestNoteTimeInMidi(midi)
  if (earliest >= 0) return 0
  return Math.min(PRE_ZERO_FLOOR_SEC, earliest - PRE_ZERO_PAD_SEC)
}

export function songTimeToDisplaySec(
  songTimeSec: number,
  timelineLeft: number,
): number {
  return songTimeSec - timelineLeft
}

export function displaySecToSongTime(
  displaySec: number,
  timelineLeft: number,
): number {
  return displaySec + timelineLeft
}

export function songTimeToDisplayX(
  songTimeSec: number,
  layout: EditorLayout,
): number {
  return (
    timeToX(songTimeSec - layout.timelineLeft, layout.pps, layout.padL) -
    layout.scrollLeft
  )
}

export function fixedPps(viewportW: number): number {
  return Math.max(1, viewportW) / WINDOW_SEC
}

export function rulerLabelStepSec(pps: number): number {
  for (const step of RULER_LABEL_STEPS_SEC) {
    if (step * pps >= RULER_LABEL_MIN_PX) return step
  }
  return 60
}

/** Format absolute file seconds for the ruler. */
export function formatRulerTimeSec(t: number): string {
  if (t < 0) return `${t.toFixed(1)}s`
  if (t >= 60) {
    const m = Math.floor(t / 60)
    const s = Math.round(t % 60)
    return s === 0 ? `${m}:00` : `${m}:${String(s).padStart(2, '0')}`
  }
  if (t < 1) return `${t.toFixed(1)}s`
  return `${Math.round(t * 10) / 10}s`
}

export function pitchRangeForTracks(
  midi: { tracks: { notes: { midi: number }[] }[] },
  trackIndices: readonly number[],
): PitchRange {
  let lo = 127
  let hi = 0
  let any = false
  for (const ti of trackIndices) {
    const tr = midi.tracks[ti]
    if (!tr) continue
    for (const n of tr.notes) {
      any = true
      lo = Math.min(lo, n.midi)
      hi = Math.max(hi, n.midi)
    }
  }
  if (!any) return { minMidi: 48, maxMidi: 72 }
  return {
    minMidi: Math.max(0, lo - 2),
    maxMidi: Math.min(127, hi + 2),
  }
}

export function timeToX(t: number, pps: number, padL: number): number {
  return padL + t * pps
}

/** Display seconds at content x (0 at timeline left when scrollLeft = 0). */
export function xToDisplayTime(x: number, padL: number, pps: number): number {
  return (x - padL) / pps
}

/** @deprecated Use {@link xToDisplayTime} + {@link displayTimeToSongTime}. */
export function xToTime(x: number, padL: number, pps: number): number {
  return xToDisplayTime(x, padL, pps)
}

export function rowTop(midiNote: number, padT: number, rowH: number, maxMidi: number): number {
  return padT + (maxMidi - midiNote) * rowH
}

export function yToMidi(
  y: number,
  padT: number,
  rowH: number,
  maxMidi: number,
  minMidi: number,
): number {
  const row = Math.floor((y - padT) / rowH)
  const m = maxMidi - row
  return Math.max(minMidi, Math.min(maxMidi, m))
}

export function computeLayout(
  scrollEl: HTMLElement,
  pitch: PitchRange,
  spanSec: number,
  extraSec: number,
  viewportWIn?: number,
  timelineLeft = 0,
): EditorLayout {
  const viewportW = Math.max(1, viewportWIn ?? scrollEl.clientWidth)
  const viewportH = Math.max(1, scrollEl.clientHeight)
  const pps = fixedPps(viewportW)
  const numRows = pitch.maxMidi - pitch.minMidi + 1
  const rowH = Math.max(MIN_ROW_H, viewportH / numRows)
  const spanEnd = spanSec + extraSec
  const contentW = PAD_L + (spanEnd - timelineLeft) * pps + PAD_R
  const contentH = PAD_T + numRows * rowH + PAD_B

  return {
    viewportW,
    viewportH,
    scrollLeft: scrollEl.scrollLeft,
    scrollTop: scrollEl.scrollTop,
    pps,
    padL: PAD_L,
    padT: PAD_T,
    padR: PAD_R,
    padB: PAD_B,
    rowH,
    minMidi: pitch.minMidi,
    maxMidi: pitch.maxMidi,
    contentW,
    contentH,
    timelineLeft,
  }
}

export function visibleTimeRange(
  layout: EditorLayout,
  padSec = 0,
): { t0: number; t1: number } {
  const t0 =
    xToDisplayTime(layout.scrollLeft, layout.padL, layout.pps) -
    padSec +
    layout.timelineLeft
  const t1 =
    xToDisplayTime(
      layout.scrollLeft + layout.viewportW,
      layout.padL,
      layout.pps,
    ) +
    padSec +
    layout.timelineLeft
  return { t0, t1 }
}

/** True when the pointer is on a native scrollbar (not grid content). */
export function isScrollChromePointer(
  scrollEl: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const rect = scrollEl.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  const hBar = scrollEl.offsetHeight - scrollEl.clientHeight
  const vBar = scrollEl.offsetWidth - scrollEl.clientWidth
  if (hBar > 0 && y >= scrollEl.clientHeight) return true
  if (vBar > 0 && x >= scrollEl.clientWidth) return true
  return false
}

export function isGridContentPointer(
  layout: EditorLayout,
  scrollEl: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  if (isScrollChromePointer(scrollEl, clientX, clientY)) return false
  const rect = scrollEl.getBoundingClientRect()
  const cy = clientY - rect.top + scrollEl.scrollTop
  const contentBottom =
    layout.padT + (layout.maxMidi - layout.minMidi + 1) * layout.rowH + layout.padB
  return cy >= layout.padT && cy < contentBottom
}

export function clientToContent(
  layout: EditorLayout,
  scrollEl: HTMLElement,
  clientX: number,
  clientY: number,
): { cx: number; cy: number; timeSec: number; midi: number } {
  const rect = scrollEl.getBoundingClientRect()
  const cx = clientX - rect.left + layout.scrollLeft
  const cy = clientY - rect.top + layout.scrollTop
  const timeSec =
    xToDisplayTime(cx, layout.padL, layout.pps) + layout.timelineLeft
  const midi = yToMidi(cy, layout.padT, layout.rowH, layout.maxMidi, layout.minMidi)
  return { cx, cy, timeSec, midi }
}

export function clientToContentX(
  layout: EditorLayout,
  scrollEl: HTMLElement,
  clientX: number,
): number {
  const rect = scrollEl.getBoundingClientRect()
  return clientX - rect.left + layout.scrollLeft
}

export function noteHitBounds(
  x0: number,
  x1: number,
): { hitX0: number; hitX1: number; resizeHalf: number } {
  const w = x1 - x0
  const center = (x0 + x1) / 2
  const minW = Math.max(w, MIN_NOTE_WIDTH_PX)
  let hitX0 = center - minW / 2
  let hitX1 = center + minW / 2
  const edgePad = Math.max(0, EDGE_PX - w / 2)
  hitX0 = Math.min(hitX0, x0 - edgePad)
  hitX1 = Math.max(hitX1, x1 + edgePad)
  const hitW = hitX1 - hitX0
  const resizeHalf = Math.min(EDGE_PX, hitW / 2)
  return { hitX0, hitX1, resizeHalf }
}

export function pitchClassLabel(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return names[midi % 12]!
}

export function midiNoteLabel(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const oct = Math.floor(midi / 12) - 1
  return `${names[midi % 12]}${oct}`
}

export function cellKey(midi: number, timeSec: number): string {
  return `${midi}:${timeSec.toFixed(5)}`
}

export function scrollLeftForTime(t: number, layout: EditorLayout, pad = 32): number {
  return Math.max(
    0,
    timeToX(t - layout.timelineLeft, layout.pps, layout.padL) - pad,
  )
}

export function preserveScrollTime(
  scrollEl: HTMLElement,
  prevPps: number,
  prevTimelineLeft: number,
  nextLayout: EditorLayout,
): void {
  if (prevPps <= 0 || nextLayout.pps <= 0) return
  const leftDisplay = xToDisplayTime(scrollEl.scrollLeft, PAD_L, prevPps)
  const leftSong = displaySecToSongTime(leftDisplay, prevTimelineLeft)
  const nextDisplay = songTimeToDisplaySec(leftSong, nextLayout.timelineLeft)
  scrollEl.scrollLeft = Math.max(
    0,
    timeToX(nextDisplay, nextLayout.pps, PAD_L),
  )
}
