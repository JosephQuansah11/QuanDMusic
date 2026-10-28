/**
 * Built-in demo material so the app is usable (and testable) with no uploads.
 *
 * The demo is a short four-part chorale in C major. Rendering it to audio and
 * feeding that audio back through the analyser is the fastest way to show the
 * whole pipeline working offline.
 */

import { createPart, emptyScore, type NoteEvent, type Score } from './score';

function notes(entries: [number, number, number, number][]): NoteEvent[] {
  return entries.map(([midi, start, duration, velocity]) => ({ midi, start, duration, velocity }));
}

const CHORDS: [number, number, number, number, number][] = [
  // [start beat, soprano, alto, tenor, bass]
  [0, 64, 60, 55, 48], // C
  [2, 60, 57, 52, 45], // Am
  [4, 65, 60, 57, 41], // F
  [6, 62, 59, 55, 43], // G
  [8, 64, 60, 55, 48], // C
  [10, 64, 59, 52, 40], // Em
  [12, 65, 60, 57, 41], // F
  [14, 62, 59, 55, 43], // G
];

function chordNotes(index: 1 | 2 | 3 | 4, duration: number): NoteEvent[] {
  return CHORDS.map(([start, s, a, t, b]) => {
    const pitches = [s, a, t, b] as const;
    return { midi: pitches[index - 1], start, duration, velocity: 0.8 };
  });
}

/** Four bars of block chords. */
function choraleBars(): Record<'S' | 'A' | 'T' | 'B', NoteEvent[]> {
  return {
    S: chordNotes(1, 2),
    A: chordNotes(2, 2),
    T: chordNotes(3, 2),
    B: chordNotes(4, 2),
  };
}

/** Second half: a moving soprano line over sustained lower voices. */
function movingBars(): Record<'S' | 'A' | 'T' | 'B', NoteEvent[]> {
  return {
    S: notes([
      [64, 16, 1, 0.85],
      [65, 17, 1, 0.85],
      [67, 18, 1, 0.85],
      [69, 19, 1, 0.85],
      [67, 20, 1, 0.85],
      [65, 21, 1, 0.85],
      [64, 22, 1, 0.85],
      [62, 23, 1, 0.85],
      [60, 24, 2, 0.85],
      [62, 26, 2, 0.85],
      [64, 28, 2, 0.85],
      [65, 30, 2, 0.85],
    ]),
    A: notes([
      [60, 16, 4, 0.75],
      [57, 20, 4, 0.75],
      [57, 24, 4, 0.75],
      [60, 28, 4, 0.75],
    ]),
    T: notes([
      [52, 16, 4, 0.75],
      [52, 20, 4, 0.75],
      [53, 24, 4, 0.75],
      [55, 28, 4, 0.75],
    ]),
    B: notes([
      [45, 16, 4, 0.8],
      [45, 20, 4, 0.8],
      [50, 24, 4, 0.8],
      [43, 28, 4, 0.8],
    ]),
  };
}

export function createDemoScore(): Score {
  const first = choraleBars();
  const second = movingBars();
  const score = emptyScore({
    title: 'QuanD Demo Chorale',
    composer: 'QuanDMusic',
    tempo: 96,
    timeSignature: { beats: 4, beatUnit: 4 },
    key: { tonic: 0, mode: 'major' },
    source: 'demo',
    notes: 'Four-part chorale: block chords, then a moving soprano line.',
  });
  for (const id of ['S', 'A', 'T', 'B'] as const) {
    score.parts[id] = createPart(id, [...first[id], ...second[id]]);
  }
  return score;
}

export const DEMO_SCORE: Score = createDemoScore();
