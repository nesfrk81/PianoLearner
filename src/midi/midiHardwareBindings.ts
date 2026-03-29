export type MidiControlBinding = {
  channel: number
  controller: number
} | null

export type MidiTriggerBinding =
  | { kind: 'cc'; channel: number; controller: number }
  | { kind: 'noteOn'; channel: number; note: number }
  | null

export type MidiHardwareBindings = {
  /** Play / pause (toggle), same as Space — learned button or note. */
  play: MidiTriggerBinding
  /** Pause playback only — learned button or note. */
  stop: MidiTriggerBinding
  /** Record: loop at playhead; press again to clear loop. */
  loopAtPlayhead: MidiTriggerBinding
  /** Knob → loop start (left bar), absolute 0–127 → timeline. */
  loopStartKnob: MidiControlBinding
  /** Knob → loop end (right bar). */
  loopEndKnob: MidiControlBinding
}

export const defaultMidiHardwareBindings: MidiHardwareBindings = {
  play: null,
  stop: null,
  loopAtPlayhead: null,
  loopStartKnob: null,
  loopEndKnob: null,
}

const STORAGE_KEY_V2 = 'piano-learner-midi-bindings-v2'
const STORAGE_KEY_V1 = 'piano-learner-midi-bindings-v1'

export type MidiLearnMode = 'play' | 'stop' | 'playhead' | 'loopA' | 'loopB'

function normalizeBindings(
  o: Partial<MidiHardwareBindings>,
): MidiHardwareBindings {
  return {
    play: o.play ?? null,
    stop: o.stop ?? null,
    loopAtPlayhead: o.loopAtPlayhead ?? null,
    loopStartKnob: o.loopStartKnob ?? null,
    loopEndKnob: o.loopEndKnob ?? null,
  }
}

export function loadMidiHardwareBindings(): MidiHardwareBindings {
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2)
    if (rawV2) {
      const o = JSON.parse(rawV2) as Partial<MidiHardwareBindings>
      return normalizeBindings(o)
    }
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1)
    if (rawV1) {
      const o = JSON.parse(rawV1) as Partial<MidiHardwareBindings>
      const n = normalizeBindings(o)
      saveMidiHardwareBindings(n)
      localStorage.removeItem(STORAGE_KEY_V1)
      return n
    }
  } catch {
    /* ignore */
  }
  return { ...defaultMidiHardwareBindings }
}

export function saveMidiHardwareBindings(b: MidiHardwareBindings): void {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(b))
  } catch {
    /* ignore */
  }
}

export function matchesTrigger(
  b: MidiTriggerBinding,
  data: Uint8Array,
): boolean {
  if (!b || data.length < 2) return false
  const st = data[0]
  const ch = st & 0x0f
  if (b.kind === 'cc' && (st & 0xf0) === 0xb0 && data.length >= 3) {
    return ch === b.channel && data[1] === b.controller
  }
  if (b.kind === 'noteOn' && (st & 0xf0) === 0x90 && data.length >= 3) {
    return (
      ch === b.channel && data[1] === b.note && (data[2] ?? 0) > 0
    )
  }
  return false
}

/**
 * CC buttons: fire on value ≥ 64; note-on: velocity > 0.
 * Used for play, stop, and record/loop toggles.
 */
export function matchesHardwareButtonTrigger(
  b: MidiTriggerBinding,
  data: Uint8Array,
): boolean {
  if (!b || data.length < 2) return false
  const st = data[0]
  const ch = st & 0x0f
  if (b.kind === 'cc' && (st & 0xf0) === 0xb0 && data.length >= 3) {
    if (ch !== b.channel || data[1] !== b.controller) return false
    return (data[2] ?? 0) >= 64
  }
  if (b.kind === 'noteOn' && (st & 0xf0) === 0x90 && data.length >= 3) {
    return ch === b.channel && data[1] === b.note && data[2] > 0
  }
  return false
}

/** @deprecated Use matchesHardwareButtonTrigger */
export const matchesLoopAtPlayheadTrigger = matchesHardwareButtonTrigger

export function matchesCcControl(
  b: MidiControlBinding,
  data: Uint8Array,
): boolean {
  if (!b || data.length < 3) return false
  const st = data[0]
  return (
    (st & 0xf0) === 0xb0 &&
    (st & 0x0f) === b.channel &&
    data[1] === b.controller
  )
}

function learnTriggerField(
  mode: 'play' | 'stop' | 'playhead',
  data: Uint8Array,
  current: MidiHardwareBindings,
): MidiHardwareBindings | null {
  const st = data[0]
  const ch = st & 0x0f
  if ((st & 0xf0) === 0xb0 && data.length >= 3) {
    const t = {
      kind: 'cc' as const,
      channel: ch,
      controller: data[1],
    }
    if (mode === 'play') return { ...current, play: t }
    if (mode === 'stop') return { ...current, stop: t }
    return { ...current, loopAtPlayhead: t }
  }
  if ((st & 0xf0) === 0x90 && data.length >= 3 && data[2] > 0) {
    const t = {
      kind: 'noteOn' as const,
      channel: ch,
      note: data[1],
    }
    if (mode === 'play') return { ...current, play: t }
    if (mode === 'stop') return { ...current, stop: t }
    return { ...current, loopAtPlayhead: t }
  }
  return null
}

/** Capture learn target from first eligible message. Returns updated bindings or null if ignored. */
export function learnFromMessage(
  mode: MidiLearnMode,
  data: Uint8Array,
  current: MidiHardwareBindings,
): MidiHardwareBindings | null {
  if (mode === 'play' || mode === 'stop' || mode === 'playhead') {
    return learnTriggerField(mode, data, current)
  }
  const st = data[0]
  const ch = st & 0x0f
  if (mode === 'loopA' || mode === 'loopB') {
    if ((st & 0xf0) === 0xb0 && data.length >= 3) {
      const knob = { channel: ch, controller: data[1] }
      if (mode === 'loopA') {
        return { ...current, loopStartKnob: knob }
      }
      return { ...current, loopEndKnob: knob }
    }
    return null
  }
  return null
}

export function describeBinding(b: MidiHardwareBindings): {
  play: string
  stop: string
  loopAtPlayhead: string
  loopStartKnob: string
  loopEndKnob: string
} {
  const trig = (t: MidiTriggerBinding) => {
    if (!t) return '—'
    if (t.kind === 'cc') return `CC ch${t.channel + 1} #${t.controller}`
    return `Note On ch${t.channel + 1} ${t.note}`
  }
  const knob = (k: MidiControlBinding) => {
    if (!k) return '—'
    return `CC ch${k.channel + 1} #${k.controller}`
  }
  return {
    play: trig(b.play),
    stop: trig(b.stop),
    loopAtPlayhead: trig(b.loopAtPlayhead),
    loopStartKnob: knob(b.loopStartKnob),
    loopEndKnob: knob(b.loopEndKnob),
  }
}
