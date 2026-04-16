import {
  describeBinding,
  type MidiHardwareBindings,
  type MidiLearnMode,
} from '../midi/midiHardwareBindings'

type BindingField = keyof MidiHardwareBindings

type Props = {
  midiConnected: string | null
  bindings: MidiHardwareBindings
  learnMode: MidiLearnMode | null
  onSetLearnMode: (m: MidiLearnMode | null) => void
  activityLog: string[]
  onClearLog: () => void
  onResetBindings: () => void
  /**
   * Binding fields whose MIDI source was just touched. Any row whose `field`
   * is in this set is highlighted so the user can see what the key or knob
   * they pressed is already bound to.
   */
  activeBindingFields: ReadonlySet<BindingField>
}

/**
 * One learnable binding row. Kept local to this panel so the visible columns
 * (label / current value / Learn button) stay consistent and the highlight
 * treatment for "this binding is being touched right now" lives in one place.
 */
function MappingRow({
  label,
  value,
  learnKey,
  field,
  learnMode,
  activeBindingFields,
  midiConnected,
  onToggle,
}: {
  label: React.ReactNode
  value: string
  learnKey: MidiLearnMode
  field: BindingField
  learnMode: MidiLearnMode | null
  activeBindingFields: ReadonlySet<BindingField>
  midiConnected: string | null
  onToggle: (k: MidiLearnMode) => void
}) {
  const active = activeBindingFields.has(field)
  const className =
    'midi-mapping-row' + (active ? ' midi-mapping-row--active' : '')
  return (
    <div className={className} data-active={active ? 'true' : undefined}>
      <span className="midi-mapping-label">{label}</span>
      <code className="midi-mapping-value">{value}</code>
      <button
        type="button"
        className="btn small"
        disabled={!midiConnected}
        onClick={() => onToggle(learnKey)}
      >
        {learnMode === learnKey ? 'Listening…' : 'Learn'}
      </button>
    </div>
  )
}

export function MidiMappingPanel({
  midiConnected,
  bindings,
  learnMode,
  onSetLearnMode,
  activityLog,
  onClearLog,
  onResetBindings,
  activeBindingFields,
}: Props) {
  const d = describeBinding(bindings)

  const toggle = (key: MidiLearnMode) => {
    onSetLearnMode(learnMode === key ? null : key)
  }

  /** Shared props so each row renders consistently. */
  const rowProps = {
    learnMode,
    activeBindingFields,
    midiConnected,
    onToggle: toggle,
  }

  return (
    <section className="midi-mapping-panel">
      <h3 className="midi-mapping-title">MIDI hardware</h3>
      <p className="muted midi-mapping-intro">
        Bindings are saved in this browser (
        <code className="midi-storage-key">localStorage</code>
        ). Watch the log while you press a button or turn a knob. Click Learn,
        then press and release the button — the app detects whether it is a
        toggle or momentary switch automatically. Rows flash while you touch a
        key or knob so you can see what is already bound. Unmapped devices
        still use MIDI Clock transport (Start / Continue / Stop) when Play /
        Stop are not learned. Record starts or clears a loop at the playhead;
        loop start maps linearly to the end marker; loop end uses a gentler
        curve so small moves near the song end are finer. Track focus maps a
        knob across note tracks only; the track toggle adds or removes the
        focused track from practice (one track always stays on).
      </p>
      {!midiConnected && (
        <p className="muted">No USB MIDI device detected.</p>
      )}
      <div className="midi-mapping-bindings">
        <MappingRow
          {...rowProps}
          label="Play / pause (toggle)"
          value={d.play}
          learnKey="play"
          field="play"
        />
        <MappingRow
          {...rowProps}
          label="Stop (pause only)"
          value={d.stop}
          learnKey="stop"
          field="stop"
        />
        <MappingRow
          {...rowProps}
          label="Jump to start"
          value={d.jumpToStart}
          learnKey="jumpToStart"
          field="jumpToStart"
        />
        <MappingRow
          {...rowProps}
          label="Cycle mode (listen / follow / wait)"
          value={d.cycleMode}
          learnKey="cycleMode"
          field="cycleMode"
        />
        <MappingRow
          {...rowProps}
          label="Cycle hand (both / right / left)"
          value={d.cycleHand}
          learnKey="cycleHand"
          field="cycleHand"
        />
        <MappingRow
          {...rowProps}
          label="Track focus (knob — which track toggle affects)"
          value={d.trackFocusKnob}
          learnKey="trackFocus"
          field="trackFocusKnob"
        />
        <MappingRow
          {...rowProps}
          label="Track toggle (add/remove focused track)"
          value={d.trackToggle}
          learnKey="trackToggle"
          field="trackToggle"
        />
        <MappingRow
          {...rowProps}
          label="Next song (playlist)"
          value={d.nextSong}
          learnKey="nextSong"
          field="nextSong"
        />
        <MappingRow
          {...rowProps}
          label="Previous song (playlist)"
          value={d.previousSong}
          learnKey="previousSong"
          field="previousSong"
        />
        <MappingRow
          {...rowProps}
          label="Record — loop at playhead / toggle off"
          value={d.loopAtPlayhead}
          learnKey="playhead"
          field="loopAtPlayhead"
        />
        <MappingRow
          {...rowProps}
          label="Loop start (left bar)"
          value={d.loopStartKnob}
          learnKey="loopA"
          field="loopStartKnob"
        />
        <MappingRow
          {...rowProps}
          label="Loop end (right bar)"
          value={d.loopEndKnob}
          learnKey="loopB"
          field="loopEndKnob"
        />
        <MappingRow
          {...rowProps}
          label="Loop shift (slide region)"
          value={d.loopShiftKnob}
          learnKey="loopShift"
          field="loopShiftKnob"
        />
        <MappingRow
          {...rowProps}
          label="Metronome start / stop (chord practice)"
          value={d.metronomeToggle}
          learnKey="metronomeToggle"
          field="metronomeToggle"
        />
        <MappingRow
          {...rowProps}
          label="Metronome BPM knob (10 – 300)"
          value={d.metronomeBpmKnob}
          learnKey="metronomeBpm"
          field="metronomeBpmKnob"
        />
        <MappingRow
          {...rowProps}
          label="Chord picker knob (Free Practice / lesson)"
          value={d.chordPickerKnob}
          learnKey="chordPicker"
          field="chordPickerKnob"
        />
      </div>
      <div className="midi-mapping-actions">
        <button type="button" className="btn" onClick={onClearLog}>
          Clear log
        </button>
        <button type="button" className="btn" onClick={onResetBindings}>
          Reset all bindings
        </button>
      </div>
      <pre className="midi-mapping-log" aria-live="polite">
        {activityLog.length === 0
          ? '…incoming MIDI appears here'
          : activityLog.join('\n')}
      </pre>
    </section>
  )
}
