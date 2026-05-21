import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ParsedMidiTrackInfo } from '../types'

export type TrackMultiselectDropdownProps = {
  tracks: ParsedMidiTrackInfo[]
  selectedTrackIndices: number[]
  setSelectedTrackIndices: (
    next: number[] | ((prev: number[]) => number[]),
  ) => void
  label?: string
  summarySuffix?: string
  onlyTracksWithNotes?: boolean
  focusTrackIndex?: number | null
  focusBadgeLabel?: string
  openOnBump?: number
  closeWhenPlaying?: boolean
  playing?: boolean
}

export function TrackMultiselectDropdown({
  tracks,
  selectedTrackIndices,
  setSelectedTrackIndices,
  label = 'Tracks',
  summarySuffix = 'selected',
  onlyTracksWithNotes = true,
  focusTrackIndex = null,
  focusBadgeLabel = 'MIDI',
  openOnBump = 0,
  closeWhenPlaying = false,
  playing = false,
}: TrackMultiselectDropdownProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const focusRowRef = useRef<HTMLLabelElement | null>(null)
  const labelId = useId()

  const visibleTracks = useMemo(
    () =>
      onlyTracksWithNotes
        ? tracks.filter((t) => t.noteCount > 0)
        : tracks,
    [onlyTracksWithNotes, tracks],
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
    if (openOnBump <= 0) return
    const id = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(id)
  }, [openOnBump])

  useEffect(() => {
    if (!closeWhenPlaying || !playing) return
    const id = requestAnimationFrame(() => setOpen(false))
    return () => cancelAnimationFrame(id)
  }, [closeWhenPlaying, playing])

  useEffect(() => {
    if (!open || focusTrackIndex == null) return
    const id = requestAnimationFrame(() => {
      focusRowRef.current?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(id)
  }, [open, focusTrackIndex, openOnBump])

  const selectedCount = selectedTrackIndices.length
  const focusTrack =
    focusTrackIndex != null
      ? visibleTracks.find((t) => t.index === focusTrackIndex)
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

  if (visibleTracks.length === 0) {
    return (
      <div className="track-dropdown track-dropdown--empty">
        <span className="practice-bar-tracks-label" id={labelId}>
          {label}
        </span>
        <span className="track-dropdown-empty" aria-labelledby={labelId}>
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
      <span className="practice-bar-tracks-label" id={labelId}>
        {label}
      </span>
      <button
        type="button"
        className="track-dropdown-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={labelId}
        title={
          focusTrack
            ? `${selectedCount} track${selectedCount === 1 ? '' : 's'} ${summarySuffix}; ${focusBadgeLabel} targets “${focusTrack.name}”.`
            : `${selectedCount} track${selectedCount === 1 ? '' : 's'} ${summarySuffix}.`
        }
        onClick={() => setOpen((o) => !o)}
      >
        <span className="track-dropdown-trigger-text">
          <span className="track-dropdown-summary-row">
            <span className="track-dropdown-summary-selected">
              {selectedCount} {summarySuffix}
            </span>
            {focusTrack ? (
              <>
                <span className="track-dropdown-summary-sep" aria-hidden>
                  {' '}
                  ·{' '}
                </span>
                <span
                  className="track-dropdown-summary-focus"
                  title={`${focusBadgeLabel} knob / toggle target`}
                >
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
          {visibleTracks.map((t) => {
            const checked = selectedTrackIndices.includes(t.index)
            const isFocus = focusTrackIndex === t.index
            return (
              <label
                key={t.index}
                ref={isFocus ? focusRowRef : undefined}
                className={
                  'track-dropdown-row' +
                  (checked ? ' track-dropdown-row--selected' : '') +
                  (isFocus ? ' track-dropdown-row--midi-focus' : '')
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
                    {isFocus ? (
                      <span className="track-dropdown-row-badge">
                        {focusBadgeLabel}
                      </span>
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
