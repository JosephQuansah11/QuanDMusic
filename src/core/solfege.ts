/**
 * Solfege ("do re mi") generation.
 *
 * Two systems are supported:
 *  - movable do: the tonic of the current key is always "do"
 *  - fixed do:   C is always "do" (used in many conservatoires)
 *
 * Both a full form ("do re mi fa sol la ti") and the short form the user asked
 * for ("d r m f s l ti do") are produced.
 */

import { pitchClass } from './pitch';
import { type Key, scaleOffset, scaleDegreeOf, diatonicScale } from './keys';

export type SolfegeSystem = 'movable' | 'fixed';
export type SolfegeDisplay = 'full' | 'short';

/** Chromatic syllables for movable do (ascending, the wide-spread convention). */
const MOVABLE_FULL = ['do', 'di', 're', 'me', 'mi', 'fa', 'fi', 'sol', 'si', 'la', 'te', 'ti'];
const MOVABLE_SHORT = ['d', 'di', 'r', 'me', 'm', 'f', 'fi', 's', 'si', 'l', 'te', 't'];

/** Fixed do: C = do, so the syllables map straight onto pitch classes. */
const FIXED_FULL = ['do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'sol', 'si', 'la', 'li', 'ti'];
const FIXED_SHORT = ['d', 'di', 'r', 'ri', 'm', 'f', 'fi', 's', 'si', 'l', 'li', 't'];

export interface SolfegeResult {
  /** Full syllable, e.g. "sol". */
  syllable: string;
  /** Short syllable, e.g. "s". */
  short: string;
  /** Diatonic degree 1..7, or null for chromatic notes. */
  degree: number | null;
  /** Octave marks: positive = higher than the reference, negative = lower. */
  octave: number;
}

export function solfegeFor(midi: number, key: Key, system: SolfegeSystem = 'movable'): SolfegeResult {
  const pc = pitchClass(midi);
  const full = system === 'movable' ? MOVABLE_FULL : FIXED_FULL;
  const short = system === 'movable' ? MOVABLE_SHORT : FIXED_SHORT;
  const step = system === 'movable' ? scaleOffset(pc, key) : pc;

  // Reference note: tonic of the key (movable) or C (fixed) near middle C.
  const referencePc = system === 'movable' ? pitchClass(key.tonic) : 0;
  const referenceMidi = 60 + ((referencePc - 60) % 12 + 12) % 12;
  const octave = Math.floor((midi - referenceMidi) / 12);

  return {
    syllable: full[step],
    short: short[step],
    degree: system === 'movable' ? scaleDegreeOf(pc, key) : degreeInCMajor(pc),
    octave,
  };
}

function degreeInCMajor(pc: number): number | null {
  const table: Record<number, number> = { 0: 1, 2: 2, 4: 3, 5: 4, 7: 5, 9: 6, 11: 7 };
  return table[pc] ?? null;
}

export function octaveMarks(octave: number): string {
  if (octave === 0) return '';
  return octave > 0 ? "'".repeat(octave) : ','.repeat(-octave);
}

export interface SolfegeTextOptions {
  system?: SolfegeSystem;
  display?: SolfegeDisplay;
  /** Show octave marks (default true). */
  marks?: boolean;
}

/** Human readable solfege label, e.g. "sol'" (full) or "s'" (short). */
export function solfegeText(midi: number, key: Key, options: SolfegeTextOptions = {}): string {
  const { system = 'movable', display = 'full', marks = true } = options;
  const result = solfegeFor(midi, key, system);
  const base = display === 'short' ? result.short : result.syllable;
  const suffix = marks ? octaveMarks(result.octave) : '';
  return `${base}${suffix}`;
}

/** The seven syllables of the key's scale, low to high. */
export function scaleSyllables(key: Key, display: SolfegeDisplay = 'full'): string[] {
  return diatonicScale(key).map((d) => {
    const step = scaleOffset(d.pc, key);
    return display === 'short' ? MOVABLE_SHORT[step] : MOVABLE_FULL[step];
  });
}

/** Solfege syllable for a scale degree (1..7). */
export function syllableForDegree(degree: number, display: SolfegeDisplay = 'full'): string {
  const table = display === 'short' ? MOVABLE_SHORT : MOVABLE_FULL;
  const steps = [0, 2, 4, 5, 7, 9, 11];
  return table[steps[((degree - 1) % 7 + 7) % 7]];
}

export const SOLFEGE_SYLLABLES_FULL = MOVABLE_FULL;
export const SOLFEGE_SYLLABLES_SHORT = MOVABLE_SHORT;
