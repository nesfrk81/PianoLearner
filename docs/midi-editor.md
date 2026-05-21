# MIDI editor

Inline piano-roll editor for loaded MIDI files. Open from the practice bar **Edit** button when a song is loaded.

## Layout

The editor **replaces** the main timeline (staff, waterfall, keybed) while open — it is not a modal overlay.

**Header row 1**
- Left: `Editing: <filename.mid>`
- Right: **Play**, **Save to library**, **X** (close)

**Header row 2**
- Left: **Track:** multiselect (all tracks listed; multiple selection allowed)
- Right: control instructions

**Body** (split-pane layout)
- **Left column:** piano keyboard (one row per pitch; C labels on octave boundaries); scrolls vertically in sync with the grid.
- **Top ruler:** fixed viewport above the grid (not inside the scroll container); song time in seconds; click to seek; redrawn from the grid’s `scrollLeft`.
- **Main grid:** a scroll container holds only a size spacer; viewport-sized grid canvas and playhead are overlaid on top and redrawn from `scrollLeft`/`scrollTop`. Vertical height follows the pitch range of the **union of selected tracks**. Notes are rounded square boxes with a pitch-class letter (`C`, `D`, `F#`, …) centered inside.

**Fixed time scale:** no zoom. The viewport always shows **10 seconds** of timeline width (`pixelsPerSec = viewportInnerW / 10`). Scale recalculates only on viewport resize. Content width spans the full song plus trailing padding for horizontal scrolling. The ruler uses absolute file seconds: **0.0s** is MIDI file time zero, and files with pre-zero pickup notes extend left to at least **-1.0s** so negative-time notes can be edited.

## Editing

| Action | Input |
|--------|--------|
| Paint notes | Click empty grid (one 16th note) or click-drag horizontally to set length (16th snap) |
| Erase notes | Right-drag on empty cells, or right-click a single note |
| Move note | Left-drag note body |
| Resize | Left-drag note left/right edge (wider hit targets) |
| Seek | Click the time ruler |
| Play / pause | Space |
| Nudge playhead | ← / → (±0.5 s) or mouse scroll wheel over the grid |
| Jump to file zero | Home |
| Undo | Ctrl+Z (per-stroke / per-drag undo snapshot) |
| Save | **Save to library** writes IndexedDB via the playlist hook |
| Close | **X** or Esc |

While the editor is open, global wheel scrub and arrow/Space transport on the main view are blocked. The editor's keyboard handler runs in the capture phase and owns Space / ← / → / Home / Esc. The grid body receives focus on open so a previously focused Play button does not also fire on Space.

New painted notes default to **one 16th note** at the file tempo. Click places that length; click-and-drag right sets a custom length snapped to 16ths. Notes draw at their true time width (one grid column per 16th). Hit targets are widened separately so short notes stay easy to grab; pitch labels hide when the note is too narrow.

### Multiselect tracks

When multiple tracks are selected, paint, erase, move, and resize apply to **all selected tracks** simultaneously. Overlapping notes under the cursor move or resize together.

## Looper

When the editor opens, any active loop is **automatically suspended** so playback preview during edits is not yanked back to `loopA`. On close, the previous loop-enabled state is restored. The loop bounds (`A` / `B`) are preserved.

## Playback performance

- Grid and ruler canvases are **viewport-sized** (scroll `clientWidth` × `clientHeight`). Song-sized dimensions live on a lightweight scroll spacer div only. Canvases redraw only grid lines and notes intersecting the visible region (culling by time and pitch).
- The keys column is viewport-sized and scrolls vertically in sync with the grid (`translateY(-scrollTop)` when drawing).
- The playhead is a DOM element with `translate3d` updated from the transport `requestAnimationFrame` (after `tick()`), skipping redundant pixel positions. Canvases redraw only when scroll position or content changes — not during playback except when the playhead leaves the viewport (off-screen check every 2 s). Wheel seek uses `seekAudio` (no React state per tick); parent `onSeek` flushes once after scrubbing stops.
- Paint and erase strokes mutate the local MIDI buffer directly and trigger only a canvas redraw. The parent (`applyMidiEdit`) is notified only on pointer up.
- Vertical grid lines use fixed 16th-note spacing.
- Scroll and resize handlers update a single `EditorLayout` ref and redraw synchronously (no deferred RAF on scroll).

## Implementation

| File | Role |
|------|------|
| `src/ui/MidiEditorPanel.tsx` | Inline UI, scroll sync, pointer handling, owned keyboard handler, local MIDI + undo |
| `src/ui/midiEditorLayout.ts` | `EditorLayout` computation, time/pitch ↔ pixel helpers, pointer mapping, hit width |
| `src/ui/midiEditorDraw.ts` | Viewport canvas painters (grid, ruler, keys) + playhead transform helper |
| `src/ui/midiEditorSnap.ts` | 16th-note snap, bar/beat timing, default note length |
| `src/ui/midiEditorTheme.ts` | CSS variable → canvas colors, canvas sizing helper |

Colors are driven by `--midi-editor-*` tokens in `src/index.css` (light/dark). Chrome uses `--bg` and `--text-h` like the settings dialog. Layout CSS uses BEM classes (`midi-editor__*`) in `src/App.css`.

The grid scroll container is the **single coordinate authority**: `pps`, pointer hit-testing, and canvas drawing all derive from `scrollEl.clientWidth` and `scrollLeft`/`scrollTop`.
