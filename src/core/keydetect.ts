/**
 * Key detection with the Krumhansl-Schmuckler profiles.
 *
 * Works on any pitch-class histogram, which lets the MIDI importer and the
 * audio analyser share exactly the same estimator.
 */

import { pitchClass } from './pitch';
import { keyFifths, type Key } from './keys';

/** Krumhansl-Kessler probe-tone ratings for major and minor keys. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface KeyCandidate {
  key: Key;
  score: number;
}

export interface KeyEstimate {
  key: Key;
  /** 0..1, how clearly the winning key beat the runner-up. */
  confidence: number;
  alternatives: KeyCandidate[];
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA === 0 || denB === 0) return 0;
  return num / Math.sqrt(denA * denB);
}

function rotate(profile: number[], tonic: number): number[] {
  const out = new Array<number>(12);
  for (let pc = 0; pc < 12; pc++) out[pc] = profile[((pc - tonic) % 12 + 12) % 12];
  return out;
}

export function estimateKeyFromChroma(chroma: number[]): KeyEstimate {
  if (chroma.length !== 12) throw new Error('chroma must have 12 bins');
  const total = chroma.reduce((s, v) => s + v, 0);
  const normalised = total > 0 ? chroma.map((v) => v / total) : chroma.slice();

  const candidates: KeyCandidate[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    const major = pearson(normalised, rotate(MAJOR_PROFILE, tonic));
    const minor = pearson(normalised, rotate(MINOR_PROFILE, tonic));
    candidates.push({ key: { tonic, mode: 'major' }, score: major });
    candidates.push({ key: { tonic, mode: 'minor' }, score: minor });
  }
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const second = candidates[1];
  const spread = Math.max(1e-6, Math.abs(best.score));
  const relative = (best.score - second.score) / spread;
  return {
    key: best.key,
    confidence: Math.max(0, Math.min(1, relative * 2.5)),
    alternatives: candidates.slice(0, 5),
  };
}

export interface ChromaNote {
  midi: number;
  duration: number;
  velocity?: number;
}

/** Duration-weighted pitch-class histogram, with a gentle boost for bass notes. */
export function chromaFromNotes(notes: ChromaNote[]): number[] {
  const chroma = new Array(12).fill(0);
  for (const note of notes) {
    const weight = Math.max(0.05, note.duration) * (note.velocity ?? 1);
    chroma[pitchClass(note.midi)] += weight;
    if (note.midi < 55) chroma[pitchClass(note.midi)] += weight * 0.5;
  }
  return chroma;
}

export function estimateKey(notes: ChromaNote[]): KeyEstimate {
  return estimateKeyFromChroma(chromaFromNotes(notes));
}

/** Keys that are easy to read, used when suggesting a comfortable transposition. */
export function isComfortableKey(key: Key): boolean {
  return Math.abs(keyFifths(key)) <= 3;
}
