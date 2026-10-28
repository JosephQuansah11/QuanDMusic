/**
 * Keys, key signatures, scales and transposition.
 *
 * Transposition is diatonic-aware: transposing a score by an interval also
 * rewrites the accidentals so the result is spelled like real sheet music
 * (e.g. Bb major does not contain A#).
 */

import { LETTERS, LETTER_SEMITONES, pitchClass } from './pitch';

export type Mode = 'major' | 'minor';

export interface Key {
  /** Tonic pitch class, 0 = C. */
  tonic: number;
  mode: Mode;
}

/** Canonical circle-of-fifths position for each major tonic pitch class. */
const MAJOR_FIFTHS_BY_PC: Record<number, number> = {
  0: 0, // C
  1: -5, // Db
  2: 2, // D
  3: -3, // Eb
  4: 4, // E
  5: -1, // F
  6: 6, // F#
  7: 1, // G
  8: -4, // Ab
  9: 3, // A
  10: -2, // Bb
  11: 5, // B
};

const MAJOR_PC_BY_FIFTHS: Record<number, number> = {
  [-7]: 11, // Cb
  [-6]: 6, // Gb
  [-5]: 1, // Db
  [-4]: 8, // Ab
  [-3]: 3, // Eb
  [-2]: 10, // Bb
  [-1]: 5, // F
  0: 0, // C
  1: 7, // G
  2: 2, // D
  3: 9, // A
  4: 4, // E
  5: 11, // B
  6: 6, // F#
  7: 1, // C#
};

export const MAJOR_NAME_BY_FIFTHS: Record<number, string> = {
  [-7]: 'Cb',
  [-6]: 'Gb',
  [-5]: 'Db',
  [-4]: 'Ab',
  [-3]: 'Eb',
  [-2]: 'Bb',
  [-1]: 'F',
  0: 'C',
  1: 'G',
  2: 'D',
  3: 'A',
  4: 'E',
  5: 'B',
  6: 'F#',
  7: 'C#',
};

const MINOR_NAME_BY_FIFTHS: Record<number, string> = {
  [-7]: 'Ab',
  [-6]: 'Eb',
  [-5]: 'Bb',
  [-4]: 'F',
  [-3]: 'C',
  [-2]: 'G',
  [-1]: 'D',
  0: 'A',
  1: 'E',
  2: 'B',
  3: 'F#',
  4: 'C#',
  5: 'G#',
  6: 'D#',
  7: 'A#',
};

export function majorFifths(tonic: number): number {
  return MAJOR_FIFTHS_BY_PC[pitchClass(tonic)];
}

/** Number of sharps (positive) or flats (negative) in the key signature. */
export function keyFifths(key: Key): number {
  const majorTonic = key.mode === 'major' ? key.tonic : pitchClass(key.tonic + 3);
  return majorFifths(majorTonic);
}

export function keyFromFifths(fifths: number, mode: Mode = 'major'): Key {
  const clamped = Math.max(-7, Math.min(7, Math.round(fifths)));
  const majorTonic = MAJOR_PC_BY_FIFTHS[clamped];
  return { tonic: mode === 'major' ? majorTonic : pitchClass(majorTonic - 3), mode };
}

export function keyName(key: Key): string {
  const fifths = keyFifths(key);
  const base = key.mode === 'major' ? MAJOR_NAME_BY_FIFTHS[fifths] : MINOR_NAME_BY_FIFTHS[fifths];
  return `${base} ${key.mode}`;
}

/** Just the key name, e.g. "Eb". */
export function keySignatureName(key: Key): string {
  return key.mode === 'major' ? MAJOR_NAME_BY_FIFTHS[keyFifths(key)] : MINOR_NAME_BY_FIFTHS[keyFifths(key)];
}

/** VexFlow friendly key specifier, e.g. "Eb" or "F#m". */
export function vexKeySpec(key: Key): string {
  const fifths = keyFifths(key);
  if (key.mode === 'major') return MAJOR_NAME_BY_FIFTHS[fifths];
  return `${MINOR_NAME_BY_FIFTHS[fifths]}m`;
}

export function keysEqual(a: Key, b: Key): boolean {
  return pitchClass(a.tonic) === pitchClass(b.tonic) && a.mode === b.mode;
}

/** Order in which sharps (F C G D A E B) and flats (B E A D G C F) appear. */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

export interface KeySignatureAccidental {
  letter: number;
  alter: number;
  pc: number;
}

export function keySignatureAccidentals(key: Key): KeySignatureAccidental[] {
  const fifths = keyFifths(key);
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  const alter = fifths >= 0 ? 1 : -1;
  return order.slice(0, Math.abs(fifths)).map((letter) => ({
    letter,
    alter,
    pc: pitchClass(LETTER_SEMITONES[letter] + alter),
  }));
}

export interface SpelledScaleDegree {
  /** 1..7 */
  degree: number;
  letter: number;
  alter: number;
  pc: number;
}

/** The seven diatonic degrees of the key, spelled correctly. */
export function diatonicScale(key: Key): SpelledScaleDegree[] {
  const signature = new Map<number, number>();
  for (const acc of keySignatureAccidentals(key)) signature.set(acc.letter, acc.alter);

  // Locate the letter of the tonic inside its own key signature.
  let tonicLetterIndex = 0;
  for (let letter = 0; letter < 7; letter++) {
    const alter = signature.get(letter) ?? 0;
    if (pitchClass(LETTER_SEMITONES[letter] + alter) === pitchClass(key.tonic)) {
      tonicLetterIndex = letter;
      break;
    }
  }

  const modeSteps = key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  const degrees: SpelledScaleDegree[] = [];
  for (let i = 0; i < 7; i++) {
    const letter = (tonicLetterIndex + i) % 7;
    const targetPc = pitchClass(key.tonic + modeSteps[i]);
    let alter = targetPc - LETTER_SEMITONES[letter];
    while (alter > 6) alter -= 12;
    while (alter < -6) alter += 12;
    degrees.push({ degree: i + 1, letter, alter, pc: targetPc });
  }
  return degrees;
}

export function scalePitchClasses(key: Key): number[] {
  return diatonicScale(key).map((d) => d.pc);
}

/** Scale degree (1..7) of a pitch class, or null when it is chromatic. */
export function scaleDegreeOf(pc: number, key: Key): number | null {
  const found = diatonicScale(key).find((d) => d.pc === pitchClass(pc));
  return found ? found.degree : null;
}

/** Semitone offset of a pitch class from the tonic, 0..11. */
export function scaleOffset(pc: number, key: Key): number {
  return (pitchClass(pc) - pitchClass(key.tonic) + 12) % 12;
}

export function transposeKey(key: Key, semitones: number): Key {
  return { tonic: pitchClass(key.tonic + semitones), mode: key.mode };
}

/** Transposes by a number of fifths, keeping the spelling idiomatic. */
export function transposeKeyByFifths(key: Key, fifths: number): Key {
  return keyFromFifths(keyFifths(key) + fifths, key.mode);
}

export function accidentalCount(key: Key): number {
  return Math.abs(keyFifths(key));
}

/**
 * Picks the simplest spelling for a key that is the given number of semitones
 * away from the original (e.g. +1 from C is Db, not C#).
 */
export function comfortableKey(key: Key, semitones: number): Key {
  const candidates: Key[] = [];
  for (let delta = -6; delta <= 6; delta++) {
    if (((semitones - delta) % 12 + 12) % 12 !== 0) continue;
    candidates.push(transposeKey(key, delta));
  }
  if (candidates.length === 0) return transposeKey(key, semitones);
  candidates.sort((a, b) => accidentalCount(a) - accidentalCount(b));
  return candidates[0];
}

export const ALL_KEYS: Key[] = (() => {
  const keys: Key[] = [];
  for (let tonic = 0; tonic < 12; tonic++) keys.push({ tonic, mode: 'major' });
  for (let tonic = 0; tonic < 12; tonic++) keys.push({ tonic, mode: 'minor' });
  return keys;
})();

export function tonicLetter(key: Key): number {
  return diatonicScale(key)[0].letter;
}

export function keyLetterName(key: Key): string {
  const d = diatonicScale(key)[0];
  const suffix = d.alter > 0 ? '#'.repeat(d.alter) : 'b'.repeat(-d.alter);
  return `${LETTERS[d.letter]}${suffix}`;
}
