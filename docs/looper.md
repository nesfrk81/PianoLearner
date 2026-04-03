# Looper — note-centric model

This document describes the **A/B loop** feature after the note-centric rework: center point, note-snapped boundaries, and MIDI knob behavior.

---

## 1. Overview

The looper repeats playback between two song-time boundaries **`loopA`** and **`loopB`** (seconds). A **center point** (`loopCenter`) anchors all adjustments: the start knob selects note onsets in `[0, center]`, the end knob selects note ends in `[center, duration]`, and the move knob slides the loop to a new onset while preserving its width.

Responsibility is split across:

- **`usePianoLearner`** — React state (`loopA`, `loopB`, `loopCenter`, `loopEnabled`), note-onset/end lists, MIDI knob handling, syncing to the engine.
- **`PlaybackController`** — `loop` property and wrap-around during `tick()`.
- **`App.tsx`** — `initLoopFromSheet` (staff click → calls hook's `initLoopAtCenter` + opens overlay).
- **`StaffCanvas`** — click-to-create region, draggable handles, "Done" on the sheet overlay.

---

## 2. State ownership

| Concern | Where | Notes |
|--------|--------|--------|
| Loop on/off and bounds | `usePianoLearner.ts` | `loopEnabled`, `loopA`, `loopB` (seconds). |
| Center point | same | `loopCenter` (seconds, or `null` if no loop). Set when a loop is first created; updated when the move knob slides the loop. |
| Note onset / end lists | same | `noteOnsets` and `noteEnds` — deduplicated, sorted arrays derived from `playbackNotes` via `uniqueOnsets()` / `uniqueEnds()` from `loopSnap.ts`. |
| Refs for MIDI handlers | same | `loopARef`, `loopBRef`, `loopEnabledRef`, `loopCenterRef`, `noteOnsetsRef`, `noteEndsRef` kept in sync via `useLayoutEffect`. |
| Soft-takeover for knobs | same | `knobPickedUp.loopStart`, `.loopEnd`, `.loopShift`, `.trackFocus` — until the physical CC crosses the current mapped value (within `PICKUP_THRESH = 3`), knob moves are ignored. |
| Engine loop | `PlaybackController` | `loop: { a: number; b: number } | null`. |
| Sync hook → engine | `usePianoLearner.ts` | `useEffect`: if `loopEnabled && loopB > loopA + 0.05`, set `ctl.loop = { a, b }`; else `null`. |
| Sheet overlay open | `App.tsx` | `loopSheetOverlay` boolean; "Done" / `onLoopCleared` close it. |

---

## 3. How a loop is created

### Staff click

- **`StaffCanvas`** `onClick` → `onInitLoopRegion(sec)`.
- **`App.tsx`** `initLoopFromSheet(centerSec)` calls **`initLoopAtCenter(centerSec)`** (from the hook) and opens `loopSheetOverlay`.
- **`initLoopAtCenter`** sets `loopCenter = centerSec`, then snaps: `loopA = onsetAtOrBefore(noteOnsets, center)`, `loopB = endAtOrAfter(noteEnds, center)`, ensuring `loopB > loopA + 0.05`.

### MIDI "Record — loop at playhead" (`loopAtPlayhead`)

- Binding: `loopAtPlayhead` in `midiHardwareBindings`.
- In `usePianoLearner` MIDI `onMsg`: if loop is active → **`clearLoop()`**; otherwise → **`initLoopAtCenterRef.current(songTimeRef.current)`** + **`onLoopAtPlayheadRef.current?.()`** (which sets `loopSheetOverlay = true` in App).

### MIDI loop knobs

- **Loop start / end / move** knobs only function when `loopCenter` is set (a loop has been initialized).

---

## 4. How bounds are adjusted

### Sheet overlay (`StaffCanvas`)

- Drag handle **A** or **B**: pointer move maps X → song time; enforces `MIN_LOOP_SEC = 0.05` between A and B, clamped to `[0, duration]`.

### Loop start knob (CC)

- Filters `noteOnsets` to entries `<= loopCenter`.
- CC 0–127 maps to an index in this list (`ccToTimeIndex`): CC 0 = earliest onset, CC 127 = onset nearest to center.
- Sets `loopA` to the selected onset, as long as `loopA < loopB - 0.04`.

### Loop end knob (CC)

- Filters `noteEnds` to entries `>= loopCenter`.
- CC 0–127 maps to an index: CC 0 = end nearest to center, CC 127 = latest end.
- Sets `loopB` to the selected end, as long as `loopB > loopA + 0.04`.

### Loop move knob (CC)

- Maps CC 0–127 across the full `noteOnsets` array.
- Places `loopA` at the selected onset and `loopB = loopA + (previous region width)`, preserving loop duration.
- Updates `loopCenter` to the midpoint of the new region.
- Simultaneous onsets (chords) share a single entry, so one knob step covers the entire chord.

---

## 5. Playback engine behavior

In **`PlaybackController.tick()`** (when `playing` and MIDI loaded):

1. If `loop` is set and `songTime >= loop.b - 0.002`, call `seek(loop.a)` — playhead jumps back to A.
2. `seek` clears scheduled note IDs and realigns wait-mode cursor.

Wrapping applies whenever `ctl.loop` is non-null, regardless of practice mode.

---

## 6. How a loop is cleared

| Trigger | Behavior |
|---------|----------|
| **Clear loop** button (transport) | `clearLoop()` → `loopEnabled = false`, `loopCenter = null`, reset knob pickup flags, `onLoopCleared?.()` (closes sheet overlay). |
| **Esc** (when not in settings/playlist focus, MIDI loaded) | `clearLoop()`. |
| **MIDI Record** while loop active | `clearLoop()` (see §3). |
| **Load new MIDI** (`applyMidiFromBuffer`) | `loopEnabled = false`, `ctl.loop = null`, `loopA = 0`, `loopB = min(8, duration)`, pickup reset. |
| **Remove current playlist song** (empty playlist path) | Similar reset. |

---

## 7. Note-snap helpers (`src/engine/loopSnap.ts`)

| Function | Purpose |
|----------|---------|
| `uniqueOnsets(notes)` | Deduplicated, ascending onset times from `NoteView[]`. |
| `uniqueEnds(notes)` | Deduplicated, ascending note-end times. |
| `onsetAtOrBefore(onsets, t)` | Nearest onset `<= t`, or the first onset. |
| `endAtOrAfter(ends, t)` | Nearest end `>= t`, or the last end. |
| `nextOnsetAfter(onsets, t)` | First onset strictly after `t`. |
| `prevOnsetBefore(onsets, t)` | Last onset strictly before `t`. |
| `ccToTimeIndex(cc, times)` | Map CC 0–127 to an index in a sorted time array. |

---

## 8. File map (quick reference)

| Area | File |
|------|------|
| Loop state, center, note lists, MIDI knobs, engine sync | `src/hooks/usePianoLearner.ts` |
| `initLoopFromSheet`, overlay state, Esc, Record wiring | `src/App.tsx` |
| Note-snap helpers | `src/engine/loopSnap.ts` |
| Sheet click, drag handles, overlay UI | `src/ui/StaffCanvas.tsx` |
| Time ↔ X for staff | `src/ui/sheetTimeMapping.ts`, `src/ui/timelineConstants.ts` |
| Engine wrap + `seek` | `src/engine/playbackController.ts` |
| Bindings types (loop knobs, `loopAtPlayhead`) | `src/midi/midiHardwareBindings.ts` |
| Types (`LoopRegion`) | `src/types.ts` |

---

## Related

- Product overview: [PRD.md](../PRD.md)
- User-facing controls: [README.md](../README.md)
