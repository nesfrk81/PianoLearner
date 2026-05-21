import type { Midi } from '@tonejs/midi'
import { isWhiteKey } from './pianoKeyLayout'
import {
  formatRulerTimeSec,
  pitchClassLabel,
  midiNoteLabel,
  rowTop,
  rulerLabelStepSec,
  scrollLeftForTime,
  songTimeToDisplayX,
  timeToX,
  visibleTimeRange,
  xToDisplayTime,
  type EditorLayout,
} from './midiEditorLayout'
import { sixteenthStepSec } from './midiEditorSnap'
import type { MidiEditorColors } from './midiEditorTheme'

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r)
  } else {
    ctx.rect(x, y, w, h)
  }
  ctx.fill()
}

export function drawRuler(
  ctx: CanvasRenderingContext2D,
  layout: EditorLayout,
  colors: MidiEditorColors,
): void {
  const { viewportW, viewportH, scrollLeft, pps, padL, timelineLeft } = layout
  const labelStep = rulerLabelStepSec(pps)
  const { t0, t1 } = visibleTimeRange(layout, labelStep)

  ctx.fillStyle = colors.rulerBg
  ctx.fillRect(0, 0, viewportW, viewportH)

  ctx.lineWidth = 1
  for (
    let t = Math.floor(t0 / labelStep) * labelStep;
    t <= t1 + 1e-6;
    t += labelStep
  ) {
    const displayT = t - timelineLeft
    const cx = timeToX(displayT, pps, padL) - scrollLeft
    if (cx + 1 < -2 || cx > viewportW + 2) continue
    const major =
      Math.abs(displayT % (labelStep * 2)) < 1e-4 || labelStep >= 5
    ctx.strokeStyle = major ? colors.gridMajor : colors.gridMinor
    ctx.beginPath()
    ctx.moveTo(cx + 0.5, major ? 0 : 8)
    ctx.lineTo(cx + 0.5, viewportH)
    ctx.stroke()
    ctx.fillStyle = colors.rulerText
    ctx.font = '10px var(--sans, system-ui, sans-serif)'
    ctx.textBaseline = 'top'
    ctx.fillText(formatRulerTimeSec(t), cx + 4, 4)
  }
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  layout: EditorLayout,
  colors: MidiEditorColors,
  midi: Midi,
  selectedTracks: readonly number[],
): void {
  const {
    viewportW,
    viewportH,
    scrollLeft,
    scrollTop,
    pps,
    padL,
    padT,
    rowH,
    minMidi,
    maxMidi,
    contentW,
    timelineLeft,
  } = layout

  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, viewportW, viewportH)

  const step = sixteenthStepSec(midi)
  const qSec = step * 4
  const { t0, t1 } = visibleTimeRange(layout, step)
  const visBot = scrollTop + viewportH

  ctx.lineWidth = 1
  for (let t = Math.floor(t0 / step) * step; t <= t1 + 1e-6; t += step) {
    const cx = timeToX(t - timelineLeft, pps, padL) - scrollLeft
    if (cx + 1 < -2 || cx > viewportW + 2) continue
    const isBeat = Math.abs(t % qSec) < 1e-4
    ctx.strokeStyle = isBeat ? colors.gridMajor : colors.gridMinor
    ctx.beginPath()
    ctx.moveTo(cx + 0.5, 0)
    ctx.lineTo(cx + 0.5, viewportH)
    ctx.stroke()
  }

  ctx.strokeStyle = colors.rowLine
  for (let m = minMidi; m <= maxMidi; m += 1) {
    const y = rowTop(m, padT, rowH, maxMidi) + rowH
    if (y < scrollTop - 2 || y > visBot + 2) continue
    const cy = y - scrollTop
    const lineL = Math.max(0, padL - scrollLeft)
    const lineR = Math.min(viewportW, contentW - layout.padR - scrollLeft)
    if (lineR <= lineL) continue
    ctx.beginPath()
    ctx.moveTo(lineL, cy)
    ctx.lineTo(lineR, cy)
    ctx.stroke()
  }

  for (const ti of selectedTracks) {
    const track = midi.tracks[ti]
    if (!track) continue
    const startIdx = noteIndexFromVisibleStart(track.notes, t0)
    for (let i = startIdx; i < track.notes.length; i += 1) {
      const n = track.notes[i]!
      if (n.time > t1 + 0.05) break
      if (n.time + n.duration < t0 - 0.05) continue
      const x0 = timeToX(n.time - timelineLeft, pps, padL)
      const x1 = timeToX(n.time + n.duration - timelineLeft, pps, padL)
      if (x1 < scrollLeft - 2 || x0 > scrollLeft + viewportW + 2) continue
      const top = rowTop(n.midi, padT, rowH, maxMidi)
      if (top + rowH < scrollTop - 2 || top > visBot + 2) continue
      const w = Math.max(1, x1 - x0)
      const h = rowH - 2
      const drawX = x0 - scrollLeft
      const drawY = top - scrollTop + 1
      if (drawX + w < -2 || drawX > viewportW + 2) continue
      const radius = Math.min(4, rowH * 0.2, w / 2)
      ctx.fillStyle = colors.noteFill
      fillRoundRect(ctx, drawX, drawY, w, h, radius)
      ctx.strokeStyle = colors.noteStroke
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath()
        ctx.roundRect(drawX, drawY, w, h, radius)
        ctx.stroke()
      } else {
        ctx.strokeRect(drawX + 0.5, drawY + 0.5, w - 1, h - 1)
      }
      const onsetW = Math.min(4, Math.max(2, w * 0.18))
      ctx.fillStyle = colors.noteStroke
      ctx.fillRect(drawX, drawY, onsetW, h)
      const label = pitchClassLabel(n.midi)
      const fontSize = Math.min(11, h * 0.55)
      ctx.fillStyle = colors.noteLabel
      ctx.font = `600 ${fontSize}px var(--sans, system-ui, sans-serif)`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      if (w >= fontSize * 1.15) {
        ctx.fillText(label, drawX + w / 2, drawY + h / 2)
      }
    }
  }
}

export function drawKeys(
  ctx: CanvasRenderingContext2D,
  layout: EditorLayout,
  colors: MidiEditorColors,
): void {
  const { viewportW, viewportH, scrollTop, padT, rowH, minMidi, maxMidi } = layout

  ctx.fillStyle = colors.bg
  ctx.fillRect(0, 0, viewportW, viewportH)

  ctx.save()
  ctx.translate(0, -scrollTop)
  for (let m = minMidi; m <= maxMidi; m += 1) {
    const top = rowTop(m, padT, rowH, maxMidi)
    if (top + rowH < scrollTop - 2) continue
    if (top > scrollTop + viewportH + 2) continue
    const white = isWhiteKey(m)
    ctx.fillStyle = white ? colors.keyWhite : colors.keyBlack
    ctx.fillRect(0, top, viewportW, rowH)
    ctx.strokeStyle = colors.keyBorder
    ctx.strokeRect(0.5, top + 0.5, viewportW - 1, rowH - 1)
    if (m % 12 === 0) {
      ctx.fillStyle = colors.keyLabel
      ctx.font = '600 10px var(--sans, system-ui, sans-serif)'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(midiNoteLabel(m), viewportW - 6, top + rowH / 2)
    }
  }
  ctx.restore()
}

/** Viewport playhead line (clears layer then draws). */
export function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  layout: EditorLayout,
  songTimeSec: number,
  colors: MidiEditorColors,
  layerH: number,
): void {
  const { viewportW } = layout
  ctx.clearRect(0, 0, viewportW, layerH)
  const x = Math.round(songTimeToDisplayX(songTimeSec, layout))
  if (x < -1 || x > viewportW + 1) return
  ctx.strokeStyle = colors.playhead
  ctx.lineWidth = 2
  ctx.shadowColor = colors.playheadGlow
  ctx.shadowBlur = 6
  ctx.beginPath()
  ctx.moveTo(x + 0.5, 0)
  ctx.lineTo(x + 0.5, layerH)
  ctx.stroke()
  ctx.shadowBlur = 0
}

export type ScrollFollowMode = 'edge' | 'jump' | 'offscreen' | 'follow'

/** While the playhead is near the timeline left edge, keep scroll at 0 so opening notes are not clipped. */
export const SCROLL_PIN_START_SEC = 1

/** Keep playhead in view; returns true if scrollLeft changed. */
export function scrollToIncludeTime(
  scrollEl: HTMLElement,
  layout: EditorLayout,
  timeSec: number,
  marginPx = 48,
  mode: ScrollFollowMode = 'edge',
): boolean {
  const x = timeToX(timeSec - layout.timelineLeft, layout.pps, layout.padL)
  const sl = scrollEl.scrollLeft
  const vw = layout.viewportW
  let next = sl
  if (mode === 'follow') {
    next = Math.max(0, Math.round(x - vw * 0.35))
  } else if (mode === 'offscreen') {
    if (x >= sl && x <= sl + vw) return false
    next = Math.max(0, x - vw * 0.35)
  } else if (mode === 'jump') {
    if (x >= sl + marginPx && x <= sl + vw - marginPx) return false
    next = Math.max(0, x - vw * 0.35)
  } else {
    if (x < sl + marginPx) next = Math.max(0, x - marginPx)
    else if (x > sl + vw - marginPx) next = Math.max(0, x - vw + marginPx)
  }
  if (timeSec < layout.timelineLeft + SCROLL_PIN_START_SEC) {
    next = scrollLeftForTime(layout.timelineLeft, layout, 0)
  }
  if (Math.abs(next - sl) < 1) return false
  scrollEl.scrollLeft = next
  return true
}

/** First note that may still be visible (sorted by onset; end time >= view start). */
function noteIndexFromVisibleStart(
  notes: readonly { time: number; duration: number }[],
  viewStartSec: number,
): number {
  const minEnd = viewStartSec - 0.05
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (notes[mid]!.time + notes[mid]!.duration < minEnd) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function timeFromContentX(cx: number, layout: EditorLayout): number {
  return xToDisplayTime(cx, layout.padL, layout.pps) + layout.timelineLeft
}
