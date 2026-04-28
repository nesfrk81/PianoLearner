import { StaffCanvas } from './StaffCanvas'
import { WaterfallPianoRoll } from './WaterfallPianoRoll'
import { AlignedKeybed } from './AlignedKeybed'
import type { NoteView } from '../types'

type Props = {
  notes: NoteView[]
  duration: number
  songTime: number
  getSongTime: () => number
  minPitch: number
  maxPitch: number
  splitMidi: number
  playing: boolean
  loopEnabled: boolean
  loopA: number
  loopB: number
  userMidi: ReadonlySet<number>
  expectedMidi: Set<number>
  fingeringMap: Map<string, number>
  activeAdjustedTime: number
  onSeek: (sec: number) => void
  onInitLoopRegion: (centerSec: number) => void
  onLoopBoundsChange: (a: number, b: number) => void
  loopSheetOverlay: boolean
  onCloseLoopSheetOverlay: () => void
}

export function MusicTimeline({
  notes,
  duration,
  songTime,
  getSongTime,
  minPitch,
  maxPitch,
  splitMidi,
  playing,
  loopEnabled,
  loopA,
  loopB,
  userMidi,
  expectedMidi,
  fingeringMap,
  activeAdjustedTime,
  onSeek,
  onInitLoopRegion,
  onLoopBoundsChange,
  loopSheetOverlay,
  onCloseLoopSheetOverlay,
}: Props) {
  return (
    <div className="music-timeline synthesia-stack">
      <StaffCanvas
        notes={notes}
        duration={duration}
        songTime={songTime}
        getSongTime={getSongTime}
        splitMidi={splitMidi}
        playing={playing}
        loopEnabled={loopEnabled}
        loopA={loopA}
        loopB={loopB}
        userMidi={userMidi}
        onInitLoopRegion={onInitLoopRegion}
        onLoopBoundsChange={onLoopBoundsChange}
        loopOverlayOpen={loopSheetOverlay}
        onCloseLoopOverlay={onCloseLoopSheetOverlay}
      />
      <WaterfallPianoRoll
        notes={notes}
        duration={duration}
        songTime={songTime}
        getSongTime={getSongTime}
        playing={playing}
        minPitch={minPitch}
        maxPitch={maxPitch}
        onSeek={onSeek}
      />
      <AlignedKeybed
        minMidi={minPitch}
        maxMidi={maxPitch}
        expectedMidi={expectedMidi}
        userMidi={userMidi}
        fingeringMap={fingeringMap}
        songTime={activeAdjustedTime}
        activeNotes={notes}
      />
    </div>
  )
}
