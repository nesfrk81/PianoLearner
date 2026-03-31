export type MidiControlBinding = {
  channel: number
  controller: number
} | null

export type MidiTriggerBinding =
  | { kind: 'cc'; channel: number; controller: number }
  | { kind: 'noteOn'; channel: number; note: number }
  /** System realtime (1 byte), e.g. Start 0xfa, Continue 0xfb, Stop 0xfc */
  | { kind: 'sysRealtime'; status: number }
  | null

export type MidiHardwareBindings = {
  /** Play / pause (toggle), same as Space — learned button or note. */
  play: MidiTriggerBinding
  /** Pause playback only — learned button or note. */
  stop: MidiTriggerBinding
  /** Jump to start (Home). */
  jumpToStart: MidiTriggerBinding
  /** Cycle practice mode: listen → follow → wait → listen. */
  cycleMode: MidiTriggerBinding
  /** Cycle practice hand: both → right → left → both. */
  cycleHand: MidiTriggerBinding
  /** Record: loop at playhead; press again to clear loop. */
  loopAtPlayhead: MidiTriggerBinding
  /** Knob → loop start (left bar), absolute 0–127 → timeline. */
  loopStartKnob: MidiControlBinding
  /** Knob → loop end (right bar). */
  loopEndKnob: MidiControlBinding
  /** Knob → slide the entire loop region across the timeline (0–127). */
  loopShiftKnob: MidiControlBinding
  /** Next song in playlist (wraps). */
  nextSong: MidiTriggerBinding
  /** Previous song in playlist (wraps). */
  previousSong: MidiTriggerBinding
}

export const defaultMidiHardwareBindings: MidiHardwareBindings = {
  play: null,
  stop: null,
  jumpToStart: null,
  cycleMode: null,
  cycleHand: null,
  loopAtPlayhead: null,
  loopStartKnob: null,
  loopEndKnob: null,
  loopShiftKnob: null,
  nextSong: null,
  previousSong: null,
}

const STORAGE_KEY_V2 = 'piano-learner-midi-bindings-v2'
const STORAGE_KEY_V1 = 'piano-learner-midi-bindings-v1'

export type MidiLearnMode = 'play' | 'stop' | 'jumpToStart' | 'cycleMode' | 'cycleHand' | 'playhead' | 'loopA' | 'loopB' | 'loopShift' | 'nextSong' | 'previousSong'

function normalizeBindings(
  o: Partial<MidiHardwareBindings>,
): MidiHardwareBindings {
  return {
    play: o.play ?? null,
    stop: o.stop ?? null,
    jumpToStart: o.jumpToStart ?? null,
    cycleMode: o.cycleMode ?? null,
    cycleHand: o.cycleHand ?? null,
    loopAtPlayhead: o.loopAtPlayhead ?? null,
    loopStartKnob: o.loopStartKnob ?? null,
    loopEndKnob: o.loopEndKnob ?? null,
    loopShiftKnob: o.loopShiftKnob ?? null,
    nextSong: o.nextSong ?? null,
    previousSong: o.previousSong ?? null,
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
  if (!b || data.length < 1) return false
  const st = data[0]
  if (b.kind === 'sysRealtime') {
    return st === b.status
  }
  if (data.length < 2) return false
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
  if (!b || data.length < 1) return false
  const st = data[0]
  if (b.kind === 'sysRealtime') {
    return st === b.status
  }
  if (data.length < 2) return false
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

type TriggerLearnMode =
  | 'play'
  | 'stop'
  | 'jumpToStart'
  | 'cycleMode'
  | 'cycleHand'
  | 'playhead'
  | 'nextSong'
  | 'previousSong'

const triggerFieldMap: Record<TriggerLearnMode, keyof MidiHardwareBindings> = {
  play: 'play',
  stop: 'stop',
  jumpToStart: 'jumpToStart',
  cycleMode: 'cycleMode',
  cycleHand: 'cycleHand',
  playhead: 'loopAtPlayhead',
  nextSong: 'nextSong',
  previousSong: 'previousSong',
}

function learnTriggerField(
  mode: TriggerLearnMode,
  data: Uint8Array,
  current: MidiHardwareBindings,
): MidiHardwareBindings | null {
  const field = triggerFieldMap[mode]
  const st = data[0]
  const ch = st & 0x0f
  if ((st & 0xf0) === 0xb0 && data.length >= 3) {
    const t: MidiTriggerBinding = { kind: 'cc', channel: ch, controller: data[1] }
    return { ...current, [field]: t }
  }
  if ((st & 0xf0) === 0x90 && data.length >= 3 && data[2] > 0) {
    const t: MidiTriggerBinding = { kind: 'noteOn', channel: ch, note: data[1] }
    return { ...current, [field]: t }
  }
  if (data.length >= 1) {
    if (mode === 'play' && (st === 0xfa || st === 0xfb)) {
      return { ...current, play: { kind: 'sysRealtime', status: st } }
    }
    if (mode === 'stop' && st === 0xfc) {
      return { ...current, stop: { kind: 'sysRealtime', status: st } }
    }
  }
  return null
}

/** Capture learn target from first eligible message. Returns updated bindings or null if ignored. */
export function learnFromMessage(
  mode: MidiLearnMode,
  data: Uint8Array,
  current: MidiHardwareBindings,
): MidiHardwareBindings | null {
  if (mode in triggerFieldMap) {
    return learnTriggerField(mode as TriggerLearnMode, data, current)
  }
  const st = data[0]
  const ch = st & 0x0f
  if (mode === 'loopA' || mode === 'loopB' || mode === 'loopShift') {
    if ((st & 0xf0) === 0xb0 && data.length >= 3) {
      const knob = { channel: ch, controller: data[1] }
      if (mode === 'loopA') return { ...current, loopStartKnob: knob }
      if (mode === 'loopB') return { ...current, loopEndKnob: knob }
      return { ...current, loopShiftKnob: knob }
    }
    return null
  }
  return null
}

export function describeBinding(b: MidiHardwareBindings): {
  play: string
  stop: string
  jumpToStart: string
  cycleMode: string
  cycleHand: string
  loopAtPlayhead: string
  loopStartKnob: string
  loopEndKnob: string
  loopShiftKnob: string
  nextSong: string
  previousSong: string
} {
  const trig = (t: MidiTriggerBinding) => {
    if (!t) return '—'
    if (t.kind === 'cc') return `CC ch${t.channel + 1} #${t.controller}`
    if (t.kind === 'noteOn') return `Note On ch${t.channel + 1} ${t.note}`
    const label =
      t.status === 0xfa
        ? 'Start'
        : t.status === 0xfb
          ? 'Continue'
          : t.status === 0xfc
            ? 'Stop'
            : 'Sys'
    return `MIDI ${label} (0x${t.status.toString(16)})`
  }
  const knob = (k: MidiControlBinding) => {
    if (!k) return '—'
    return `CC ch${k.channel + 1} #${k.controller}`
  }
  return {
    play: trig(b.play),
    stop: trig(b.stop),
    jumpToStart: trig(b.jumpToStart),
    cycleMode: trig(b.cycleMode),
    cycleHand: trig(b.cycleHand),
    loopAtPlayhead: trig(b.loopAtPlayhead),
    loopStartKnob: knob(b.loopStartKnob),
    loopEndKnob: knob(b.loopEndKnob),
    loopShiftKnob: knob(b.loopShiftKnob),
    nextSong: trig(b.nextSong),
    previousSong: trig(b.previousSong),
  }
}
