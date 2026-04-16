export type MidiControlBinding = {
  channel: number
  controller: number
} | null

export type MidiTriggerBinding =
  | {
      kind: 'cc'
      channel: number
      controller: number
      /** The CC value sent on physical press (learned). Fire only on this value. */
      pressValue: number
    }
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
  /**
   * Knob (CC 0–127) — chooses which note track is targeted by {@link trackToggle}.
   * Maps across tracks that have notes only (same order as the Tracks dropdown).
   */
  trackFocusKnob: MidiControlBinding
  /** Toggle: add/remove the focused track from practice selection (at least one stays on). */
  trackToggle: MidiTriggerBinding
  /** Chord Learning: start/stop the metronome (same button). */
  metronomeToggle: MidiTriggerBinding
  /** Chord Learning: knob — BPM over 10 → 300 across CC 0 → 127. */
  metronomeBpmKnob: MidiControlBinding
  /** Chord Learning: knob — picks a chord from the current list (Free Practice or active lesson). */
  chordPickerKnob: MidiControlBinding
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
  trackFocusKnob: null,
  trackToggle: null,
  metronomeToggle: null,
  metronomeBpmKnob: null,
  chordPickerKnob: null,
}

const STORAGE_KEY_V3 = 'piano-learner-midi-bindings-v3'
const STORAGE_KEY_V2 = 'piano-learner-midi-bindings-v2'
const STORAGE_KEY_V1 = 'piano-learner-midi-bindings-v1'

export type MidiLearnMode =
  | 'play'
  | 'stop'
  | 'jumpToStart'
  | 'cycleMode'
  | 'cycleHand'
  | 'playhead'
  | 'loopA'
  | 'loopB'
  | 'loopShift'
  | 'nextSong'
  | 'previousSong'
  | 'trackFocus'
  | 'trackToggle'
  | 'metronomeToggle'
  | 'metronomeBpm'
  | 'chordPicker'

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
    trackFocusKnob: o.trackFocusKnob ?? null,
    trackToggle: o.trackToggle ?? null,
    metronomeToggle: o.metronomeToggle ?? null,
    metronomeBpmKnob: o.metronomeBpmKnob ?? null,
    chordPickerKnob: o.chordPickerKnob ?? null,
  }
}

export function loadMidiHardwareBindings(): MidiHardwareBindings {
  try {
    const rawV3 = localStorage.getItem(STORAGE_KEY_V3)
    if (rawV3) {
      const o = JSON.parse(rawV3) as Partial<MidiHardwareBindings>
      return normalizeBindings(o)
    }
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2)
    if (rawV2) {
      const o = JSON.parse(rawV2) as Partial<MidiHardwareBindings>
      const n = normalizeBindings(o)
      saveMidiHardwareBindings(n)
      localStorage.removeItem(STORAGE_KEY_V2)
      return n
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
    localStorage.setItem(STORAGE_KEY_V3, JSON.stringify(b))
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
    if (ch !== b.channel || data[1] !== b.controller) return false
    if (b.pressValue !== undefined) return (data[2] ?? 0) === b.pressValue
    return true
  }
  if (b.kind === 'noteOn' && (st & 0xf0) === 0x90 && data.length >= 3) {
    return (
      ch === b.channel && data[1] === b.note && (data[2] ?? 0) > 0
    )
  }
  return false
}

/**
 * CC buttons fire only when the value matches the learned press value
 * (ignores the release half of momentary buttons).
 * Old bindings without pressValue fall back to any-value matching.
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
    if (b.pressValue !== undefined) return (data[2] ?? 0) === b.pressValue
    return true
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
  | 'trackToggle'
  | 'metronomeToggle'

const triggerFieldMap: Record<TriggerLearnMode, keyof MidiHardwareBindings> = {
  play: 'play',
  stop: 'stop',
  jumpToStart: 'jumpToStart',
  cycleMode: 'cycleMode',
  cycleHand: 'cycleHand',
  playhead: 'loopAtPlayhead',
  nextSong: 'nextSong',
  previousSong: 'previousSong',
  trackToggle: 'trackToggle',
  metronomeToggle: 'metronomeToggle',
}

function learnTriggerField(
  mode: TriggerLearnMode,
  data: Uint8Array,
  current: MidiHardwareBindings,
): MidiHardwareBindings | null {
  const field = triggerFieldMap[mode]
  const st = data[0]
  const ch = st & 0x0f
  /* CC buttons: two-step learn handled by the hook (captures press + release). */
  if ((st & 0xf0) === 0xb0 && data.length >= 3) {
    return null
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

export function isCcMessage(data: Uint8Array): boolean {
  return data.length >= 3 && (data[0]! & 0xf0) === 0xb0
}

export function isTriggerLearnMode(
  mode: MidiLearnMode,
): mode is TriggerLearnMode {
  return mode in triggerFieldMap
}

/**
 * Build a CC trigger binding after two-step learn.
 * @param pressValue - the CC value from the physical press (momentary button).
 *   `undefined` for toggle buttons (fire on any value).
 */
export function buildCcTrigger(
  mode: TriggerLearnMode,
  channel: number,
  controller: number,
  pressValue: number | undefined,
  current: MidiHardwareBindings,
): MidiHardwareBindings {
  const field = triggerFieldMap[mode]
  const t: MidiTriggerBinding = { kind: 'cc', channel, controller, pressValue: pressValue! }
  if (pressValue === undefined) delete (t as { pressValue?: number }).pressValue
  return { ...current, [field]: t }
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
  if (mode === 'trackFocus') {
    if ((st & 0xf0) === 0xb0 && data.length >= 3) {
      return {
        ...current,
        trackFocusKnob: { channel: ch, controller: data[1] },
      }
    }
    return null
  }
  if (mode === 'metronomeBpm') {
    if ((st & 0xf0) === 0xb0 && data.length >= 3) {
      return {
        ...current,
        metronomeBpmKnob: { channel: ch, controller: data[1] },
      }
    }
    return null
  }
  if (mode === 'chordPicker') {
    if ((st & 0xf0) === 0xb0 && data.length >= 3) {
      return {
        ...current,
        chordPickerKnob: { channel: ch, controller: data[1] },
      }
    }
    return null
  }
  return null
}

/**
 * Returns every binding field whose underlying MIDI source matches the
 * incoming message, using a permissive match:
 *   - CC triggers / CC knobs: match on channel + controller, any value (so both
 *     press and release of a momentary button light up the row, and a knob
 *     stays lit while it is being moved).
 *   - Note triggers: match note on AND the implied note off (status 0x80 or
 *     a 0x90 with velocity 0), so the row stays lit for the key's full press.
 *   - System-realtime triggers: match the status byte.
 *
 * Used by the MIDI mapping UI to show the user which rows are already bound to
 * the key / knob they just touched. Read-only — never mutates bindings.
 */
export function findMatchingBindingFields(
  b: MidiHardwareBindings,
  data: Uint8Array,
): (keyof MidiHardwareBindings)[] {
  const out: (keyof MidiHardwareBindings)[] = []
  if (data.length < 1) return out
  const st = data[0]!
  const ch = st & 0x0f
  const isCc = (st & 0xf0) === 0xb0 && data.length >= 3
  const isNoteOn = (st & 0xf0) === 0x90 && data.length >= 3
  const isNoteOff = (st & 0xf0) === 0x80 && data.length >= 2

  const trigMatch = (t: MidiTriggerBinding): boolean => {
    if (!t) return false
    if (t.kind === 'sysRealtime') return st === t.status
    if (t.kind === 'cc') {
      return isCc && ch === t.channel && data[1] === t.controller
    }
    if (t.kind === 'noteOn') {
      if (!(isNoteOn || isNoteOff)) return false
      return ch === t.channel && data[1] === t.note
    }
    return false
  }
  const knobMatch = (k: MidiControlBinding): boolean => {
    if (!k || !isCc) return false
    return ch === k.channel && data[1] === k.controller
  }

  if (trigMatch(b.play)) out.push('play')
  if (trigMatch(b.stop)) out.push('stop')
  if (trigMatch(b.jumpToStart)) out.push('jumpToStart')
  if (trigMatch(b.cycleMode)) out.push('cycleMode')
  if (trigMatch(b.cycleHand)) out.push('cycleHand')
  if (trigMatch(b.loopAtPlayhead)) out.push('loopAtPlayhead')
  if (trigMatch(b.nextSong)) out.push('nextSong')
  if (trigMatch(b.previousSong)) out.push('previousSong')
  if (trigMatch(b.trackToggle)) out.push('trackToggle')
  if (trigMatch(b.metronomeToggle)) out.push('metronomeToggle')
  if (knobMatch(b.loopStartKnob)) out.push('loopStartKnob')
  if (knobMatch(b.loopEndKnob)) out.push('loopEndKnob')
  if (knobMatch(b.loopShiftKnob)) out.push('loopShiftKnob')
  if (knobMatch(b.trackFocusKnob)) out.push('trackFocusKnob')
  if (knobMatch(b.metronomeBpmKnob)) out.push('metronomeBpmKnob')
  if (knobMatch(b.chordPickerKnob)) out.push('chordPickerKnob')
  return out
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
  trackFocusKnob: string
  trackToggle: string
  metronomeToggle: string
  metronomeBpmKnob: string
  chordPickerKnob: string
} {
  const trig = (t: MidiTriggerBinding) => {
    if (!t) return '—'
    if (t.kind === 'cc') {
      const base = `CC ch${t.channel + 1} #${t.controller}`
      return t.pressValue !== undefined ? `${base} press=${t.pressValue}` : base
    }
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
    trackFocusKnob: knob(b.trackFocusKnob),
    trackToggle: trig(b.trackToggle),
    metronomeToggle: trig(b.metronomeToggle),
    metronomeBpmKnob: knob(b.metronomeBpmKnob),
    chordPickerKnob: knob(b.chordPickerKnob),
  }
}
