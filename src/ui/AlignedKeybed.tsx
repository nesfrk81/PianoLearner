import { useMemo } from 'react'
import { fingeringKey } from '../engine/fingering'
import {
  getKeyRectsNormalized,
  midiRangeInclusive,
  relKeyGeom,
} from './pianoKeyLayout'

type Props = {
  minMidi: number
  maxMidi: number
  expectedMidi: ReadonlySet<number>
  userMidi: ReadonlySet<number>
  fingeringMap: Map<string, number>
  songTime: number
  activeNotes: { time: number; midi: number; duration: number }[]
}

function lowerBoundNoteTime(
  notes: { time: number; duration: number }[],
  targetSec: number,
): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (notes[mid]!.time < targetSec) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function AlignedKeybed({
  minMidi,
  maxMidi,
  expectedMidi,
  userMidi,
  fingeringMap,
  songTime,
  activeNotes,
}: Props) {
  const keys = useMemo(
    () => midiRangeInclusive(minMidi, maxMidi),
    [minMidi, maxMidi],
  )
  const rects = useMemo(
    () => getKeyRectsNormalized(minMidi, maxMidi),
    [minMidi, maxMidi],
  )
  const maxActiveNoteDuration = useMemo(
    () =>
      activeNotes.reduce(
        (max, n) => Math.max(max, Math.max(n.duration, 0.12)),
        0,
      ),
    [activeNotes],
  )

  const activeFingerByMidi = useMemo(() => {
    const out = new Map<number, number>()
    const start = lowerBoundNoteTime(
      activeNotes,
      Math.max(0, songTime - maxActiveNoteDuration - 0.02),
    )
    for (let i = start; i < activeNotes.length; i += 1) {
      const n = activeNotes[i]!
      if (n.time > songTime + 0.02) break
      if (
        songTime >= n.time - 0.02 &&
        songTime <= n.time + Math.max(n.duration, 0.12)
      ) {
        const finger = fingeringMap.get(fingeringKey(n.time, n.midi))
        if (finger != null) out.set(n.midi, finger)
      }
    }
    return out
  }, [activeNotes, fingeringMap, maxActiveNoteDuration, songTime])

  return (
    <div className="akb" aria-label="Piano keyboard">
      <div className="akb-keys">
        {keys.map((midi) => {
          const r = rects.get(midi)
          if (!r) return null
          const black = relKeyGeom(midi).isBlack
          const exp = expectedMidi.has(midi)
          const usr = userMidi.has(midi)
          let cls = 'akb-key ' + (black ? 'akb-b' : 'akb-w')
          if (exp && usr) cls += ' akb-hit'
          else if (exp) cls += ' akb-exp'
          else if (usr) cls += ' akb-user'
          const fg = activeFingerByMidi.get(midi)
          return (
            <div
              key={midi}
              className={cls}
              data-midi={midi}
              style={{
                position: 'absolute',
                left: `${r.left * 100}%`,
                width: `${r.width * 100}%`,
                height: black ? '64%' : '100%',
                top: black ? 0 : undefined,
                zIndex: black ? 2 : 0,
              }}
            >
              {fg != null ? <span className="akb-fg">{fg}</span> : null}
            </div>
          )
        })}
      </div>
      <p className="vk-disclaimer">
        Finger numbers are heuristic — MIDI has no fingering data.
      </p>
    </div>
  )
}
