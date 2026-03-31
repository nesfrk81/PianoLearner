import type { Midi } from '@tonejs/midi'
import type { Soundfont } from 'smplr'
import { allNotesFlat, notesForTrack } from '../midi/midiModel'
import type { NoteView, HandFilter } from '../types'
import type { PracticeMode } from '../types'
import { groupNotesByOnset, type OnsetGroup } from './onsetGroups'

const SCHEDULE_AHEAD = 0.28
const EPS = 0.025

export class PlaybackController {
  midi: Midi | null = null
  selectedTrackIndex = 0
  soloTrack = true
  mode: PracticeMode = 'listen'
  handFilter: HandFilter = 'both'
  splitMidi = 60
  playing = false

  private anchorAudio = 0
  private anchorSong = 0
  private scheduled = new Set<string>()
  private frozenSongTime: number | null = null

  onsetGroups: OnsetGroup[] = []
  private waitCursor = 0
  waiting = false
  private waitHits = new Set<number>()
  private practiceNoteIds = new Set<string>()

  loop: { a: number; b: number } | null = null

  private ctx: AudioContext
  private getPiano: () => Soundfont | null

  constructor(ctx: AudioContext, getPiano: () => Soundfont | null) {
    this.ctx = ctx
    this.getPiano = getPiano
  }

  setMidi(m: Midi | null): void {
    this.midi = m
    this.rebuildOnsets()
    this.scheduled.clear()
  }

  setSelectedTrack(index: number): void {
    this.selectedTrackIndex = index
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
    if (!this.midi || !this.midi.tracks[this.selectedTrackIndex]) {
      this.onsetGroups = []
      this.practiceNoteIds = new Set()
      return
    }
    const raw = notesForTrack(this.midi, this.selectedTrackIndex)
    this.practiceNoteIds = new Set(raw.map((n) => n.id))
    const notes = this.filterByHand(raw)
    this.onsetGroups = groupNotesByOnset(notes)
  }

  getPlaybackNotes(): NoteView[] {
    if (!this.midi) return []
    const raw = this.soloTrack
      ? notesForTrack(this.midi, this.selectedTrackIndex)
      : allNotesFlat(this.midi)
    return this.filterByHand(raw)
  }

  private getAccompanimentNotes(): NoteView[] {
    if (!this.midi) return []
    return allNotesFlat(this.midi).filter((n) => !this.practiceNoteIds.has(n.id))
  }

  getSongTime(): number {
    if (this.frozenSongTime != null) return this.frozenSongTime
    return (this.ctx.currentTime - this.anchorAudio) + this.anchorSong
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

    const piano = this.getPiano()
    if (piano) {
      const now = this.ctx.currentTime
      for (const m of g.mids) {
        const n = this.getPlaybackNotes().find(
          (x) => Math.abs(x.time - g.time) < EPS && x.midi === m,
        )
        const duration = n?.duration ?? 0.4
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
    const cap = untilExclusive ?? songTime + SCHEDULE_AHEAD
    const notes = notesOverride ?? this.getPlaybackNotes()
    for (const n of notes) {
      if (n.time < songTime - 0.02) continue
      if (n.time >= cap) continue
      if (this.scheduled.has(n.id)) continue
      this.scheduled.add(n.id)
      const delay = n.time - songTime
      const when = this.ctx.currentTime + Math.max(0, delay)
      piano.start({
        note: n.midi,
        velocity: Math.min(127, Math.max(1, Math.round(n.velocity * 127))),
        time: when,
        duration: Math.max(0.05, n.duration),
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
