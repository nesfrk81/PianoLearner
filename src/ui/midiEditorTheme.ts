export type MidiEditorColors = {
  bg: string
  gridMinor: string
  gridMajor: string
  rowLine: string
  keyWhite: string
  keyBlack: string
  keyBorder: string
  keyLabel: string
  noteFill: string
  noteStroke: string
  noteLabel: string
  rulerText: string
  rulerBg: string
  playhead: string
  playheadGlow: string
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
  return v || fallback
}

export function readMidiEditorColors(): MidiEditorColors {
  return {
    bg: cssVar('--midi-editor-bg', cssVar('--code-bg', '#1a1a24')),
    gridMinor: cssVar('--midi-editor-grid-minor', 'rgba(255,255,255,0.04)'),
    gridMajor: cssVar('--midi-editor-grid-major', 'rgba(255,255,255,0.08)'),
    rowLine: cssVar('--midi-editor-row-line', 'rgba(255,255,255,0.05)'),
    keyWhite: cssVar('--midi-editor-key-white', 'rgba(255,255,255,0.09)'),
    keyBlack: cssVar('--midi-editor-key-black', 'rgba(0,0,0,0.35)'),
    keyBorder: cssVar('--midi-editor-key-border', 'rgba(255,255,255,0.08)'),
    keyLabel: cssVar('--midi-editor-key-label', 'rgba(255,255,255,0.55)'),
    noteFill: cssVar('--midi-editor-note', '#c45f12'),
    noteStroke: cssVar('--midi-editor-note-stroke', '#e8893a'),
    noteLabel: cssVar('--midi-editor-note-label', '#ffffff'),
    rulerText: cssVar('--midi-editor-ruler-text', 'rgba(255,255,255,0.45)'),
    rulerBg: cssVar('--midi-editor-ruler-bg', cssVar('--code-bg', '#1a1a24')),
    playhead: cssVar('--midi-editor-playhead', 'rgba(147, 197, 253, 0.95)'),
    playheadGlow: cssVar(
      '--midi-editor-playhead-glow',
      'rgba(56, 189, 248, 0.45)',
    ),
  }
}

export type CanvasSizeCache = { cssW: number; cssH: number; dpr: number }

export function setupCanvas(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
  cache: CanvasSizeCache,
): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1
  if (cache.cssW !== cssW || cache.cssH !== cssH || cache.dpr !== dpr) {
    canvas.width = Math.max(1, Math.floor(cssW * dpr))
    canvas.height = Math.max(1, Math.floor(cssH * dpr))
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`
    cache.cssW = cssW
    cache.cssH = cssH
    cache.dpr = dpr
  }
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}
