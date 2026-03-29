/**
 * MIDI files do not include fingering. These are heuristic suggestions only.
 * RH: thumb = 1 … pinky = 5. LH: pinky = 5 … thumb = 1.
 */

export type Hand = 'L' | 'R'

const splitDefault = 60

function handForMidi(m: number, splitMidi: number): Hand {
  return m < splitMidi ? 'L' : 'R'
}

function roundT(t: number): number {
  return Math.round(t * 1000) / 1000
}

export function fingeringKey(time: number, midi: number): string {
  return `${roundT(time)}-${midi}`
}

function chordFingers(pitches: number[], hand: Hand): number[] {
  const p = [...pitches].sort((a, b) => a - b)
  const n = p.length
  if (n === 0) return []
  if (hand === 'R') {
    if (n <= 5) return p.map((_, i) => i + 1)
    return p.map((_, i) =>
      Math.max(1, Math.min(5, Math.round(1 + (i * 4) / Math.max(1, n - 1)))),
    )
  }
  if (n <= 5) return p.map((_, i) => 5 - i)
  return p.map((_, i) =>
    Math.max(1, Math.min(5, Math.round(5 - (i * 4) / Math.max(1, n - 1)))),
  )
}

export interface TimedPitch {
  time: number
  midi: number
}

export function computeFingeringMap(
  notes: TimedPitch[],
  splitMidi: number = splitDefault,
): Map<string, number> {
  const sorted = [...notes].sort(
    (a, b) => a.time - b.time || a.midi - b.midi,
  )
  const EPS = 0.02
  const result = new Map<string, number>()
  let lastR = { m: 60, f: 2 }
  let lastL = { m: 48, f: 3 }

  let i = 0
  while (i < sorted.length) {
    const t0 = sorted[i]!.time
    const group: TimedPitch[] = []
    while (i < sorted.length && Math.abs(sorted[i]!.time - t0) < EPS) {
      group.push(sorted[i]!)
      i++
    }
    const byHand = new Map<Hand, TimedPitch[]>()
    for (const n of group) {
      const h = handForMidi(n.midi, splitMidi)
      const arr = byHand.get(h) ?? []
      arr.push(n)
      byHand.set(h, arr)
    }
    for (const [hand, arr] of byHand) {
      const pitches = arr.map((x) => x.midi).sort((a, b) => a - b)
      const rt = roundT(t0)
      if (pitches.length === 1) {
        const m = pitches[0]!
        const last = hand === 'R' ? lastR : lastL
        const delta = m - last.m
        let f = last.f
        if (Math.abs(delta) <= 2) f += Math.sign(delta) || 1
        else if (delta > 4) f = Math.min(5, f + 1)
        else if (delta < -4) f = Math.max(1, f - 1)
        else f += Math.sign(delta)
        f = Math.max(1, Math.min(5, f))
        if (hand === 'R') lastR = { m, f }
        else lastL = { m, f }
        result.set(fingeringKey(rt, m), f)
      } else {
        const fingers = chordFingers(pitches, hand)
        pitches.forEach((m, idx) => {
          const f = fingers[idx]!
          result.set(fingeringKey(rt, m), f)
          if (hand === 'R') lastR = { m, f }
          else lastL = { m, f }
        })
      }
    }
  }
  return result
}
