import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { clefForMidi, midiToStaffYFrac } from '../midi/staffLayout'
import type { NoteView } from '../types'
import { clientXToSongTime, songTimeToCssLeft } from './sheetTimeMapping'
import { PLAYHEAD_X_FRAC, PPS, VIEW_WIDTH } from './timelineConstants'

const MIN_LOOP_SEC = 0.05

type Props = {
  notes: NoteView[]
  duration: number
  songTime: number
  splitMidi: number
  loopEnabled: boolean
  loopA: number
  loopB: number
  userMidi: ReadonlySet<number>
  onInitLoopRegion: (centerSec: number) => void
  onLoopBoundsChange: (a: number, b: number) => void
  loopOverlayOpen: boolean
  onCloseLoopOverlay: () => void
}

export function StaffCanvas({
  notes,
  duration,
  songTime,
  splitMidi,
  loopEnabled,
  loopA,
  loopB,
  userMidi,
  onInitLoopRegion,
  onLoopBoundsChange,
  loopOverlayOpen,
  onCloseLoopOverlay,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)
  const setCanvasRef = useCallback((node: HTMLCanvasElement | null) => {
    canvasRef.current = node
    setCanvasEl(node)
  }, [])

  const songTimeRef = useRef(songTime)
  const loopARef = useRef(loopA)
  const loopBRef = useRef(loopB)
  const durationRef = useRef(duration)

  const [canvasRectW, setCanvasRectW] = useState(0)

  useLayoutEffect(() => {
    songTimeRef.current = songTime
    loopARef.current = loopA
    loopBRef.current = loopB
    durationRef.current = duration
  }, [songTime, loopA, loopB, duration])

  useEffect(() => {
    if (!canvasEl) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w != null) setCanvasRectW(w)
    })
    ro.observe(canvasEl)
    return () => ro.disconnect()
  }, [canvasEl])

  const overlayPx = useMemo(
    () => {
      if (!canvasEl || duration <= 0 || !loopOverlayOpen) {
        return { left: 0, right: 0 }
      }
      return {
        left: songTimeToCssLeft(loopA, canvasEl, songTime),
        right: songTimeToCssLeft(loopB, canvasEl, songTime),
      }
    },
    /* canvasRectW: bust cache when element is resized without changing ref */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canvasEl, canvasRectW, loopA, loopB, songTime, duration, loopOverlayOpen],
  )

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const w = c.width
    const h = c.height
    const trebleTop = 8
    const trebleH = h * 0.38
    const bassTop = h * 0.52
    const lineGap = trebleH / 6

    ctx.fillStyle = '#e6e6ea'
    ctx.fillRect(0, 0, w, h)

    const centerX = w * PLAYHEAD_X_FRAC
    const scroll = songTime * PPS
    ctx.save()
    ctx.translate(centerX - scroll, 0)

    if (loopEnabled && loopB > loopA) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.08)'
      ctx.fillRect(loopA * PPS, 0, (loopB - loopA) * PPS, h)
    }

    const drawStaff = (top: number, lines: number, gap: number) => {
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)'
      ctx.lineWidth = 1
      for (let i = 0; i < lines; i++) {
        const y = top + i * gap
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(duration * PPS + 80, y)
        ctx.stroke()
      }
    }

    drawStaff(trebleTop, 5, lineGap)
    drawStaff(bassTop, 5, lineGap)

    ctx.font = '600 11px system-ui,sans-serif'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.fillText('Treble', 4, trebleTop - 1)
    ctx.fillText('Bass', 4, bassTop - 1)

    const orangeHi = '#f5a84a'
    const ink = '#141414'

    for (const n of notes) {
      const clef = clefForMidi(n.midi, splitMidi)
      const frac = midiToStaffYFrac(n.midi, clef)
      const staffTop = clef === 'treble' ? trebleTop : bassTop
      const staffH = trebleH
      const y = staffTop + frac * staffH
      const x = n.time * PPS
      const nw = Math.max(3, n.duration * PPS)

      const atPlayhead =
        songTime >= n.time - 0.04 && songTime <= n.time + n.duration
      ctx.fillStyle = atPlayhead ? orangeHi : ink
      ctx.beginPath()
      ctx.ellipse(x + 4, y, 5, 3.5, 0, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = atPlayhead ? '#c45f12' : 'rgba(0, 0, 0, 0.35)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x + 9, y)
      ctx.lineTo(x + 9, y - 22)
      ctx.stroke()

      if (nw > 14) {
        ctx.fillStyle = atPlayhead ? 'rgba(245, 168, 74, 0.45)' : 'rgba(0, 0, 0, 0.2)'
        ctx.fillRect(x + 9, y - 22, nw - 10, 2)
      }
    }

    const playheadX = songTime * PPS
    const userX = playheadX - 10
    for (const midi of userMidi) {
      const clef = clefForMidi(midi, splitMidi)
      const frac = midiToStaffYFrac(midi, clef)
      const staffTop = clef === 'treble' ? trebleTop : bassTop
      const y = staffTop + frac * trebleH

      ctx.strokeStyle = '#ea580c'
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.ellipse(userX, y, 6.5, 4.2, 0, 0, Math.PI * 2)
      ctx.stroke()

      ctx.fillStyle = orangeHi
      ctx.beginPath()
      ctx.ellipse(userX, y, 5, 3.5, 0, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(userX + 6, y)
      ctx.lineTo(userX + 6, y - 24)
      ctx.stroke()
    }

    ctx.strokeStyle = '#dc2626'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(playheadX, 0)
    ctx.lineTo(playheadX, h)
    ctx.stroke()

    ctx.restore()

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(centerX, 0)
    ctx.lineTo(centerX, h)
    ctx.stroke()
  }, [
    notes,
    duration,
    songTime,
    splitMidi,
    loopEnabled,
    loopA,
    loopB,
    userMidi,
  ])

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current
    if (!c || duration <= 0) return
    const sec = clientXToSongTime(e.clientX, c, songTime)
    if (sec >= 0 && sec <= duration) {
      onInitLoopRegion(sec)
    }
  }

  const attachDrag = (which: 'a' | 'b') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const canvas = canvasRef.current
    if (!canvas) return

    const move = (ev: PointerEvent) => {
      const sec = clientXToSongTime(ev.clientX, canvas, songTimeRef.current)
      const d = durationRef.current
      const a0 = loopARef.current
      const b0 = loopBRef.current
      if (which === 'a') {
        const na = Math.max(0, Math.min(b0 - MIN_LOOP_SEC, sec))
        onLoopBoundsChange(na, b0)
      } else {
        const nb = Math.min(d, Math.max(a0 + MIN_LOOP_SEC, sec))
        onLoopBoundsChange(a0, nb)
      }
    }

    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const { left: leftPx, right: rightPx } = overlayPx
  const showOverlay = duration > 0 && loopOverlayOpen && rightPx >= leftPx

  return (
    <div className="sheet-canvas-wrap">
      <canvas
        ref={setCanvasRef}
        width={VIEW_WIDTH}
        height={200}
        className="sheet-canvas"
        onClick={onCanvasClick}
        role="img"
        aria-label="Sheet music — click to set loop region"
      />
      {showOverlay && (
        <div className="sheet-loop-overlay">
          <div
            className="sheet-loop-dim sheet-loop-dim--left"
            style={{ width: `${Math.max(0, leftPx)}px` }}
          />
          <div
            className="sheet-loop-dim sheet-loop-dim--right"
            style={{ left: `${rightPx}px` }}
          />
          <div
            className="sheet-loop-band"
            style={{
              left: `${leftPx}px`,
              width: `${Math.max(0, rightPx - leftPx)}px`,
            }}
          />
          <button
            type="button"
            className="sheet-loop-done"
            onClick={onCloseLoopOverlay}
          >
            Done
          </button>
          <div
            role="slider"
            className="sheet-loop-handle sheet-loop-handle--a"
            style={{ left: `${leftPx}px` }}
            aria-label="Loop start — drag to adjust"
            aria-valuenow={Math.round(loopA * 1000) / 1000}
            onPointerDown={attachDrag('a')}
          />
          <div
            role="slider"
            className="sheet-loop-handle sheet-loop-handle--b"
            style={{ left: `${rightPx}px` }}
            aria-label="Loop end — drag to adjust"
            aria-valuenow={Math.round(loopB * 1000) / 1000}
            onPointerDown={attachDrag('b')}
          />
        </div>
      )}
    </div>
  )
}
