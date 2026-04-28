import { PLAYHEAD_X_FRAC, PPS, VIEW_WIDTH } from './timelineConstants'

/** Song time (seconds) at a point on the staff surface (client X in viewport). */
export function clientXToSongTime(
  clientX: number,
  surface: Element,
  songTime: number,
  contentWidth = VIEW_WIDTH,
): number {
  const rect = surface.getBoundingClientRect()
  const scale = contentWidth / rect.width
  const x = (clientX - rect.left) * scale
  const centerX = contentWidth * PLAYHEAD_X_FRAC
  const scroll = songTime * PPS
  const songX = x - centerX + scroll
  return songX / PPS
}

/** Left offset (CSS px from staff surface left edge) for a song time. */
export function songTimeToCssLeft(
  sec: number,
  surface: Element,
  songTime: number,
  contentWidth = VIEW_WIDTH,
): number {
  const rect = surface.getBoundingClientRect()
  const scale = rect.width / contentWidth
  const centerX = contentWidth * PLAYHEAD_X_FRAC
  const scroll = songTime * PPS
  const xCanvas = sec * PPS + centerX - scroll
  return xCanvas * scale
}
