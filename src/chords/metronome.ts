/**
 * Web Audio metronome used by the Chord Learning feature.
 *
 * Scheduling pattern follows the classic "A Tale of Two Clocks" lookahead
 * scheduler: a `setInterval` wakes every 25 ms, schedules any beats that fall
 * within the next 100 ms of `AudioContext.currentTime`, and fires a `beat`
 * event on the main thread at the correct wall-clock time so the exercise
 * engine can advance the current chord.
 */

/** Subscriber callback: receives the 0-based beat index (accents every 4). */
export type MetronomeBeatListener = (beatIndex: number) => void

export const MIN_BPM = 10
export const MAX_BPM = 300
export const DEFAULT_BPM = 60

const SCHEDULE_AHEAD_SEC = 0.1
const LOOKAHEAD_MS = 25
const CLICK_ENVELOPE_SEC = 0.035

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export class Metronome {
  private ctx: AudioContext
  private outputGain: GainNode
  private bpm = DEFAULT_BPM
  private beatsPerBar = 4
  private nextNoteTime = 0
  private beatIndex = 0
  private timer: ReturnType<typeof setInterval> | null = null
  /** Timers for main-thread beat callbacks; cleared on stop. */
  private pendingCallbacks: ReturnType<typeof setTimeout>[] = []
  private listeners = new Set<MetronomeBeatListener>()
  private _running = false

  constructor(ctx: AudioContext, outputGain = 0.25) {
    this.ctx = ctx
    const g = ctx.createGain()
    g.gain.value = outputGain
    g.connect(ctx.destination)
    this.outputGain = g
  }

  get running(): boolean {
    return this._running
  }

  getBpm(): number {
    return this.bpm
  }

  setBpm(next: number): void {
    this.bpm = clamp(Math.round(next), MIN_BPM, MAX_BPM)
  }

  getBeatsPerBar(): number {
    return this.beatsPerBar
  }

  setBeatsPerBar(n: number): void {
    this.beatsPerBar = clamp(Math.round(n), 1, 16)
  }

  /** Subscribe to beat events. Returns an unsubscribe function. */
  onBeat(listener: MetronomeBeatListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (this._running) return
    if (this.ctx.state !== 'running') {
      void this.ctx.resume()
    }
    this._running = true
    this.beatIndex = 0
    this.nextNoteTime = this.ctx.currentTime + 0.05
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS)
    this.tick()
  }

  stop(): void {
    if (!this._running) return
    this._running = false
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
    for (const t of this.pendingCallbacks) clearTimeout(t)
    this.pendingCallbacks = []
  }

  /** Release audio graph nodes. After `dispose()` the instance is unusable. */
  dispose(): void {
    this.stop()
    this.listeners.clear()
    try {
      this.outputGain.disconnect()
    } catch {
      /* already disconnected */
    }
  }

  private tick(): void {
    if (!this._running) return
    const secondsPerBeat = 60 / this.bpm
    while (this.nextNoteTime < this.ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      this.scheduleClick(this.nextNoteTime, this.beatIndex % this.beatsPerBar === 0)
      this.scheduleBeatCallback(this.nextNoteTime, this.beatIndex)
      this.nextNoteTime += secondsPerBeat
      this.beatIndex++
    }
  }

  private scheduleClick(atTime: number, accent: boolean): void {
    const osc = this.ctx.createOscillator()
    const env = this.ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = accent ? 1500 : 1000
    env.gain.setValueAtTime(0, atTime)
    env.gain.linearRampToValueAtTime(accent ? 1 : 0.7, atTime + 0.002)
    env.gain.exponentialRampToValueAtTime(
      0.0001,
      atTime + CLICK_ENVELOPE_SEC,
    )
    osc.connect(env)
    env.connect(this.outputGain)
    osc.start(atTime)
    osc.stop(atTime + CLICK_ENVELOPE_SEC + 0.01)
  }

  private scheduleBeatCallback(atTime: number, index: number): void {
    const delayMs = Math.max(0, (atTime - this.ctx.currentTime) * 1000)
    const handle = setTimeout(() => {
      this.pendingCallbacks = this.pendingCallbacks.filter((t) => t !== handle)
      if (!this._running) return
      for (const fn of this.listeners) {
        try {
          fn(index)
        } catch {
          /* listener errors shouldn't break the scheduler */
        }
      }
    }, delayMs)
    this.pendingCallbacks.push(handle)
  }
}
