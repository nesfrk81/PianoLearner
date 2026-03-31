import { Soundfont } from 'smplr'

let loadPromise: Promise<Soundfont> | null = null

/** Lazy singleton: FluidR3_GM acoustic grand piano (GM default). */
export function loadAcousticGrandPiano(
  context: AudioContext,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Soundfont> {
  if (!loadPromise) {
    const sf = new Soundfont(context, {
      kit: 'FluidR3_GM',
      instrument: 'acoustic_grand_piano',
      onLoadProgress: onProgress
        ? (p) => onProgress(p.loaded, p.total)
        : undefined,
    })
    loadPromise = sf.loaded().catch((err) => {
      loadPromise = null
      throw err
    })
  }
  return loadPromise
}

export function resetPianoInstrumentCache(): void {
  loadPromise = null
}
