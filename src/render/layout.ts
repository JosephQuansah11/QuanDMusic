/**
 * Pure layout helpers for the engraved score.
 *
 * Keeping this separate from VexFlow makes the bar/split logic testable
 * without a DOM.
 */

import {
  beatsPerMeasure,
  sortNotes,
  type NoteEvent,
  type Part,
  type TimeSignature,
} from '../core/score';

export interface MeasureChunk {
  index: number;
  startBeat: number;
  endBeat: number;
  /** Notes that start inside this measure, clipped to the bar line. */
  notes: NoteEvent[];
}

/** Splits a part into per-measure chunks, clipping notes at bar lines. */
export function chunkMeasures(part: Part, ts: TimeSignature, measures?: number): MeasureChunk[] {
  const bpm = beatsPerMeasure(ts);
  const end = part.notes.reduce((max, note) => Math.max(max, note.start + note.duration), 0);
  const total = measures ?? Math.max(1, Math.ceil(end / bpm - 1e-9));
  const chunks: MeasureChunk[] = [];

  for (let index = 0; index < total; index++) {
    const startBeat = index * bpm;
    const endBeat = startBeat + bpm;
    const notes: NoteEvent[] = [];
    for (const note of sortNotes(part.notes)) {
      const from = Math.max(note.start, startBeat);
      const to = Math.min(note.start + note.duration, endBeat);
      if (to - from <= 1e-6) continue;
      notes.push({ ...note, start: from - startBeat, duration: to - from });
    }
    chunks.push({ index, startBeat, endBeat, notes });
  }

  return chunks;
}

/** Splits the bars of a piece into lines that fit the page. */
export function systemsForMeasureCount(measureCountValue: number, measuresPerSystem: number): number[][] {
  const systems: number[][] = [];
  const perSystem = Math.max(1, measuresPerSystem);
  for (let start = 0; start < measureCountValue; start += perSystem) {
    const line: number[] = [];
    for (let m = start; m < Math.min(measureCountValue, start + perSystem); m++) line.push(m);
    systems.push(line);
  }
  return systems.length > 0 ? systems : [[0]];
}

export interface CursorPoint {
  x: number;
  y: number;
  height: number;
}

/**
 * Horizontal position of a beat inside the engraved page.
 * `measureX` returns the left edge of a measure in its system.
 */
export function beatToCursor(
  beat: number,
  ts: TimeSignature,
  systems: number[][],
  measureX: (measureIndex: number) => number,
  measureWidth: number,
  staffTop: (measureIndex: number) => number,
  staffHeight: number,
): CursorPoint | null {
  const bpm = beatsPerMeasure(ts);
  const measureIndex = Math.floor(beat / bpm);
  const systemIndex = systems.findIndex((line) => line.includes(measureIndex));
  if (systemIndex === -1) return null;
  const inMeasure = beat - measureIndex * bpm;
  const x = measureX(measureIndex) + (inMeasure / bpm) * measureWidth;
  return { x, y: staffTop(measureIndex), height: staffHeight };
}

/** Which beat a click at (x, y) corresponds to. */
export function pointToBeat(
  x: number,
  y: number,
  systems: number[][],
  measureWidth: number,
  leftMargin: number,
  rowTop: (systemIndex: number) => number,
  rowHeight: number,
  bpm: number,
): number | null {
  const systemIndex = systems.findIndex((_, index) => y >= rowTop(index) && y < rowTop(index) + rowHeight);
  if (systemIndex === -1) return null;
  const column = Math.floor((x - leftMargin) / measureWidth);
  const line = systems[systemIndex];
  if (column < 0 || column >= line.length) return null;
  const measureIndex = line[column];
  const fraction = Math.min(1, Math.max(0, (x - leftMargin - column * measureWidth) / measureWidth));
  return measureIndex * bpm + fraction * bpm;
}

