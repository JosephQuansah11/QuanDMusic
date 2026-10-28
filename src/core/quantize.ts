/**
 * Rhythm quantisation shared by the MIDI importer and the audio analyser.
 *
 * Everything is expressed in quarter-note beats, so a grid of 0.25 means
 * sixteenth notes.
 */

import { mergeTiedNotes, sortNotes, type NoteEvent } from './score';

export interface QuantizeOptions {
  /** Grid step in beats (0.25 = sixteenth notes). */
  grid?: number;
  /** Shortest allowed note in beats. */
  minDuration?: number;
  /** 0..1 blend between the original position and the grid. */
  strength?: number;
}

export function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

export function quantizeBeat(value: number, grid = 0.25, strength = 1): number {
  const snapped = snap(value, grid);
  return value + (snapped - value) * Math.max(0, Math.min(1, strength));
}

export function quantizeNotes(notes: NoteEvent[], options: QuantizeOptions = {}): NoteEvent[] {
  const grid = options.grid ?? 0.25;
  const minDuration = options.minDuration ?? grid;
  const strength = options.strength ?? 1;

  const quantized = notes.map((note) => {
    const start = Math.max(0, quantizeBeat(note.start, grid, strength));
    let duration = Math.max(minDuration, quantizeBeat(note.duration, grid, strength));
    // Never let a note run past the next grid line after its rounded start.
    duration = Math.max(minDuration, snap(duration, minDuration));
    return { ...note, start: snap(start, 1e-3), duration: snap(duration, 1e-3) };
  });

  return mergeTiedNotes(sortNotes(quantized), 1e-3);
}

/** Removes overlaps inside one monophonic voice. */
export function trimOverlaps(notes: NoteEvent[]): NoteEvent[] {
  const sorted = sortNotes(notes);
  for (let i = 0; i < sorted.length - 1; i++) {
    const end = sorted[i].start + sorted[i].duration;
    if (end > sorted[i + 1].start) {
      sorted[i].duration = Math.max(0.05, sorted[i + 1].start - sorted[i].start);
    }
  }
  return sorted;
}

/** Snaps a list of onset times (in seconds) to a beat grid. */
export function quantizeOnsetSeconds(seconds: number, tempo: number, grid = 0.25): number {
  const beats = (seconds * tempo) / 60;
  return (snap(beats, grid) * 60) / tempo;
}

export interface RhythmTemplate {
  label: string;
  /** Duration pattern in beats. */
  pattern: number[];
}

export const RHYTHM_TEMPLATES: RhythmTemplate[] = [
  { label: 'Straight quarters', pattern: [1, 1, 1, 1] },
  { label: 'Eighth pairs', pattern: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5] },
  { label: 'Long-short', pattern: [1.5, 0.5, 1.5, 0.5] },
  { label: 'Short-long', pattern: [0.5, 1.5, 0.5, 1.5] },
  { label: 'Half notes', pattern: [2, 2] },
];

/**
 * Best matching template for a run of note durations, used to show learners
 * what the rhythm of a part actually is.
 */
export function matchRhythmTemplate(durations: number[]): { template: RhythmTemplate; score: number } {
  const total = durations.reduce((s, d) => s + d, 0);
  let best = { template: RHYTHM_TEMPLATES[0], score: Infinity };
  for (const template of RHYTHM_TEMPLATES) {
    const templateTotal = template.pattern.reduce((s, d) => s + d, 0);
    // Compare the rhythmic shape, not the absolute length.
    const normalised = durations.map((d) => d / Math.max(total, 1e-6));
    const templateNormalised = template.pattern.map((d) => d / templateTotal);
    const length = Math.min(normalised.length, templateNormalised.length);
    let score = Math.abs(normalised.length - templateNormalised.length) * 0.5;
    for (let i = 0; i < length; i++) score += Math.abs(normalised[i] - templateNormalised[i]);
    if (score < best.score) best = { template, score };
  }
  return best;
}
