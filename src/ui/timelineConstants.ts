/** Wheel scrub only when the event target is inside an element with this attribute. */
export const WHEEL_SEEK_ZONE_ATTR = 'data-wheel-seek-zone'

/** Pixels per second — shared by staff, piano roll, and loop handles */
export const PPS = 110
export const VIEW_WIDTH = 1280
export const PLAYHEAD_X_FRAC = 0.35

/** Extra seconds beyond staff edges when culling notes / MIDI loop knob ranges. */
export const VISIBLE_NOTE_BUFFER_SEC = 2

/** Song-time window visible on the staff for a given playhead position. */
export function visibleSongTimeRange(
  songTime: number,
  bufferSec = VISIBLE_NOTE_BUFFER_SEC,
): { start: number; end: number } {
  const centerX = VIEW_WIDTH * PLAYHEAD_X_FRAC
  return {
    start: Math.max(0, songTime - centerX / PPS - bufferSec),
    end: songTime + (VIEW_WIDTH - centerX) / PPS + bufferSec,
  }
}

export function timesInRange(times: number[], start: number, end: number): number[] {
  return times.filter((t) => t >= start && t <= end)
}
