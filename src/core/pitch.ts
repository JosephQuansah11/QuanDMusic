/**
 * Pitch primitives: MIDI <-> frequency <-> written pitch names.
 *
 * The whole application stores pitches as MIDI numbers (C4 = 60, A4 = 69).
 * Spelling (which letter name and accidental is used) always depends on the
 * key context, which is supplied by `core/keys.ts`.
 */

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/** Diatonic letter names, index 0 = C. */
export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
/** Semitones above C for each natural letter. */
export const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

export interface SpelledPitch {
  /** 0 = C, 1 = D, ... 6 = B */
  letter: number;
  /** Chromatic alteration: -2..+2 */
  alter: number;
  /** Scientific octave, C4 = middle C. */
  octave: number;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function frequencyToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

export function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

export function midiOctave(midi: number): number {
  return Math.floor(Math.round(midi) / 12) - 1;
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitchClass(midi));
}

export function midiToName(midi: number, preferFlats = false): string {
  const names = preferFlats ? FLAT_NAMES : SHARP_NAMES;
  return `${names[pitchClass(midi)]}${midiOctave(midi)}`;
}

export function midiToPitchClassName(midi: number, preferFlats = false): string {
  return (preferFlats ? FLAT_NAMES : SHARP_NAMES)[pitchClass(midi)];
}

export function accidentalToString(alter: number): string {
  switch (alter) {
    case -2:
      return 'bb';
    case -1:
      return 'b';
    case 0:
      return '';
    case 1:
      return '#';
    case 2:
      return '##';
    default:
      return alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter);
  }
}

export function spelledPitchToName(p: SpelledPitch): string {
  return `${LETTERS[p.letter]}${accidentalToString(p.alter)}${p.octave}`;
}

export function spelledPitchToMidi(p: SpelledPitch): number {
  return 12 * (p.octave + 1) + LETTER_SEMITONES[p.letter] + p.alter;
}

export function midiToSpelledPitch(midi: number, letter: number, alter: number): SpelledPitch {
  const octave = Math.round((midi - alter - LETTER_SEMITONES[letter]) / 12) - 1;
  return { letter, alter, octave };
}

/** Enharmonic variants of a pitch class that use at most one accidental. */
export function enharmonicSpellings(pc: number): { letter: number; alter: number }[] {
  const out: { letter: number; alter: number }[] = [];
  for (let letter = 0; letter < 7; letter++) {
    for (const alter of [-1, 0, 1]) {
      if (((LETTER_SEMITONES[letter] + alter) % 12 + 12) % 12 === pc) out.push({ letter, alter });
    }
  }
  return out;
}

export function clampMidi(midi: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, midi));
}

/** Number of semitones between two pitch classes, in the range -6..+6. */
export function intervalClass(a: number, b: number): number {
  let d = pitchClass(b) - pitchClass(a);
  while (d > 6) d -= 12;
  while (d < -6) d += 12;
  return d;
}
