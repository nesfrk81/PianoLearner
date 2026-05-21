# Looper — note-centric model

This document describes the **A/B loop** feature after the note-centric rework: center point, note-snapped boundaries, and MIDI knob behavior.

---

## 1. Overview

The looper repeats playback between two song-time boundaries **`loopA`** and **`loopB`** (seconds). A **center point** (`loopCenter`) anchors all adjustments: the start knob selects note onsets in `[0, center]`, the end knob selects note ends in `[center, duration]`, and the move knob slides the loop to a new onset while preserving its width.

Responsibility is split across:

- **`usePianoLearner`** — React state (`loopA`, `loopB`, `loopCenter`, `loopEnabled`), note-onset/end lists, MIDI knob handling, syncing to the engine.
- **`PlaybackController`** — `loop` property and wrap-around during `tick()`.
- **`App.tsx`** — `initLoopFromSheet` (staff click → calls hook's `initLoopAtCenter` + opens overlay).
- **`StaffCanvas`** — click-to-create region, draggable handles, "Done" on the sheet overlay; overlay positions scroll in sync with notation during playback (see §8).

---

## 2. State ownership

| Concern | Where | Notes |
|--------|--------|--------|
| Loop on/off and bounds | `usePianoLearner.ts` | `loopEnabled`, `loopA`, `loopB` (seconds). |
| Center point | same | `loopCenter` (seconds, or `null` if no loop). Set when a loop is first created; updated when the move knob slides the loop. |
| Note onset / end lists | same | `noteOnsets` and `noteEnds` — deduplicated, sorted arrays derived from `playbackNotes` via `uniqueOnsets()` / `uniqueEnds()` from `loopSnap.ts`. |
| Refs for MIDI handlers | same | `loopARef`, `loopBRef`, `loopEnabledRef`, `loopCenterRef`, `noteOnsetsRef`, `noteEndsRef` kept in sync via `useLayoutEffect`. |
| Soft-takeover for knobs | same | `knobPickedUp.loopStart`, `.loopEnd`, `.loopShift`, `.trackFocus` — until the physical CC crosses the current mapped value (within `PICKUP_THRESH = 3`), knob moves are ignored. Loop knobs also reset pickup when the **visible staff time range** changes (scrub/seek) or on `seek()`; the knob must re-sync to the mapped CC for the current loop edge on the new window before edges move again. |
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

- Drag handle **A** or **B**: pointer move maps X → song time via `getSongTime()`; enforces `MIN_LOOP_SEC = 0.05` between A and B, clamped to `[0, duration]`.
- **Center move handle** (grip icon, visible on hover over the blue band): drag horizontally to shift the whole loop; width is preserved (`shiftLoopRegion` in the hook, same idea as the MIDI loop move knob but continuous in time).
- While the overlay is open, **staff clicks do not** call `initLoopAtCenter` — only **Done**, **Esc**, or **Clear loop** close editing; click the staff again after **Done** to place a new loop.
- While the overlay is open and playback is running, handle and dim-band positions update every animation frame in the staff canvas RAF (§8), not from React `songTime` state.

### Loop start knob (CC)

- CC maps only over **note onsets visible on the staff** (playhead-centered window; same buffer as notation in `visibleSongTimeRange`).
- Further filters to onsets `<= loopCenter`.
- **Inactive** when loop **start** (`loopA`) is outside the visible window (left edge off-screen).
- CC 0–127 maps to an index in this list (`ccToTimeIndex`): CC 0 = earliest visible candidate, CC 127 = onset nearest to center.
- Sets `loopA` to the selected onset, as long as `loopA < loopB - 0.04`.
- After scrubbing the playhead, pickup is cleared until the physical CC matches the **new** mapped position for `loopA` on the visible window (prevents a jump when the knob was left at an extreme).

### Loop end knob (CC)

- CC maps only over **note ends visible on the staff**, then filtered to `>= loopCenter`.
- **Inactive** when loop **end** (`loopB`) is outside the visible window (right edge off-screen).
- CC 0–127 maps to an index: CC 0 = end nearest to center, CC 127 = latest visible end.
- Sets `loopB` to the selected end, as long as `loopB > loopA + 0.04`.
- Same viewport re-sync as loop start after scrub/seek.

### Loop move knob (CC)

- CC maps only over **visible onsets**; after soft pickup, movement is **relative to the visible onset index at pickup** (not the full song).
- Snaps `loopA` to the selected visible onset and `loopB = loopA + (previous region width)` via `shiftLoopRegion` (same clamping as the sheet center grip). The loop may extend beyond the viewport after a move.
- Still active when the loop is wider than the view (move shifts the whole region; start/end knobs may be off-screen and inactive).
- Updates `loopCenter` to the midpoint of the new region.
- Does **not** call `seek` on each CC tick — the playhead is not yanked to loop A while turning the knob.
- Simultaneous onsets (chords) share a single entry, so one knob step covers the entire chord.
- Same viewport re-sync after scrub/seek before the region shifts again.

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

## 8. Sheet overlay scrolling (visual sync)

The loop editor overlay (dimmed regions outside A–B, blue band, draggable handles) is **HTML** on top of the staff **canvas**. It must stay aligned with scrolling notation while the song plays.

### Time ↔ screen position

Positions use the same seconds-first mapping as click-to-loop and handle dragging:

- `src/ui/sheetTimeMapping.ts` — `songTimeToCssLeft(sec, canvas, songTime)` and `clientXToSongTime(...)`.
- Scroll is anchored at `PLAYHEAD_X_FRAC` (see `src/ui/timelineConstants.ts`): overlay X for a boundary `sec` is `sec * PPS + centerX - songTime * PPS`, scaled to CSS pixels.

### Two clocks: live time vs React `songTime`

| Concern | Source | Update rate |
|--------|--------|-------------|
| Staff canvas draw, waterfall draw, loop overlay while playing | `getSongTime()` → `PlaybackController.getSongTime()` (via `getLiveSongTime` from the hook) | Every `requestAnimationFrame` while playing |
| Transport time label, seek display, paused overlay layout | React `songTime` in `usePianoLearner` | Throttled to ~100 ms during playback to avoid re-rendering the whole app every frame; immediate on seek, pause, and load |

`StaffCanvas` receives both `songTime` (props) and `getSongTime` (callback). **Do not** drive overlay scroll from `songTime` alone during playback — that caused visible stutter (~10 Hz) against smooth canvas notation.

### How `StaffCanvas` syncs the overlay

1. **Refs** on overlay DOM nodes (`dimLeft`, `dimRight`, `band`, `handleA`, `handleB`).
2. **`syncLoopOverlay(t)`** — writes `left` / `width` styles using `songTimeToCssLeft` and `loopARef` / `loopBRef`.
3. **While playing** — `syncLoopOverlay(getSongTime())` runs at the end of the staff `draw()` RAF (same loop as the playhead and notes).
4. **While paused** — `useLayoutEffect` calls `syncLoopOverlay(songTime)` when bounds, seek position, or overlay visibility change.
5. **Resize** — `ResizeObserver` on the canvas re-syncs with `getSongTime()`.

The staff canvas `useEffect` that owns `draw()` must **not** list React `songTime` in its dependency array; otherwise the RAF restarts on every throttled `setSongTime` tick.

### Light blue band without overlay

When `loopEnabled` and the sheet overlay is closed (**Done**), the loop region is drawn on the canvas inside the translated staff context (`loopA` / `loopB` in song coordinates). That band scrolls with the same live `getSongTime()` scroll as notes — no separate overlay layer.

---

## 9. File map (quick reference)

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
- Staff / notation contracts and renderer criteria: [notation-phase1.md](notation-phase1.md)
- User-facing controls: [README.md](../README.md)
