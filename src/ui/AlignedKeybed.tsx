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

  const fingerForMidi = (midi: number): number | undefined => {
    for (const n of activeNotes) {
      if (n.midi !== midi) continue
      if (
        songTime >= n.time - 0.02 &&
        songTime <= n.time + Math.max(n.duration, 0.12)
      ) {
        return fingeringMap.get(fingeringKey(n.time, n.midi))
      }
    }
    return undefined
  }

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
          const fg = fingerForMidi(midi)
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
