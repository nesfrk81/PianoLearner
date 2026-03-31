import {
  describeBinding,
  type MidiHardwareBindings,
  type MidiLearnMode,
} from '../midi/midiHardwareBindings'

type Props = {
  midiConnected: string | null
  bindings: MidiHardwareBindings
  learnMode: MidiLearnMode | null
  onSetLearnMode: (m: MidiLearnMode | null) => void
  activityLog: string[]
  onClearLog: () => void
  onResetBindings: () => void
}

export function MidiMappingPanel({
  midiConnected,
  bindings,
  learnMode,
  onSetLearnMode,
  activityLog,
  onClearLog,
  onResetBindings,
}: Props) {
  const d = describeBinding(bindings)

  const toggle = (key: MidiLearnMode) => {
    onSetLearnMode(learnMode === key ? null : key)
  }

  return (
    <section className="midi-mapping-panel">
      <h3 className="midi-mapping-title">MIDI hardware</h3>
      <p className="muted midi-mapping-intro">
        Bindings are saved in this browser (
        <code className="midi-storage-key">localStorage</code>
        ). Watch the log while you press a button or turn a knob. Click Learn,
        then send that message again. Unmapped devices still use MIDI Clock
        transport (Start / Continue / Stop) when Play / Stop are not learned.
        Record starts or clears a loop at the playhead; loop start maps linearly
        to the end marker; loop end uses a gentler curve so small moves near the
        song end are finer. Track focus maps a knob across note tracks only;
        the track toggle adds or removes the focused track from practice (one
        track always stays on).
      </p>
      {!midiConnected && (
        <p className="muted">No USB MIDI device detected.</p>
      )}
      <div className="midi-mapping-bindings">
        <div className="midi-mapping-row">
          <span className="midi-mapping-label">Play / pause (toggle)</span>
          <code className="midi-mapping-value">{d.play}</code>
          <button
            type="button"
            className="btn small"
            disabled={!midiConnected}
            onClick={() => toggle('play')}
          >
            {learnMode === 'play' ? 'Listening…' : 'Learn'}
          </button>
        </div>
        <div className="midi-mapping-row">
          <span className="midi-mapping-label">Stop (pause only)</span>
          <code className="midi-mapping-value">{d.stop}</code>
          <button
            type="button"
            className="btn small"
            disabled={!midiConnected}
            onClick={() => toggle('stop')}
          >
            {learnMode === 'stop' ? 'Listening…' : 'Learn'}
          </button>
        </div>
        <div className="midi-mapping-row">
          <span className="midi-mapping-label">Jump to start</span>
          <code className="midi-mapping-value">{d.jumpToStart}</code>
          <button
            type="button"
            className="btn small"
            disabled={!midiConnected}
            onClick={() => toggle('jumpToStart')}
          >
            {learnMode === 'jumpToStart' ? 'Listening…' : 'Learn'}
          </button>
        </div>
        <div className="midi-mapping-row">
          <span className="midi-mapping-label">Cycle mode (listen / follow / wait)</span>
          <code className="midi-mapping-value">{d.cycleMode}</code>
          <button
            type="button"
            className="btn small"
            disabled={!midiConnected}
            onClick={() => toggle('cycleMode')}
          >
            {learnMode === 'cycleMode' ? 'Listening…' : 'Learn'}
          </button>
        </div>
        <div className="midi-mapping-row">
          <span className="midi-mapping-label">Cycle hand (both / right / left)</span>
          <code className="midi-mapping-value">{d.cycleHand}</code>
          <button
            type="button"
            className="btn small"
            disabled={!midiConnected}
            onClick={() => toggle('cycleHand')}
          >
            {learnMode === 'cycleHand' ? 'Listening…' : 'Learn'}
          </button>
        </div>
        <div className="midi-mapping-row">
          <span className="midi-mapping-label">
            Track focus (knob — which track toggle affects)
          </span>
          <code className="midi-mapping-value">{d.trackFocusKnob}</code>
          <button
            type="button"
            className="btn small"
            disabled={!midiConnected}
            onClick={() => toggle('trackFocus')}
          >
            {learnMode === 'trackFocus' ? 'Listening…' : 'Learn'}
          </button>
        </div>
        <div className="midi-mapping-row">
          <span className="midi-mapping-label">
            Track toggle (add/remove focused track)
          </span>
          <code className="midi-mapping-value">{d.trackToggle}</code>
          <button
            type="button"
            className="btn small"
            disabled={!midiConnected}
            onClick={() => toggle('trackToggle')}
          >
            {learnMode === 'trackToggle' ? 'Listening…' : 'Learn'}
          </button>
        </div>
        <div className="midi-mapping-row">
          <span className="midi-mapping-label">Next song (playlist)</span>
          <code className="midi-mapping-value">{d.nextSong}</code>
          <button
            type="button"
            className="btn small"
            disabled={!midiConnected}
            onClick={() => toggle('nextSong')}
          >
            {learnMode === 'nextSong' ? 'Listening…' : 'Learn'}
          </button>
        </div>
        <div className="midi-mapping-row">
          <span className="midi-mapping-label">Previous song (playlist)</span>
          <code className="midi-mapping-value">{d.previousSong}</code>
          <button
            type="button"
            className="btn small"
            disabled={!midiConnected}
            onClick={() => toggle('previousSong')}
          >
            {learnMode === 'previousSong' ? 'Listening…' : 'Learn'}
          </button>
        </div>
        <div className="midi-mapping-row">
          <span className="midi-mapping-label">
            Record — loop at playhead / toggle off
          </span>
          <code className="midi-mapping-value">{d.loopAtPlayhead}</code>
          <button
            type="button"
            className="btn small"
            disabled={!midiConnected}
            onClick={() => toggle('playhead')}
          >
            {learnMode === 'playhead' ? 'Listening…' : 'Learn'}
          </button>
        </div>
        <div className="midi-mapping-row">
          <span className="midi-mapping-label">Loop start (left bar)</span>
          <code className="midi-mapping-value">{d.loopStartKnob}</code>
          <button
            type="button"
            className="btn small"
            disabled={!midiConnected}
            onClick={() => toggle('loopA')}
          >
            {learnMode === 'loopA' ? 'Listening…' : 'Learn'}
          </button>
        </div>
        <div className="midi-mapping-row">
          <span className="midi-mapping-label">Loop end (right bar)</span>
          <code className="midi-mapping-value">{d.loopEndKnob}</code>
          <button
            type="button"
            className="btn small"
            disabled={!midiConnected}
            onClick={() => toggle('loopB')}
          >
            {learnMode === 'loopB' ? 'Listening…' : 'Learn'}
          </button>
        </div>
        <div className="midi-mapping-row">
          <span className="midi-mapping-label">Loop shift (slide region)</span>
          <code className="midi-mapping-value">{d.loopShiftKnob}</code>
          <button
            type="button"
            className="btn small"
            disabled={!midiConnected}
            onClick={() => toggle('loopShift')}
          >
            {learnMode === 'loopShift' ? 'Listening…' : 'Learn'}
          </button>
        </div>
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
