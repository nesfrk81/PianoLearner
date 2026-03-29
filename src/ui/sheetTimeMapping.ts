import { PLAYHEAD_X_FRAC, PPS } from './timelineConstants'

/** Song time (seconds) at a point on the staff canvas (client X in viewport). */
export function clientXToSongTime(
  clientX: number,
  canvas: HTMLCanvasElement,
  songTime: number,
): number {
  const rect = canvas.getBoundingClientRect()
  const scale = canvas.width / rect.width
  const x = (clientX - rect.left) * scale
  const centerX = canvas.width * PLAYHEAD_X_FRAC
  const scroll = songTime * PPS
  const songX = x - centerX + scroll
  return songX / PPS
}

/** Left offset (CSS px from canvas left edge) for a song time. */
export function songTimeToCssLeft(
  sec: number,
  canvas: HTMLCanvasElement,
  songTime: number,
): number {
  const rect = canvas.getBoundingClientRect()
  const scale = rect.width / canvas.width
  const centerX = canvas.width * PLAYHEAD_X_FRAC
  const scroll = songTime * PPS
  const xCanvas = sec * PPS + centerX - scroll
  return xCanvas * scale
}
