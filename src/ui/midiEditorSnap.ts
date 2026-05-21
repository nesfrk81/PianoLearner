import type { Midi } from '@tonejs/midi'

export const MIN_DURATION_SEC = 0.05

/** Default painted note length: one 16th note at the file tempo. */
export function defaultNoteDurationSec(midi: Midi): number {
  return sixteenthStepSec(midi)
}

export function snapIntervalTicks(midi: Midi): number {
  const ppq = midi.header.ppq
  return Math.max(1, Math.round(ppq / 4))
}

export function snapSeconds(sec: number, midi: Midi, minSec = 0): number {
  const h = midi.header
  const step = snapIntervalTicks(midi)
  const ticks = h.secondsToTicks(sec)
  const snapped = Math.round(ticks / step) * step
  return Math.max(minSec, h.ticksToSeconds(snapped))
}

export function snapDurationFromStart(
  startSec: number,
  durationSec: number,
  midi: Midi,
): number {
  const h = midi.header
  const step = snapIntervalTicks(midi)
  const startTicks = h.secondsToTicks(startSec)
  const endTicksIdeal = h.secondsToTicks(startSec + durationSec)
  const minDurTicks = Math.max(
    step,
    Math.ceil(
      (h.secondsToTicks(startSec + MIN_DURATION_SEC) - startTicks) / step,
    ) * step,
  )
  const idealDurTicks = Math.max(minDurTicks, endTicksIdeal - startTicks)
  const snappedDurTicks = Math.max(
    minDurTicks,
    Math.round(idealDurTicks / step) * step,
  )
  return Math.max(
    MIN_DURATION_SEC,
    h.ticksToSeconds(startTicks + snappedDurTicks) - startSec,
  )
}

export function quarterSec(midi: Midi): number {
  const bpm = midi.header.tempos[0]?.bpm ?? 120
  return 60 / bpm
}

export function beatsPerBar(midi: Midi): number {
  const ts = midi.header.timeSignatures[0]?.timeSignature
  return ts?.[0] ?? 4
}

export function barSec(midi: Midi): number {
  return quarterSec(midi) * beatsPerBar(midi)
}

export function extraEditSec(midi: Midi): number {
  return barSec(midi) * 4
}

export function sixteenthStepSec(midi: Midi): number {
  const h = midi.header
  const step = snapIntervalTicks(midi)
  return h.ticksToSeconds(step)
}
