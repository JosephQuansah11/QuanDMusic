/**
 * The score model used across the whole app.
 *
 * A score is a flat event list per voice, measured in quarter-note beats.
 * That keeps analysis, quantisation, transposition and rendering independent
 * from each other.
 */

import { pitchClass } from './pitch';
import type { Key } from './keys';

export const PART_IDS = ['S', 'A', 'T', 'B'] as const;
export type PartId = (typeof PART_IDS)[number];

export const PART_NAMES: Record<PartId, string> = {
  S: 'Soprano',
  A: 'Alto',
  T: 'Tenor',
  B: 'Bass',
};

/** Comfortable singing ranges, used by the voice-leading assigner. */
export const PART_RANGES: Record<PartId, { low: number; high: number; center: number }> = {
  S: { low: 58, high: 82, center: 72 }, // Bb3 - Bb5
  A: { low: 53, high: 76, center: 66 }, // F3 - E5
  T: { low: 45, high: 69, center: 59 }, // A2 - A4
  B: { low: 38, high: 64, center: 50 }, // D2 - E4
};

export type ScoreSource = 'audio' | 'midi' | 'musicxml' | 'demo';

export interface NoteEvent {
  /** MIDI note number, C4 = 60. */
  midi: number;
  /** Start in quarter-note beats from the beginning of the score. */
  start: number;
  /** Length in quarter-note beats. */
  duration: number;
  /** 0..1 */
  velocity: number;
}

export interface Part {
  id: PartId;
  name: string;
  notes: NoteEvent[];
}

export interface TimeSignature {
  /** Numerator, e.g. 4 for 4/4. */
  beats: number;
  /** Denominator, e.g. 4 for 4/4. */
  beatUnit: number;
}

export interface Score {
  title: string;
  composer: string;
  /** Quarter notes per minute. */
  tempo: number;
  timeSignature: TimeSignature;
  key: Key;
  source: ScoreSource;
  parts: Record<PartId, Part>;
  /** Extra information coming from the importer/analyser. */
  notes?: string;
  /** Beat tracking confidence (audio analysis), 0..1. */
  confidence?: number;
  createdAt?: number;
}

export const DEFAULT_TIME_SIGNATURE: TimeSignature = { beats: 4, beatUnit: 4 };

export function beatsPerMeasure(ts: TimeSignature): number {
  return (ts.beats * 4) / ts.beatUnit;
}

export function createPart(id: PartId, notes: NoteEvent[] = []): Part {
  return { id, name: PART_NAMES[id], notes: [...notes].sort((a, b) => a.start - b.start || b.midi - a.midi) };
}

export function emptyScore(overrides: Partial<Score> = {}): Score {
  const parts = {} as Record<PartId, Part>;
  for (const id of PART_IDS) parts[id] = createPart(id);
  return {
    title: 'Untitled',
    composer: '',
    tempo: 100,
    timeSignature: { ...DEFAULT_TIME_SIGNATURE },
    key: { tonic: 0, mode: 'major' },
    source: 'demo',
    parts,
    createdAt: Date.now(),
    ...overrides,
  };
}

export function totalBeats(score: Score): number {
  let max = 0;
  for (const id of PART_IDS) {
    for (const note of score.parts[id].notes) {
      max = Math.max(max, note.start + note.duration);
    }
  }
  return max;
}

export function beatDurationSeconds(tempo: number): number {
  return 60 / Math.max(1, tempo);
}

export function durationSeconds(score: Score): number {
  return totalBeats(score) * beatDurationSeconds(score.tempo);
}

export function measureIndexAt(beat: number, ts: TimeSignature): number {
  return Math.max(0, Math.floor(beat / beatsPerMeasure(ts)));
}

export function measureCount(score: Score): number {
  return Math.max(1, Math.ceil(totalBeats(score) / beatsPerMeasure(score.timeSignature) - 1e-9));
}

export function beatInMeasure(beat: number, ts: TimeSignature): number {
  const bpm = beatsPerMeasure(ts);
  return ((beat % bpm) + bpm) % bpm;
}

export function sortNotes(notes: NoteEvent[]): NoteEvent[] {
  return [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
}

export function cloneScore(score: Score): Score {
  const parts = {} as Record<PartId, Part>;
  for (const id of PART_IDS) {
    parts[id] = { ...score.parts[id], notes: score.parts[id].notes.map((n) => ({ ...n })) };
  }
  return { ...score, key: { ...score.key }, timeSignature: { ...score.timeSignature }, parts };
}

/** Transposes every note and the key by a number of semitones. */
export function transposeScore(score: Score, semitones: number): Score {
  if (semitones === 0) return score;
  const next = cloneScore(score);
  for (const id of PART_IDS) {
    next.parts[id].notes = next.parts[id].notes.map((n) => ({ ...n, midi: n.midi + semitones }));
  }
  next.key = { tonic: pitchClass(score.key.tonic + semitones), mode: score.key.mode };
  return next;
}

export interface NoteValue {
  /** VexFlow duration code: w, h, q, 8, 16, 32. */
  code: 'w' | 'h' | 'q' | '8' | '16' | '32';
  dots: number;
  /** Rendered length in beats, used to detect inexact durations. */
  beats: number;
}

const NOTE_VALUES: NoteValue[] = [
  { code: 'w', dots: 0, beats: 4 },
  { code: 'h', dots: 1, beats: 3 },
  { code: 'h', dots: 0, beats: 2 },
  { code: 'q', dots: 1, beats: 1.5 },
  { code: 'q', dots: 0, beats: 1 },
  { code: '8', dots: 1, beats: 0.75 },
  { code: '8', dots: 0, beats: 0.5 },
  { code: '16', dots: 1, beats: 0.375 },
  { code: '16', dots: 0, beats: 0.25 },
  { code: '32', dots: 0, beats: 0.125 },
];

/** Nearest engraved note value for a duration in beats. */
export function noteValue(duration: number): NoteValue {
  let best = NOTE_VALUES[NOTE_VALUES.length - 1];
  let bestDiff = Infinity;
  for (const value of NOTE_VALUES) {
    const diff = Math.abs(value.beats - duration);
    if (diff < bestDiff) {
      best = value;
      bestDiff = diff;
    }
  }
  return best;
}

export function noteValueName(duration: number): string {
  const { code, dots } = noteValue(duration);
  const names: Record<string, string> = {
    w: 'whole',
    h: 'half',
    q: 'quarter',
    '8': 'eighth',
    '16': 'sixteenth',
    '32': 'thirty-second',
  };
  return dots > 0 ? `dotted ${names[code]}` : names[code];
}

/** Splits notes so that no note crosses a bar line. */
export function splitAtBarLines(part: Part, ts: TimeSignature): NoteEvent[] {
  const bpm = beatsPerMeasure(ts);
  const out: NoteEvent[] = [];
  for (const note of part.notes) {
    let start = note.start;
    let remaining = note.duration;
    let guard = 0;
    while (remaining > 1e-6 && guard++ < 64) {
      const nextBar = (Math.floor(start / bpm) + 1) * bpm;
      const chunk = Math.min(remaining, nextBar - start);
      out.push({ ...note, start, duration: chunk });
      start += chunk;
      remaining -= chunk;
    }
  }
  return out;
}

export interface ChordGroup {
  start: number;
  duration: number;
  midis: number[];
  velocity: number;
}

/** Groups notes that start together into chords (for rendering). */
export function chordGroups(notes: NoteEvent[]): ChordGroup[] {
  const groups: ChordGroup[] = [];
  for (const note of sortNotes(notes)) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.start - note.start) < 1e-4) {
      last.midis.push(note.midi);
      last.duration = Math.max(last.duration, note.duration);
      last.velocity = Math.max(last.velocity, note.velocity);
    } else {
      groups.push({ start: note.start, duration: note.duration, midis: [note.midi], velocity: note.velocity });
    }
  }
  for (const group of groups) group.midis = Array.from(new Set(group.midis)).sort((a, b) => a - b);
  return groups;
}

export function partRange(part: Part): { low: number; high: number } | null {
  if (part.notes.length === 0) return null;
  let low = 127;
  let high = 0;
  for (const note of part.notes) {
    low = Math.min(low, note.midi);
    high = Math.max(high, note.midi);
  }
  return { low, high };
}

export function isScoreEmpty(score: Score): boolean {
  return PART_IDS.every((id) => score.parts[id].notes.length === 0);
}

export function allNotes(score: Score): NoteEvent[] {
  return PART_IDS.flatMap((id) => score.parts[id].notes);
}

/** Merges consecutive notes of the same pitch that touch each other. */
export function mergeTiedNotes(notes: NoteEvent[], tolerance = 1e-3): NoteEvent[] {
  const sorted = sortNotes(notes);
  const out: NoteEvent[] = [];
  for (const note of sorted) {
    const last = out[out.length - 1];
    if (last && last.midi === note.midi && Math.abs(last.start + last.duration - note.start) < tolerance) {
      last.duration += note.duration;
    } else {
      out.push({ ...note });
    }
  }
  return out;
}

export function slicePart(part: Part, fromBeat: number, toBeat: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const note of part.notes) {
    const start = Math.max(note.start, fromBeat);
    const end = Math.min(note.start + note.duration, toBeat);
    if (end - start <= 1e-6) continue;
    out.push({ ...note, start: start - fromBeat, duration: end - start });
  }
  return out;
}
