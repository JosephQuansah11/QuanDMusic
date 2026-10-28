import { describe, expect, it } from 'vitest';
import { parseMidi, midiToScore } from '../src/import/midi';
import { musicXmlToScore } from '../src/import/musicxml';
import { estimateKey } from '../src/core/keydetect';

type Ev = { delta: number; bytes: number[] };

function track(events: Ev[]): Uint8Array {
  const body: number[] = [];
  for (const event of events) {
    // variable length delta
    let delta = event.delta;
    const stack: number[] = [delta & 0x7f];
    delta >>= 7;
    while (delta > 0) {
      stack.push((delta & 0x7f) | 0x80);
      delta >>= 7;
    }
    body.push(...stack.reverse(), ...event.bytes);
  }
  body.push(0x00, 0xff, 0x2f, 0x00); // end of track
  const length = body.length;
  return new Uint8Array([
    0x4d,
    0x54,
    0x72,
    0x6b,
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...body,
  ]);
}

function midiFile(tracks: Uint8Array[], format = 1): Uint8Array {
  const header = new Uint8Array([
    0x4d,
    0x54,
    0x68,
    0x64,
    0,
    0,
    0,
    6,
    0,
    format,
    0,
    tracks.length,
    0x01,
    0xe0, // 480 ticks per quarter
  ]);
  const parts = tracks.flatMap((t) => Array.from(t));
  return new Uint8Array([...Array.from(header), ...parts]);
}

const META_TEMPO = [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]; // 120 bpm
const META_TIME = [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08]; // 4/4
const META_KEY_EB = [0xff, 0x59, 0x02, 0xfd, 0x00]; // 3 flats, major

describe('MIDI importer', () => {
  it('reads tempo, time signature, key and notes', () => {
    const notes: Ev[] = [
      { delta: 0, bytes: META_TEMPO },
      { delta: 0, bytes: META_TIME },
      { delta: 0, bytes: META_KEY_EB },
      { delta: 0, bytes: [0x90, 60, 100] },
      { delta: 480, bytes: [0x80, 60, 0] },
      { delta: 0, bytes: [0x90, 64, 90] },
      { delta: 960, bytes: [0x80, 64, 0] },
    ];
    const parsed = parseMidi(midiFile([track(notes)]));
    expect(parsed.tempo).toBeCloseTo(120, 5);
    expect(parsed.timeSignature).toEqual({ beats: 4, beatUnit: 4 });
    expect(parsed.keyFifths).toBe(-3);
    expect(parsed.tracks[0].notes).toHaveLength(2);
    expect(parsed.tracks[0].notes[0]).toMatchObject({ midi: 60, start: 0, duration: 1 });
    expect(parsed.tracks[0].notes[1]).toMatchObject({ midi: 64, start: 1, duration: 2 });
  });

  it('assigns four tracks to SATB by register', () => {
    const makeTrack = (pitch: number, name: string): Uint8Array =>
      track([
        { delta: 0, bytes: [0xff, 0x03, name.length, ...Array.from(name).map((c) => c.charCodeAt(0))] },
        { delta: 0, bytes: [0x90, pitch, 100] },
        { delta: 960, bytes: [0x80, pitch, 0] },
      ]);
    const file = midiFile([makeTrack(48, 'low'), makeTrack(72, 'high'), makeTrack(55, 'mid'), makeTrack(64, 'upper')]);
    const score = midiToScore(parseMidi(file), { title: 'Chorale' });
    expect(score.parts.S.notes[0].midi).toBe(72);
    expect(score.parts.A.notes[0].midi).toBe(64);
    expect(score.parts.T.notes[0].midi).toBe(55);
    expect(score.parts.B.notes[0].midi).toBe(48);
    expect(score.title).toBe('Chorale');
    // No key signature meta event: the estimator hears C major from C-E-G-C.
    expect(score.key).toEqual({ tonic: 0, mode: 'major' });
  });

  it('splits a single merged track by voice leading', () => {
    const events: Ev[] = [
      { delta: 0, bytes: [0x90, 60, 100] },
      { delta: 0, bytes: [0x90, 64, 100] },
      { delta: 0, bytes: [0x90, 67, 100] },
      { delta: 0, bytes: [0x90, 72, 100] },
      { delta: 480, bytes: [0x80, 60, 0] },
      { delta: 0, bytes: [0x80, 64, 0] },
      { delta: 0, bytes: [0x80, 67, 0] },
      { delta: 0, bytes: [0x80, 72, 0] },
    ];
    const score = midiToScore(parseMidi(midiFile([track(events)], 0)));
    expect(score.parts.S.notes[0].midi).toBe(72);
    expect(score.parts.A.notes[0].midi).toBe(67);
    expect(score.parts.T.notes[0].midi).toBe(64);
    expect(score.parts.B.notes[0].midi).toBe(60);
  });
});

describe('key detection', () => {
  it('finds C major from a C major scale', () => {
    const notes = [60, 62, 64, 65, 67, 69, 71, 72].map((midi) => ({ midi, duration: 1 }));
    expect(estimateKey(notes).key).toEqual({ tonic: 0, mode: 'major' });
  });

  it('finds A minor from an A minor triad plus scale', () => {
    const notes = [57, 60, 64, 57, 60, 64, 69, 71, 72].map((midi) => ({ midi, duration: 1 }));
    expect(estimateKey(notes).key).toEqual({ tonic: 9, mode: 'minor' });
  });
});
