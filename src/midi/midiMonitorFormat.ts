/** Skip logging (MIDI clock spam). */
export function shouldLogMidiMessage(data: Uint8Array): boolean {
  if (data.length < 1) return false
  const st = data[0]
  if (st === 0xf8) return false
  if (st === 0xfe) return false
  return true
}

const NOTE_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const

function noteName(note: number): string {
  const o = Math.floor(note / 12) - 1
  return `${NOTE_NAMES[note % 12]}${o}`
}

/** One-line description for the MIDI monitor. */
export function formatMidiMessage(data: Uint8Array): string {
  if (data.length < 1) return '(empty)'
  const st = data[0]
  const hex = [...data].map((b) => b.toString(16).padStart(2, '0')).join(' ')

  if (st >= 0xf8) {
    const rt: Record<number, string> = {
      0xf8: 'Clock',
      0xfa: 'Start',
      0xfb: 'Continue',
      0xfc: 'Stop',
      0xfe: 'Active Sense',
      0xff: 'Reset',
    }
    return `${rt[st] ?? `RT ${st.toString(16)}`}  [${hex}]`
  }

  const ch = (st & 0x0f) + 1
  const hi = st & 0xf0

  if (hi === 0x80 && data.length >= 3) {
    return `Ch${ch} Note Off ${noteName(data[1])} (${data[1]}) vel ${data[2]}  [${hex}]`
  }
  if (hi === 0x90 && data.length >= 3) {
    const kind = data[2] > 0 ? 'Note On' : 'Note Off'
    return `Ch${ch} ${kind} ${noteName(data[1])} (${data[1]}) vel ${data[2]}  [${hex}]`
  }
  if (hi === 0xa0 && data.length >= 3) {
    return `Ch${ch} Poly Aftertouch ${noteName(data[1])} val ${data[2]}  [${hex}]`
  }
  if (hi === 0xb0 && data.length >= 3) {
    return `Ch${ch} CC ${data[1]} = ${data[2]}  [${hex}]`
  }
  if (hi === 0xc0 && data.length >= 2) {
    return `Ch${ch} Program Change ${data[1]}  [${hex}]`
  }
  if (hi === 0xd0 && data.length >= 2) {
    return `Ch${ch} Channel Aftertouch ${data[1]}  [${hex}]`
  }
  if (hi === 0xe0 && data.length >= 3) {
    const bend = (data[2] << 7) | data[1]
    return `Ch${ch} Pitch Bend ${bend}  [${hex}]`
  }

  return `[${hex}]`
}
