# Sheet Music Notation Upgrade: Phase 1 Baseline

This note captures the contracts that must survive the notation renderer spike. It is intentionally implementation-facing: the goal is to evaluate ABC, MusicXML, or an improved custom renderer without changing the product behavior first.

## Current Staff Contract

`src/ui/MusicTimeline.tsx` owns the vertical stack and passes the notation surface:

- `notes`: filtered `NoteView[]` from the selected practice tracks.
- `duration`: song duration in seconds.
- `songTime`: playback engine time in seconds, already adjusted by transport and Chord Learning playback-rate behavior.
- `splitMidi`: right/left staff split.
- `loopEnabled`, `loopA`, `loopB`: A/B loop state in seconds.
- `userMidi`: currently held USB MIDI notes for live highlighting.
- `onInitLoopRegion(centerSec)`: staff click creates a loop around a song-time center.
- `onLoopBoundsChange(a, b)`: drag handles update A/B bounds in seconds.
- `loopSheetOverlay`, `onCloseLoopSheetOverlay`: overlay visibility and Done action.

`src/ui/StaffCanvas.tsx` currently renders this contract directly on a canvas.

## Time Mapping Contract

The timeline is seconds-first:

- `src/ui/timelineConstants.ts` defines `PPS = 110`, `VIEW_WIDTH = 1280`, and `PLAYHEAD_X_FRAC = 0.35`.
- Note x-position is `note.time * PPS`.
- Scroll is `songTime * PPS`.
- `src/ui/sheetTimeMapping.ts` converts browser X coordinates to song seconds and loop seconds back to CSS positions.

Any renderer that uses measure-based spacing needs a single authoritative `timeToX` abstraction before it can replace the current staff. Mixing measure-based note layout with the existing linear overlay math will break loop alignment.

## Behaviors To Baseline Manually

Before replacing the staff, capture these behaviors against the current UI:

- Load a MIDI file and play: staff, waterfall, and keybed remain aligned.
- Click the staff: loop is created around the clicked song time.
- Drag A/B handles: bounds update in seconds and keep at least `0.05s` separation.
- Press Done: loop remains active and the sheet overlay closes.
- Press Esc or Clear loop: loop disables and overlay closes.
- Use MIDI Record binding: creates a loop at the playhead, then clears it on the next press.
- Use MIDI loop start/end/move knobs: follows the note-centric model from `docs/looper.md`.
- Press live USB MIDI keys: held notes remain visible on the staff/keybed.
- Change Chord Learning Free Practice BPM with a MIDI file loaded: playback speed changes via `timeScale`, and notation follows `songTime` without its own clock.
- Start an active lesson: song playback remains at 1.00x while lesson BPM controls lesson timing.

## Spike Summary

Both abcjs (ABC) and OSMD (MusicXML) were evaluated in a dev-only probe and then removed from the codebase after comparison.

- **abcjs:** feasible timing hooks, but still requires layout-derived mapping work to preserve loop overlay correctness.
- **OSMD:** best engraving potential, but highest conversion and integration complexity for this app's seconds-based transport model.
- **Custom time-linear renderer:** best fit for preserving existing looper and transport contracts with the least regression risk.

## MVP Decision

Use a custom time-linear renderer for v1, with canvas as the main playback surface.

Rationale:

- It preserves the existing `songTime -> x` contract used by click-to-loop, loop handles, playhead, and scrolling.
- It keeps the waterfall, keybed, and sheet using the same seconds-based transport model.
- It avoids adding a measure-layout-to-time bridge before the core looper regression risk is retired.
- It keeps abcjs and OSMD as spike references rather than shipped runtime dependencies.
- Dense MIDI files showed that a React/SVG note-per-DOM-node approach is too expensive during playback.

Implementation note: `src/ui/StaffCanvas.tsx` preserves its public props and uses an optimized canvas renderer internally. It only draws notes in the visible time window plus a small buffer, and timeline canvases animate from live controller time to avoid full-app React re-renders at frame rate.

## Renderer Acceptance Criteria

A renderer is acceptable for MVP only if it can satisfy all of these:

- It consumes the existing filtered `NoteView[]` plus `@tonejs/midi` metadata without a backend.
- It keeps scroll and highlighting driven by `songTime`.
- It exposes enough timing or DOM geometry to align loop overlay positions.
- It supports or can be layered with live `userMidi` highlighting.
- It does not require changing MIDI hardware bindings.
- It keeps bundle growth reasonable and ships with complete license notices.
