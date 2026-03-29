import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { usePianoLearner } from './hooks/usePianoLearner'
import { MidiMappingPanel } from './ui/MidiMappingPanel'
import { SettingsModal } from './ui/SettingsModal'
import { MusicTimeline } from './ui/MusicTimeline'
import './App.css'

function expectedMidiNow(
  notes: { time: number; duration: number; midi: number }[],
  t: number,
): Set<number> {
  const s = new Set<number>()
  for (const n of notes) {
    if (t >= n.time - 0.05 && t <= n.time + n.duration) s.add(n.midi)
  }
  return s
}

const LOOP_OVERLAY_HALF_SEC = 0.5

/** When the score spans more chromatic keys than this, waterfall + keybed use a centered window (61 = common keyboard width). */
const KEYBED_CHROMATIC_KEYS = 61

function narrowKeybedToKeyCount(
  pr: { min: number; max: number },
  keyCount: number,
): { min: number; max: number } {
  const span = pr.max - pr.min
  const maxSpan = keyCount - 1
  if (span <= maxSpan) return pr
  const mid = (pr.min + pr.max) / 2
  let min = Math.round(mid - maxSpan / 2)
  let max = min + maxSpan
  if (min < 21) {
    min = 21
    max = min + maxSpan
  }
  if (max > 108) {
    max = 108
    min = max - maxSpan
  }
  return { min, max }
}

function CogIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
}

export default function App() {
  const [latencyMs, setLatencyMs] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loopSheetOverlay, setLoopSheetOverlay] = useState(false)
  const closeLoopSheetOverlay = useCallback(() => setLoopSheetOverlay(false), [])
  const loopAtPlayheadFnRef = useRef<() => void>(() => {})
  const keyboardTransportBlockedRef = useRef(false)
  keyboardTransportBlockedRef.current = settingsOpen
  const pl = usePianoLearner({
    onLoopCleared: closeLoopSheetOverlay,
    onLoopAtPlayhead: () => loopAtPlayheadFnRef.current(),
    keyboardTransportBlockedRef,
  })

  const {
    ensureAudio,
    audioReady,
    sfLoadDone,
    sfLoadTotal,
    midi,
    fileName,
    tracks,
    selectedTrackIndex,
    setSelectedTrackIndex,
    soloTrack,
    setSoloTrack,
    mode,
    setMode,
    playing,
    togglePlay,
    songTime,
    seek,
    jumpToStart,
    splitMidi,
    setSplitMidi,
    octaveShift,
    setOctaveShift,
    midiVelocitySensitivity,
    setMidiVelocitySensitivity,
    loadMidiFile,
    fingeringMap,
    userPressedMidi,
    midiConnected,
    playbackNotes,
    loopEnabled,
    setLoopEnabled,
    loopA,
    setLoopA,
    loopB,
    setLoopB,
    clearLoop,
    midiHardwareBindings,
    midiLearnMode,
    setMidiLearnMode,
    midiActivityLog,
    clearMidiActivityLog,
    resetMidiHardwareBindings,
  } = pl

  const pitchRange = useMemo(() => {
    if (playbackNotes.length === 0) return { min: 48, max: 84 }
    let min = 127
    let max = 0
    for (const n of playbackNotes) {
      min = Math.min(min, n.midi)
      max = Math.max(max, n.midi)
    }
    return { min: Math.max(21, min - 3), max: Math.min(108, max + 3) }
  }, [playbackNotes])

  /** Waterfall + keybed share columns — cap to 61 chromatic keys when the piece is very wide */
  const keybedRange = useMemo(
    () => narrowKeybedToKeyCount(pitchRange, KEYBED_CHROMATIC_KEYS),
    [pitchRange],
  )

  const expectedMidi = useMemo(
    () =>
      expectedMidiNow(playbackNotes, songTime - latencyMs / 1000),
    [playbackNotes, songTime, latencyMs],
  )

  const duration = midi?.duration ?? 0

  const initLoopFromSheet = useCallback(
    (centerSec: number) => {
      const d = duration
      if (d <= 0) return
      let a = Math.max(0, centerSec - LOOP_OVERLAY_HALF_SEC)
      let b = Math.min(d, centerSec + LOOP_OVERLAY_HALF_SEC)
      if (b - a < 0.05) {
        b = Math.min(d, a + 0.05)
        if (b - a < 0.05) a = Math.max(0, b - 0.05)
      }
      setLoopA(a)
      setLoopB(b)
      setLoopEnabled(true)
      setLoopSheetOverlay(true)
    },
    [duration, setLoopA, setLoopB, setLoopEnabled],
  )

  useLayoutEffect(() => {
    loopAtPlayheadFnRef.current = () => initLoopFromSheet(songTime)
  }, [initLoopFromSheet, songTime])

  const onLoopBoundsChange = useCallback(
    (a: number, b: number) => {
      setLoopA(a)
      setLoopB(b)
    },
    [setLoopA, setLoopB],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return
      if (settingsOpen) {
        e.preventDefault()
        setSettingsOpen(false)
        return
      }
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return
      }
      if (!midi) return
      e.preventDefault()
      clearLoop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [midi, clearLoop, settingsOpen])

  return (
    <div className="app">
      <header className="app-header app-header-bar">
        <div className="app-header-main">
          <h1>Piano Learner</h1>
          <p className="app-sub">
            Sheet music on top, falling notes in the middle (hit the red line),
            keys below — same columns. Space: play/pause. Arrows: ±0.5s. USB MIDI
            + QWERTY. Home: jump to start.
          </p>
        </div>
        {audioReady && (
          <button
            type="button"
            className="btn-icon app-settings-cog"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Open settings"
          >
            <CogIcon />
          </button>
        )}
      </header>

      {!audioReady && (
        <div className="audio-gate">
          <button
            type="button"
            className="btn primary"
            onClick={() => void ensureAudio()}
          >
            Tap to enable audio
          </button>
          <p className="hint">Browsers require a click before sound works.</p>
        </div>
      )}

      {audioReady && sfLoadTotal > 0 && sfLoadDone < sfLoadTotal && (
        <p className="load-bar">
          Loading piano soundfont… {Math.round((sfLoadDone / sfLoadTotal) * 100)}%
        </p>
      )}

      <section className="panel">
        <label className="file-label">
          <span>Open MIDI file</span>
          <input
            type="file"
            accept=".mid,.midi,audio/midi"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void loadMidiFile(f)
            }}
          />
        </label>
        {fileName ? (
          <span className="file-name">{fileName}</span>
        ) : (
          <span className="muted">No file loaded</span>
        )}
      </section>

      {audioReady && (
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          title="Settings"
        >
          <section className="panel grid settings-modal-section">
            <label>
              Input latency (ms)
              <input
                type="number"
                min={-200}
                max={200}
                value={latencyMs}
                onChange={(e) => setLatencyMs(Number(e.target.value))}
              />
            </label>
            <label>
              QWERTY octave shift
              <input
                type="number"
                min={-3}
                max={3}
                value={octaveShift}
                onChange={(e) => setOctaveShift(Number(e.target.value))}
              />
            </label>
            <label className="midi-touch-sensitivity">
              MIDI touch sensitivity
              <div className="midi-touch-sensitivity-row">
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={midiVelocitySensitivity}
                  onChange={(e) =>
                    setMidiVelocitySensitivity(Number(e.target.value))
                  }
                />
                <span className="midi-touch-value">
                  {midiVelocitySensitivity.toFixed(2)}×
                </span>
              </div>
              <span className="muted midi-touch-hint">
                USB MIDI only — higher = louder at the same key press
              </span>
            </label>
          </section>

          {midi ? (
            <>
              <section className="panel grid settings-modal-section">
                <label>
                  Practice track
                  <select
                    value={selectedTrackIndex}
                    onChange={(e) =>
                      setSelectedTrackIndex(Number(e.target.value))
                    }
                  >
                    {tracks.map((t) => (
                      <option key={t.index} value={t.index}>
                        {t.name} ({t.noteCount} notes)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={soloTrack}
                    onChange={(e) => setSoloTrack(e.target.checked)}
                  />
                  Solo this track
                </label>
                <label>
                  Mode
                  <select
                    value={mode}
                    onChange={(e) =>
                      setMode(e.target.value as 'listen' | 'follow' | 'wait')
                    }
                  >
                    <option value="listen">Listen</option>
                    <option value="follow">Follow</option>
                    <option value="wait">Wait for notes</option>
                  </select>
                </label>
                <label>
                  Hand split (sheet + fingering)
                  <input
                    type="number"
                    min={21}
                    max={108}
                    value={splitMidi}
                    onChange={(e) => setSplitMidi(Number(e.target.value))}
                  />
                </label>
              </section>

              <MidiMappingPanel
                midiConnected={midiConnected}
                bindings={midiHardwareBindings}
                learnMode={midiLearnMode}
                onSetLearnMode={setMidiLearnMode}
                activityLog={midiActivityLog}
                onClearLog={clearMidiActivityLog}
                onResetBindings={resetMidiHardwareBindings}
              />
            </>
          ) : (
            <p className="muted settings-modal-hint">
              Open a MIDI file to configure practice track, mode, and MIDI
              hardware mapping.
            </p>
          )}
        </SettingsModal>
      )}

      {midi && (
        <>
          <section className="panel transport">
            <button
              type="button"
              className="btn"
              onClick={() => jumpToStart()}
              title="Jump to start (Home)"
            >
              Jump to start
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void togglePlay()}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <span className="time-readout" aria-live="polite">
              {songTime.toFixed(1)}s / {duration.toFixed(1)}s
            </span>
            <span className="muted">
              {midiConnected ? `MIDI: ${midiConnected}` : 'No MIDI device'}
            </span>
            {loopEnabled && (
              <button
                type="button"
                className="btn"
                onClick={clearLoop}
                title="Stop looping the current section"
              >
                Clear loop
              </button>
            )}
          </section>

          <section className="sheet-section">
            <MusicTimeline
              notes={playbackNotes}
              duration={duration}
              songTime={songTime}
              minPitch={keybedRange.min}
              maxPitch={keybedRange.max}
              splitMidi={splitMidi}
              loopEnabled={loopEnabled}
              loopA={loopA}
              loopB={loopB}
              userMidi={userPressedMidi}
              expectedMidi={expectedMidi}
              fingeringMap={fingeringMap}
              activeAdjustedTime={songTime - latencyMs / 1000}
              onSeek={seek}
              onInitLoopRegion={initLoopFromSheet}
              onLoopBoundsChange={onLoopBoundsChange}
              loopSheetOverlay={loopSheetOverlay}
              onCloseLoopSheetOverlay={closeLoopSheetOverlay}
            />
            <p className="hint timeline-hint">
              Orange on the staff = playing now. Click the staff to choose a 1s
              loop (drag the blue bars), Done or Esc to close. Orange blocks fall
              to the red line — play as they arrive. Click the waterfall to seek.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
