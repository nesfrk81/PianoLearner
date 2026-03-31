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
import type { ParsedMidiTrackInfo } from './types'
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

function PlaylistIcon() {
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
      <path d="M8 6h13M8 12h13M8 18h13M5 6h.01M5 12h.01M5 18h.01" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

const I = { w: 18, h: 18, vb: '0 0 24 24' } as const
function Ico({ d, ...rest }: { d: string } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={I.w} height={I.h} viewBox={I.vb}
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden {...rest}>
      <path d={d} />
    </svg>
  )
}

function IconHeadphones() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={I.w} height={I.h} viewBox={I.vb}
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden>
      <path d="M3 18v-6a9 9 0 0118 0v6" />
      <path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3v5zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3v5z" />
    </svg>
  )
}

function IconFollow() {
  return <Ico d="M9 18V5l12-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z" />
}

function IconWait() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={I.w} height={I.h} viewBox={I.vb}
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

function IconBothHands() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={I.w} height={I.h} viewBox={I.vb}
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden>
      <path d="M18 11V6a2 2 0 10-4 0v4M14 10V4a2 2 0 10-4 0v6M10 10V6a2 2 0 10-4 0v8l-1.46-1.46a2 2 0 00-2.83 2.83L6 20h12l1.46-4.39A2 2 0 0018 14v-3z" />
    </svg>
  )
}

function IconLeftHand() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={I.w} height={I.h} viewBox={I.vb}
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden>
      <path d="M18 11V6a2 2 0 10-4 0v4M14 10V4a2 2 0 10-4 0v6M10 10V6a2 2 0 10-4 0v8l-1.46-1.46a2 2 0 00-2.83 2.83L6 20h12l1.46-4.39A2 2 0 0018 14v-3z" />
      <line x1="2" y1="2" x2="12" y2="2" strokeWidth="3" />
    </svg>
  )
}

function IconRightHand() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={I.w} height={I.h} viewBox={I.vb}
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden>
      <path d="M18 11V6a2 2 0 10-4 0v4M14 10V4a2 2 0 10-4 0v6M10 10V6a2 2 0 10-4 0v8l-1.46-1.46a2 2 0 00-2.83 2.83L6 20h12l1.46-4.39A2 2 0 0018 14v-3z" />
      <line x1="12" y1="2" x2="22" y2="2" strokeWidth="3" />
    </svg>
  )
}

type SegBtnItem<T extends string> = { value: T; label: string; icon: React.ReactNode }

function SegmentedBar<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: SegBtnItem<T>[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}) {
  return (
    <div className="seg-bar" role="radiogroup" aria-label={ariaLabel}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          role="radio"
          aria-checked={value === it.value}
          className={'seg-btn' + (value === it.value ? ' seg-btn--on' : '')}
          onClick={() => onChange(it.value)}
          title={it.label}
        >
          {it.icon}
          <span className="seg-label">{it.label}</span>
        </button>
      ))}
    </div>
  )
}

function PracticeTracksDropdown({
  tracks,
  selectedTrackIndices,
  setSelectedTrackIndices,
  midiTrackFocusIndex,
  midiTrackDropdownBump,
  playing,
}: {
  tracks: ParsedMidiTrackInfo[]
  selectedTrackIndices: number[]
  setSelectedTrackIndices: (
    next: number[] | ((prev: number[]) => number[]),
  ) => void
  midiTrackFocusIndex: number | null
  midiTrackDropdownBump: number
  playing: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const midiFocusRowRef = useRef<HTMLLabelElement | null>(null)

  const selectableTracks = useMemo(
    () => tracks.filter((t) => t.noteCount > 0),
    [tracks],
  )

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (midiTrackDropdownBump > 0) setOpen(true)
  }, [midiTrackDropdownBump])

  useEffect(() => {
    if (playing) setOpen(false)
  }, [playing])

  useEffect(() => {
    if (!open || midiTrackFocusIndex == null) return
    const id = requestAnimationFrame(() => {
      midiFocusRowRef.current?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(id)
  }, [open, midiTrackFocusIndex, midiTrackDropdownBump])

  const selectedCount = selectedTrackIndices.length
  const focusTrack =
    midiTrackFocusIndex != null
      ? selectableTracks.find((t) => t.index === midiTrackFocusIndex)
      : undefined

  const toggleTrack = (index: number) => {
    setSelectedTrackIndices((prev) => {
      const set = new Set(prev)
      if (set.has(index)) {
        if (set.size <= 1) return prev
        set.delete(index)
      } else {
        set.add(index)
      }
      return Array.from(set).sort((a, b) => a - b)
    })
  }

  if (selectableTracks.length === 0) {
    return (
      <div className="track-dropdown track-dropdown--empty">
        <span className="practice-bar-tracks-label" id="practice-tracks-label">
          Tracks
        </span>
        <span
          className="track-dropdown-empty"
          aria-labelledby="practice-tracks-label"
        >
          No tracks with notes
        </span>
      </div>
    )
  }

  return (
    <div
      className={'track-dropdown' + (open ? ' track-dropdown--open' : '')}
      ref={wrapRef}
    >
      <span className="practice-bar-tracks-label" id="practice-tracks-label">
        Tracks
      </span>
      <button
        type="button"
        className="track-dropdown-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby="practice-tracks-label"
        title={
          focusTrack
            ? `${selectedCount} track${selectedCount === 1 ? '' : 's'} in practice; MIDI knob targets “${focusTrack.name}”.`
            : `${selectedCount} track${selectedCount === 1 ? '' : 's'} in practice.`
        }
        onClick={() => setOpen((o) => !o)}
      >
        <span className="track-dropdown-trigger-text">
          <span className="track-dropdown-summary-row">
            <span className="track-dropdown-summary-selected">
              {selectedCount} in practice
            </span>
            {focusTrack ? (
              <>
                <span className="track-dropdown-summary-sep" aria-hidden>
                  {' '}
                  ·{' '}
                </span>
                <span className="track-dropdown-summary-focus" title="MIDI knob / toggle target">
                  {focusTrack.name}
                </span>
              </>
            ) : null}
          </span>
        </span>
        <span className="track-dropdown-chevron" aria-hidden>
          ▼
        </span>
      </button>
      {open ? (
        <div
          className="track-dropdown-panel"
          role="listbox"
          aria-multiselectable
        >
          {selectableTracks.map((t) => {
            const checked = selectedTrackIndices.includes(t.index)
            const isMidiFocus = midiTrackFocusIndex === t.index
            return (
              <label
                key={t.index}
                ref={isMidiFocus ? midiFocusRowRef : undefined}
                className={
                  'track-dropdown-row' +
                  (checked ? ' track-dropdown-row--selected' : '') +
                  (isMidiFocus ? ' track-dropdown-row--midi-focus' : '')
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleTrack(t.index)}
                />
                <span className="track-dropdown-row-label">
                  <span className="track-dropdown-row-name">{t.name}</span>
                  <span className="track-dropdown-row-meta">
                    {t.noteCount} notes
                    {isMidiFocus ? (
                      <span className="track-dropdown-row-badge">MIDI</span>
                    ) : null}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export default function App() {
  const [latencyMs, setLatencyMs] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const playlistPopoverRef = useRef<HTMLDivElement>(null)
  const midiAddInputRef = useRef<HTMLInputElement>(null)
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
    selectedTrackIndices,
    setSelectedTrackIndices,
    midiTrackFocusIndex,
    midiTrackDropdownBump,
    mode,
    setMode,
    playing,
    togglePlay,
    songTime,
    seek,
    jumpToStart,
    handFilter,
    setHandFilter,
    splitMidi,
    setSplitMidi,
    octaveShift,
    setOctaveShift,
    midiVelocitySensitivity,
    setMidiVelocitySensitivity,
    addMidiFiles,
    playlist,
    currentPlaylistId,
    playlistHydrated,
    selectPlaylistSong,
    removePlaylistSong,
    nextPlaylistSong,
    previousPlaylistSong,
    fingeringMap,
    userPressedMidi,
    waitExpectedMidi,
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
      waitExpectedMidi ?? expectedMidiNow(playbackNotes, songTime - latencyMs / 1000),
    [waitExpectedMidi, playbackNotes, songTime, latencyMs],
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
      if (playlistOpen) {
        e.preventDefault()
        setPlaylistOpen(false)
        return
      }
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
  }, [midi, clearLoop, settingsOpen, playlistOpen])

  useEffect(() => {
    if (!playlistOpen) return
    const onDown = (ev: MouseEvent) => {
      const el = playlistPopoverRef.current
      if (el && !el.contains(ev.target as Node)) setPlaylistOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [playlistOpen])

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
          <div className="app-header-actions">
            <div className="playlist-anchor" ref={playlistPopoverRef}>
              <input
                ref={midiAddInputRef}
                type="file"
                className="playlist-file-input-hidden"
                accept=".mid,.midi,audio/midi"
                multiple
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  const files = e.target.files
                  if (files?.length) void addMidiFiles(files)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                className={
                  'btn-icon playlist-toggle' +
                  (playlistOpen ? ' playlist-toggle--open' : '')
                }
                onClick={() => setPlaylistOpen((o) => !o)}
                title="Playlist — add songs with + inside"
                aria-expanded={playlistOpen}
                aria-haspopup="dialog"
                aria-label="Playlist"
              >
                <PlaylistIcon />
                {playlistHydrated && playlist.length > 0 ? (
                  <span className="playlist-toggle-badge" aria-hidden>
                    {playlist.length}
                  </span>
                ) : null}
              </button>
              {playlistOpen && playlistHydrated && (
                <div
                  className="playlist-popover"
                  role="dialog"
                  aria-label="MIDI playlist"
                >
                  <div className="playlist-popover-head">
                    <span className="playlist-title">Playlist</span>
                    <div className="playlist-popover-actions">
                      {playlist.length > 0 ? (
                        <div className="playlist-step">
                          <button
                            type="button"
                            className="btn small"
                            onClick={() => void previousPlaylistSong()}
                            title="Previous song (wraps)"
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            className="btn small"
                            onClick={() => void nextPlaylistSong()}
                            title="Next song (wraps)"
                          >
                            Next
                          </button>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="btn-icon playlist-add-btn"
                        onClick={() => midiAddInputRef.current?.click()}
                        title="Add MIDI files (multi-select)"
                        aria-label="Add MIDI files to playlist"
                      >
                        <PlusIcon />
                      </button>
                    </div>
                  </div>
                  <p className="playlist-add-desc">
                    Tap <strong className="playlist-plus-mark">+</strong> to
                    choose one or more .mid / .midi files. They are saved here and
                    listed below; the last file in each batch becomes the current
                    song.
                  </p>
                  {playlist.length > 0 ? (
                    <ul className="playlist-list">
                      {playlist.map((p) => (
                        <li
                          key={p.id}
                          className={
                            'playlist-item' +
                            (p.id === currentPlaylistId
                              ? ' playlist-item--current'
                              : '')
                          }
                        >
                          <button
                            type="button"
                            className="playlist-select"
                            onClick={() => {
                              void selectPlaylistSong(p.id)
                              setPlaylistOpen(false)
                            }}
                            title="Load this song"
                          >
                            {p.name}
                          </button>
                          <button
                            type="button"
                            className="btn small playlist-remove"
                            onClick={() => void removePlaylistSong(p.id)}
                            title="Remove from playlist"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="playlist-popover-empty muted">
                      No songs yet. Tap + above to add files.
                    </p>
                  )}
                  <p className="muted playlist-hint">
                    Stored in this browser (IndexedDB). Same device only.
                  </p>
                </div>
              )}
            </div>
            <button
              type="button"
              className="btn-icon app-settings-cog"
              onClick={() => {
                setPlaylistOpen(false)
                setSettingsOpen(true)
              }}
              title="Settings"
              aria-label="Open settings"
            >
              <CogIcon />
            </button>
          </div>
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

      {!playlistHydrated ? (
        <section className="panel panel-midi-files">
          <span className="muted">Loading cached songs…</span>
        </section>
      ) : playlist.length === 0 ? (
        <section className="start-playlist-hero" aria-labelledby="start-playlist-heading">
          <h2 id="start-playlist-heading" className="start-playlist-title">
            Create midi playlist
          </h2>
          <p className="start-playlist-body">
            Open the <strong>playlist</strong> using the list icon in the top
            corner (left of settings). Tap the <strong>+</strong> button there to
            add MIDI files — you can pick several at once. Songs stay in this
            browser only.
          </p>
        </section>
      ) : (
        <section className="panel panel-midi-files panel-now-playing">
          <span className="now-playing-label">Now playing</span>
          <span className="file-name">{fileName || '—'}</span>
        </section>
      )}

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
              Open a MIDI file to configure hand split, latency, and MIDI
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

          <div className="practice-bars">
            <SegmentedBar
              ariaLabel="Practice mode"
              value={mode}
              onChange={setMode}
              items={[
                { value: 'listen' as const, label: 'Listen', icon: <IconHeadphones /> },
                { value: 'follow' as const, label: 'Follow', icon: <IconFollow /> },
                { value: 'wait' as const, label: 'Wait', icon: <IconWait /> },
              ]}
            />
            <SegmentedBar
              ariaLabel="Practice hand"
              value={handFilter}
              onChange={setHandFilter}
              items={[
                { value: 'left' as const, label: 'L', icon: <IconLeftHand /> },
                { value: 'both' as const, label: 'Both', icon: <IconBothHands /> },
                { value: 'right' as const, label: 'R', icon: <IconRightHand /> },
              ]}
            />
            <PracticeTracksDropdown
              tracks={tracks}
              selectedTrackIndices={selectedTrackIndices}
              setSelectedTrackIndices={setSelectedTrackIndices}
              midiTrackFocusIndex={midiTrackFocusIndex}
              midiTrackDropdownBump={midiTrackDropdownBump}
              playing={playing}
            />
          </div>

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
              Orange = expected notes. Purple = your key press. Green = correct
              hit. Click the staff to set a loop (drag the blue bars), Done or
              Esc to close. Orange blocks fall to the red line — play as
              they arrive. Click the waterfall to seek.
            </p>
          </section>
        </>
      )}
    </div>
  )
}
