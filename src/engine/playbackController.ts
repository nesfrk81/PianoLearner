import type { Midi } from '@tonejs/midi'
import type { Soundfont } from 'smplr'
import { allNotesFlat, normalizeTrackIndices, notesForTracks } from '../midi/midiModel'
import type { NoteView, HandFilter } from '../types'
import type { PracticeMode } from '../types'
import { groupNotesByOnset, type OnsetGroup } from './onsetGroups'

const SCHEDULE_AHEAD = 0.28
const EPS = 0.025

function lowerBoundNoteTime(notes: NoteView[], targetSec: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (notes[mid]!.time < targetSec) lo = mid + 1
    else hi = mid
  }
  return lo
}

export class PlaybackController {
  midi: Midi | null = null
  selectedTrackIndices: number[] = [0]
  mode: PracticeMode = 'listen'
  handFilter: HandFilter = 'both'
  splitMidi = 60
  playing = false

  private anchorAudio = 0
  private anchorSong = 0
  private scheduled = new Set<string>()
  private frozenSongTime: number | null = null
  /**
   * Playback rate as a multiplier of the file's authored tempo (1.0 = MIDI's
   * native speed). Song-time advances `timeScale` seconds of song per second
   * of wall clock. Changes rebase `anchorSong`/`anchorAudio` in
   * {@link setTimeScale} so the playhead stays continuous.
   */
  private timeScale = 1

  onsetGroups: OnsetGroup[] = []
  private waitCursor = 0
  waiting = false
  private waitHits = new Set<number>()
  private practiceNoteIds = new Set<string>()
  private playbackNotes: NoteView[] = []
  private accompanimentNotes: NoteView[] = []

  loop: { a: number; b: number } | null = null

  private ctx: AudioContext
  private getPiano: () => Soundfont | null

  constructor(ctx: AudioContext, getPiano: () => Soundfont | null) {
    this.ctx = ctx
    this.getPiano = getPiano
  }

  /** Browsers suspend AudioContext when the tab is backgrounded; resume before scheduling output. */
  private ensureContextRunning(): void {
    if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') {
      void this.ctx.resume()
    }
  }

  setMidi(m: Midi | null): void {
    this.midi = m
    this.rebuildOnsets()
    this.scheduled.clear()
  }

  setSelectedTracks(indices: number[]): void {
    if (!this.midi) {
      this.selectedTrackIndices =
        indices.length > 0
          ? [...new Set(indices)].filter((i) => i >= 0).sort((a, b) => a - b)
          : [0]
    } else {
      this.selectedTrackIndices = normalizeTrackIndices(this.midi, indices)
    }
    this.rebuildOnsets()
    this.scheduled.clear()
    const t = this.getSongTime()
    this.waitCursor = this.onsetGroups.findIndex((g) => g.time >= t - EPS)
    if (this.waitCursor < 0) this.waitCursor = this.onsetGroups.length
  }

  setHandFilter(filter: HandFilter, split: number): void {
    this.handFilter = filter
    this.splitMidi = split
    this.rebuildOnsets()
    this.scheduled.clear()
  }

  resetWaitState(): void {
    this.waiting = false
    this.waitHits.clear()
    if (!this.playing && this.frozenSongTime == null) {
      this.frozenSongTime = this.getSongTime()
    }
  }

  private filterByHand(notes: NoteView[]): NoteView[] {
    if (this.handFilter === 'both') return notes
    return notes.filter((n) =>
      this.handFilter === 'left' ? n.midi < this.splitMidi : n.midi >= this.splitMidi,
    )
  }

  rebuildOnsets(): void {
    if (!this.midi || this.selectedTrackIndices.length === 0) {
      this.onsetGroups = []
      this.practiceNoteIds = new Set()
      this.playbackNotes = []
      this.accompanimentNotes = []
      return
    }
    const raw = notesForTracks(this.midi, this.selectedTrackIndices)
    this.practiceNoteIds = new Set(raw.map((n) => n.id))
    const notes = this.filterByHand(raw)
    this.playbackNotes = notes
    this.accompanimentNotes = allNotesFlat(this.midi).filter(
      (n) => !this.practiceNoteIds.has(n.id),
    )
    this.onsetGroups = groupNotesByOnset(notes)
  }

  getPlaybackNotes(): NoteView[] {
    return this.playbackNotes
  }

  private getAccompanimentNotes(): NoteView[] {
    return this.accompanimentNotes
  }

  getSongTime(): number {
    if (this.frozenSongTime != null) return this.frozenSongTime
    return (
      (this.ctx.currentTime - this.anchorAudio) * this.timeScale +
      this.anchorSong
    )
  }

  getTimeScale(): number {
    return this.timeScale
  }

  /**
   * Change the playback rate. Clamped to 0.1–10×. While playing, rebases the
   * song/audio anchors to preserve the current song position, and clears the
   * schedule so future notes are re-dispatched at the new rate. Notes that
   * were already queued on the AudioContext will play at their old scheduled
   * wall-times — this may cause a small (<SCHEDULE_AHEAD) audio/playhead
   * glitch right at a rate change, which is acceptable.
   */
  setTimeScale(scale: number): void {
    const s = Math.max(0.1, Math.min(10, scale))
    if (Math.abs(s - this.timeScale) < 1e-4) return
    if (this.playing) {
      const currentSong = this.getSongTime()
      this.timeScale = s
      this.anchorSong = currentSong
      this.anchorAudio = this.ctx.currentTime
      this.scheduled.clear()
    } else {
      this.timeScale = s
    }
  }

  seek(sec: number): void {
    const d = this.midi?.duration ?? 0
    const t = Math.max(0, Math.min(sec, d))
    this.scheduled.clear()
    if (this.playing) {
      this.anchorSong = t
      this.anchorAudio = this.ctx.currentTime
      this.frozenSongTime = null
    } else {
      this.frozenSongTime = t
    }
    this.waiting = false
    this.waitCursor = this.onsetGroups.findIndex((g) => g.time >= t - EPS)
    if (this.waitCursor < 0) this.waitCursor = this.onsetGroups.length
  }

  start(): void {
    if (!this.midi) return
    this.playing = true
    const t = this.frozenSongTime ?? this.getSongTime()
    this.anchorSong = t
    this.anchorAudio = this.ctx.currentTime
    this.frozenSongTime = null
  }

  pause(): void {
    const t = this.getSongTime()
    this.playing = false
    this.frozenSongTime = t
    this.waiting = false
    this.scheduled.clear()
  }

  /** Frame tick: schedule upcoming notes and handle loop / wait. */
  tick(): void {
    if (!this.playing || !this.midi) return
    this.ensureContextRunning()
    const piano = this.getPiano()
    if (!piano) return

    let songTime = this.getSongTime()
    const dur = this.midi.duration

    if (this.loop && songTime >= this.loop.b - 0.002) {
      this.seek(this.loop.a)
      songTime = this.getSongTime()
    }

    if (songTime >= dur - 0.01) {
      this.pause()
      this.seek(0)
      return
    }

    if (this.mode === 'wait') {
      this.tickWaitMode(piano, songTime)
      return
    }

    if (this.mode === 'follow') {
      const acc = this.getAccompanimentNotes()
      if (acc.length > 0) this.scheduleNotes(piano, songTime, undefined, acc)
      return
    }

    this.scheduleNotes(piano, songTime)
  }

  private tickWaitMode(piano: Soundfont, songTime: number): void {
    if (this.waiting) return

    const g = this.onsetGroups[this.waitCursor]
    if (!g) {
      this.scheduleNotes(piano, songTime)
      return
    }

    if (songTime >= g.time - 0.001) {
      this.enterWait(g.time)
      return
    }

    this.scheduleNotes(piano, songTime, g.time - 0.001)
  }

  private enterWait(freezeAt: number): void {
    this.waiting = true
    this.waitHits.clear()
    this.frozenSongTime = freezeAt
    this.anchorSong = freezeAt
    this.anchorAudio = this.ctx.currentTime
  }

  /** Call on each user note-on while in wait mode (accumulates until all expected pitches hit). */
  userNoteOn(midi: number): void {
    if (!this.waiting || this.mode !== 'wait') return
    this.waitHits.add(midi)
    const g = this.onsetGroups[this.waitCursor]
    if (!g) return
    if (g.mids.every((m) => this.waitHits.has(m))) {
      this.completeWaitGroup()
    }
  }

  private completeWaitGroup(): void {
    if (!this.waiting || this.mode !== 'wait') return
    const g = this.onsetGroups[this.waitCursor]
    if (!g) return

    this.ensureContextRunning()
    const piano = this.getPiano()
    if (piano) {
      const now = this.ctx.currentTime
      const ts = this.timeScale
      const notes = this.getPlaybackNotes()
      for (const m of g.mids) {
        const n = notes.find(
          (x) => Math.abs(x.time - g.time) < EPS && x.midi === m,
        )
        const duration = (n?.duration ?? 0.4) / ts
        piano.start({
          note: m,
          velocity: n ? Math.min(127, Math.round(n.velocity * 127)) : 90,
          time: now,
          duration,
        })
      }
    }

    this.waiting = false
    this.waitHits.clear()
    this.waitCursor++
    this.frozenSongTime = null

    const next = this.onsetGroups[this.waitCursor]
    if (next) {
      this.anchorSong = next.time
      this.anchorAudio = this.ctx.currentTime
    } else {
      this.pause()
      this.seek(0)
    }
  }

  private scheduleNotes(
    piano: Soundfont,
    songTime: number,
    untilExclusive?: number,
    notesOverride?: NoteView[],
  ): void {
    this.ensureContextRunning()
    /* SCHEDULE_AHEAD is a wall-clock horizon; convert to song-time so we look
       further into the score when `timeScale > 1` (faster playback needs a
       wider song-time window to cover the same wall-clock window). */
    const cap = untilExclusive ?? songTime + SCHEDULE_AHEAD * this.timeScale
    const notes = notesOverride ?? this.getPlaybackNotes()
    const ts = this.timeScale
    const start = lowerBoundNoteTime(notes, songTime - 0.02)
    for (let i = start; i < notes.length; i += 1) {
      const n = notes[i]!
      if (n.time < songTime - 0.02) continue
      if (n.time >= cap) break
      if (this.scheduled.has(n.id)) continue
      this.scheduled.add(n.id)
      const delaySong = n.time - songTime
      const when = this.ctx.currentTime + Math.max(0, delaySong / ts)
      piano.start({
        note: n.midi,
        velocity: Math.min(127, Math.max(1, Math.round(n.velocity * 127))),
        time: when,
        duration: Math.max(0.05, n.duration / ts),
      })
    }
  }

  /** In wait mode, returns only the current onset group's pitches. Null when not waiting. */
  getWaitExpectedMidi(): Set<number> | null {
    if (this.mode !== 'wait' || !this.waiting) return null
    const g = this.onsetGroups[this.waitCursor]
    if (!g) return null
    return new Set(g.mids)
  }
}
