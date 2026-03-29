/** Lower row: C3–B3 + C4. Upper row + numbers: chromatic C#4–F#5 (common game-style layout). */

export const QWERTY_TO_MIDI: Record<string, number> = {}

const lower = [
  ['z', 48],
  ['s', 49],
  ['x', 50],
  ['d', 51],
  ['c', 52],
  ['v', 53],
  ['g', 54],
  ['b', 55],
  ['h', 56],
  ['n', 57],
  ['j', 58],
  ['m', 59],
  [',', 60],
] as const

const upper = [
  ['q', 61],
  ['2', 62],
  ['w', 63],
  ['3', 64],
  ['e', 65],
  ['r', 66],
  ['5', 67],
  ['t', 68],
  ['6', 69],
  ['y', 70],
  ['7', 71],
  ['u', 72],
  ['i', 73],
  ['9', 74],
  ['o', 75],
  ['0', 76],
  ['p', 77],
  ['[', 78],
  [']', 79],
] as const

for (const [k, v] of lower) QWERTY_TO_MIDI[k] = v
for (const [k, v] of upper) QWERTY_TO_MIDI[k] = v

export function midiForQwertyKey(
  key: string,
  octaveShift: number,
): number | undefined {
  const base = QWERTY_TO_MIDI[key.toLowerCase()]
  if (base === undefined) return undefined
  return base + octaveShift * 12
}
