import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { clefForMidi, midiToStaffYFrac } from '../midi/staffLayout'
import type { NoteView } from '../types'
import { clientXToSongTime, songTimeToCssLeft } from './sheetTimeMapping'
import { PLAYHEAD_X_FRAC, PPS, VIEW_WIDTH } from './timelineConstants'

const MIN_LOOP_SEC = 0.05
const STAFF_HEIGHT = 200
const TREBLE_TOP = 12
const TREBLE_H = STAFF_HEIGHT * 0.36
const BASS_TOP = STAFF_HEIGHT * 0.54
const LINE_GAP = TREBLE_H / 6
const NOTE_HEAD_RX = 6
const STEM_H = 26
const VISIBLE_NOTE_BUFFER_SEC = 2

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
  splitMidi: number
  playing: boolean
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
  getSongTime,
  splitMidi,
  playing,
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

  const centerX = VIEW_WIDTH * PLAYHEAD_X_FRAC
  const maxNoteDuration = useMemo(
    () => notes.reduce((max, n) => Math.max(max, n.duration), 0),
    [notes],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const staffLength = Math.max(VIEW_WIDTH, duration * PPS + 120)
    const orangeHi = '#f5a84a'
    const ink = '#141414'
    let raf = 0

    const draw = () => {
      const currentSongTime = getSongTime()
      const scroll = currentSongTime * PPS
      const playheadX = currentSongTime * PPS
      const userX = playheadX - 10
      const visibleStartSec = Math.max(
        0,
        currentSongTime - centerX / PPS - VISIBLE_NOTE_BUFFER_SEC,
      )
      const visibleEndSec =
        currentSongTime + (VIEW_WIDTH - centerX) / PPS + VISIBLE_NOTE_BUFFER_SEC
      const visibleStartIndex = lowerBoundNoteTime(
        notes,
        Math.max(0, visibleStartSec - maxNoteDuration),
      )

      ctx.clearRect(0, 0, VIEW_WIDTH, STAFF_HEIGHT)
      ctx.fillStyle = '#e6e6ea'
      ctx.fillRect(0, 0, VIEW_WIDTH, STAFF_HEIGHT)

      ctx.save()
      ctx.translate(centerX - scroll, 0)

      if (loopEnabled && loopB > loopA) {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.08)'
        ctx.fillRect(loopA * PPS, 0, (loopB - loopA) * PPS, STAFF_HEIGHT)
      }

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)'
      ctx.lineWidth = 1
      for (const top of [TREBLE_TOP, BASS_TOP]) {
        for (let i = 0; i < 5; i += 1) {
          const y = top + i * LINE_GAP
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.lineTo(staffLength, y)
          ctx.stroke()
        }
      }

      ctx.font = '600 11px system-ui,sans-serif'
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
      ctx.fillText('Treble', 4, TREBLE_TOP - 3)
      ctx.fillText('Bass', 4, BASS_TOP - 3)

      for (let i = visibleStartIndex; i < notes.length; i += 1) {
        const n = notes[i]!
        if (n.time + n.duration < visibleStartSec) continue
        if (n.time > visibleEndSec) break

        const clef = clefForMidi(n.midi, splitMidi)
        const frac = midiToStaffYFrac(n.midi, clef)
        const staffTop = clef === 'treble' ? TREBLE_TOP : BASS_TOP
        const y = staffTop + frac * TREBLE_H
        const x = n.time * PPS
        const width = Math.max(3, n.duration * PPS)
        const active =
          currentSongTime >= n.time - 0.04 &&
          currentSongTime <= n.time + n.duration

        if (width > 14) {
          ctx.fillStyle = active
            ? 'rgba(245, 168, 74, 0.45)'
            : 'rgba(0, 0, 0, 0.2)'
          ctx.fillRect(
            x + NOTE_HEAD_RX + 4,
            y - STEM_H,
            width - NOTE_HEAD_RX - 4,
            2,
          )
        }

        ctx.strokeStyle = active ? '#c45f12' : 'rgba(0, 0, 0, 0.35)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x + NOTE_HEAD_RX + 3, y)
        ctx.lineTo(x + NOTE_HEAD_RX + 3, y - STEM_H)
        ctx.stroke()

        ctx.fillStyle = active ? orangeHi : ink
        ctx.beginPath()
        ctx.ellipse(x + NOTE_HEAD_RX, y, NOTE_HEAD_RX, 4, -0.32, 0, Math.PI * 2)
        ctx.fill()
      }

      for (const midi of userMidi) {
        const clef = clefForMidi(midi, splitMidi)
        const frac = midiToStaffYFrac(midi, clef)
        const staffTop = clef === 'treble' ? TREBLE_TOP : BASS_TOP
        const y = staffTop + frac * TREBLE_H

        ctx.strokeStyle = '#ea580c'
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.ellipse(userX, y, 7, 4.5, -0.32, 0, Math.PI * 2)
        ctx.stroke()

        ctx.fillStyle = orangeHi
        ctx.beginPath()
        ctx.ellipse(userX, y, NOTE_HEAD_RX, 4, -0.32, 0, Math.PI * 2)
        ctx.fill()

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(userX + NOTE_HEAD_RX, y)
        ctx.lineTo(userX + NOTE_HEAD_RX, y - STEM_H)
        ctx.stroke()
      }

      ctx.strokeStyle = '#dc2626'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(playheadX, 0)
      ctx.lineTo(playheadX, STAFF_HEIGHT)
      ctx.stroke()

      ctx.restore()

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(centerX, 0)
      ctx.lineTo(centerX, STAFF_HEIGHT)
      ctx.stroke()

      if (playing) raf = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(raf)
  }, [
    centerX,
    duration,
    getSongTime,
    loopA,
    loopB,
    loopEnabled,
    maxNoteDuration,
    notes,
    playing,
    songTime,
    splitMidi,
    userMidi,
  ])

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || duration <= 0) return
    const sec = clientXToSongTime(e.clientX, canvas, getSongTime())
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
      const sec = clientXToSongTime(ev.clientX, canvas, getSongTime())
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
        height={STAFF_HEIGHT}
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
