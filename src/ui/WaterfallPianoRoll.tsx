import { useEffect, useMemo, useRef } from 'react'
import { getKeyRectsNormalized, relKeyGeom } from './pianoKeyLayout'
import type { NoteView } from '../types'
import { VIEW_WIDTH as VIEW_W } from './timelineConstants'
const VIEW_H = 300
/** Pixels per second — vertical, bottom = now */
export const VPPS = 100

function lowerBoundNoteTime(notes: NoteView[], targetSec: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (notes[mid]!.time < targetSec) lo = mid + 1
    else hi = mid
  }
  return lo
}

type Props = {
  notes: NoteView[]
  duration: number
  songTime: number
  getSongTime: () => number
  playing: boolean
  minPitch: number
  maxPitch: number
  onSeek: (sec: number) => void
}

export function WaterfallPianoRoll({
  notes,
  duration,
  songTime,
  getSongTime,
  playing,
  minPitch,
  maxPitch,
  onSeek,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rects = useMemo(
    () => getKeyRectsNormalized(minPitch, maxPitch),
    [minPitch, maxPitch],
  )
  const maxNoteDuration = useMemo(
    () => notes.reduce((max, n) => Math.max(max, n.duration), 0),
    [notes],
  )

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const w = c.width
    const h = c.height
    let raf = 0

    const draw = () => {
      const currentSongTime = getSongTime()
      const visibleStartIndex = lowerBoundNoteTime(
        notes,
        Math.max(0, currentSongTime - maxNoteDuration),
      )

      ctx.fillStyle = '#0d0d12'
      ctx.fillRect(0, 0, w, h)

      for (let m = minPitch; m <= maxPitch; m++) {
        const r = rects.get(m)
        if (!r) continue
        if (relKeyGeom(m).isBlack) continue
        const x = r.left * w
        const bw = r.width * w
        ctx.fillStyle = 'rgba(255,255,255,0.055)'
        ctx.fillRect(x, 0, bw, h)
      }
      for (let m = minPitch; m <= maxPitch; m++) {
        const r = rects.get(m)
        if (!r) continue
        if (!relKeyGeom(m).isBlack) continue
        const x = r.left * w
        const bw = r.width * w
        ctx.fillStyle = 'rgba(0,0,0,0.42)'
        ctx.fillRect(x, 0, bw, h * 0.58)
      }

      const noteOrange = '#e8893a'
      const noteOrangeHi = '#f4a84c'
      const strokeOrange = '#c45f12'

      const visibleEndSec = currentSongTime + h / VPPS
      for (let i = visibleStartIndex; i < notes.length; i += 1) {
        const n = notes[i]!
        if (n.time > visibleEndSec) break
        if (n.midi < minPitch || n.midi > maxPitch) continue
        const kr = rects.get(n.midi)
        if (!kr) continue
        const x = kr.left * w + 0.5
        const bw = Math.max(2, kr.width * w - 1)

        const bottomY = h - (n.time - currentSongTime) * VPPS
        const topY = bottomY - n.duration * VPPS
        if (topY >= h || bottomY <= 0) continue

        const t0 = Math.max(0, topY)
        const t1 = Math.min(h, bottomY)
        if (t1 <= t0) continue

        const hit =
          currentSongTime >= n.time - 0.04 &&
          currentSongTime <= n.time + Math.min(n.duration, 0.25)
        ctx.fillStyle = hit ? noteOrangeHi : noteOrange
        ctx.fillRect(x, t0, bw, t1 - t0)
        ctx.strokeStyle = strokeOrange
        ctx.lineWidth = 1
        ctx.strokeRect(x + 0.5, t0 + 0.5, bw - 1, t1 - t0 - 1)
      }

      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 3
      ctx.shadowColor = 'rgba(239, 68, 68, 0.6)'
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.moveTo(0, h - 2)
      ctx.lineTo(w, h - 2)
      ctx.stroke()
      ctx.shadowBlur = 0

      if (playing) raf = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(raf)
  }, [
    notes,
    duration,
    songTime,
    getSongTime,
    playing,
    minPitch,
    maxPitch,
    rects,
    maxNoteDuration,
  ])

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current
    if (!c) return
    const rect = c.getBoundingClientRect()
    const y = (e.clientY - rect.top) * (c.height / rect.height)
    const deltaSec = (c.height - y) / VPPS
    const t = Math.max(0, Math.min(duration, getSongTime() + deltaSec))
    onSeek(t)
  }

  return (
    <div className="waterfall-wrap">
      <canvas
        ref={canvasRef}
        width={VIEW_W}
        height={VIEW_H}
        className="waterfall-canvas"
        onClick={onClick}
        role="img"
        aria-label="Falling notes — red line is when to play"
      />
    </div>
  )
}
