import { describe, expect, it } from 'vitest';
import {
  accidentalToString,
  frequencyToMidi,
  midiToFrequency,
  midiToName,
  spelledPitchToMidi,
  type SpelledPitch,
} from '../src/core/pitch';
import {
  comfortableKey,
  diatonicScale,
  keyFifths,
  keyFromFifths,
  keyName,
  keySignatureAccidentals,
  scalePitchClasses,
  transposeKey,
  vexKeySpec,
} from '../src/core/keys';
import { solfegeFor, solfegeText, syllableForDegree } from '../src/core/solfege';
import {
  beatsPerMeasure,
  chordGroups,
  createPart,
  emptyScore,
  noteValue,
  splitAtBarLines,
  transposeScore,
} from '../src/core/score';

describe('pitch', () => {
  it('converts between midi and frequency', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6);
    expect(midiToFrequency(60)).toBeCloseTo(261.6256, 3);
    expect(frequencyToMidi(440)).toBeCloseTo(69, 6);
  });

  it('names notes with scientific octaves', () => {
    expect(midiToName(60)).toBe('C4');
    expect(midiToName(69)).toBe('A4');
    expect(midiToName(61, true)).toBe('Db4');
  });

  it('round trips spelled pitches', () => {
    const pitches: SpelledPitch[] = [
      { letter: 2, alter: -1, octave: 4 }, // Eb4
      { letter: 6, alter: 1, octave: 3 }, // B#3
      { letter: 0, alter: 0, octave: 4 },
    ];
    expect(pitches.map(spelledPitchToMidi)).toEqual([63, 60, 60]);
    expect(accidentalToString(-2)).toBe('bb');
    expect(accidentalToString(2)).toBe('##');
  });
});

describe('keys', () => {
  it('computes key signatures on the circle of fifths', () => {
    expect(keyFifths({ tonic: 0, mode: 'major' })).toBe(0);
    expect(keyFifths({ tonic: 10, mode: 'major' })).toBe(-2);
    expect(keyFifths({ tonic: 6, mode: 'major' })).toBe(6);
    expect(keyFifths({ tonic: 9, mode: 'minor' })).toBe(0); // A minor
    expect(keyFifths({ tonic: 10, mode: 'minor' })).toBe(-5); // Bb minor
    expect(keyName({ tonic: 3, mode: 'major' })).toBe('Eb major');
    expect(keyName({ tonic: 9, mode: 'minor' })).toBe('A minor');
    expect(keyFromFifths(-3, 'major')).toEqual({ tonic: 3, mode: 'major' });
    expect(vexKeySpec({ tonic: 6, mode: 'minor' })).toBe('F#m');
    expect(vexKeySpec({ tonic: 2, mode: 'minor' })).toBe('Dm');
  });

  it('spells the key signature in the traditional order', () => {
    expect(keySignatureAccidentals({ tonic: 2, mode: 'major' }).map((a) => a.letter)).toEqual([3, 0]);
    expect(keySignatureAccidentals({ tonic: 3, mode: 'major' }).map((a) => a.pc)).toEqual([10, 3, 8]);
  });

  it('spells diatonic scales correctly in awkward keys', () => {
    const eb = diatonicScale({ tonic: 3, mode: 'major' });
    expect(eb.map((d) => [d.letter, d.alter])).toEqual([
      [2, -1],
      [3, 0],
      [4, 0],
      [5, -1],
      [6, -1],
      [0, 0],
      [1, 0],
    ]);
    const fsharp = diatonicScale({ tonic: 6, mode: 'major' });
    expect(fsharp.map((d) => [d.letter, d.alter])).toEqual([
      [3, 1],
      [4, 1],
      [5, 1],
      [6, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ]);
    const aminor = diatonicScale({ tonic: 9, mode: 'minor' });
    expect(aminor.map((d) => d.pc)).toEqual([9, 11, 0, 2, 4, 5, 7]);
  });

  it('transposes keys and picks simple spellings', () => {
    expect(transposeKey({ tonic: 10, mode: 'major' }, 2)).toEqual({ tonic: 0, mode: 'major' });
    expect(comfortableKey({ tonic: 0, mode: 'major' }, 1).tonic).toBe(1); // Db, not C#
    expect(keyFifths(comfortableKey({ tonic: 0, mode: 'major' }, 1))).toBe(-5);
    expect(scalePitchClasses({ tonic: 7, mode: 'major' })).toEqual([7, 9, 11, 0, 2, 4, 6]);
  });
});

describe('solfege', () => {
  it('uses movable do relative to the key', () => {
    const cMajor = { tonic: 0, mode: 'major' as const };
    expect(solfegeFor(60, cMajor, 'movable').syllable).toBe('do');
    expect(solfegeFor(62, cMajor, 'movable').syllable).toBe('re');
    expect(solfegeFor(67, cMajor, 'movable').syllable).toBe('sol');
    expect(solfegeFor(71, cMajor, 'movable').syllable).toBe('ti');
    const dMajor = { tonic: 2, mode: 'major' as const };
    expect(solfegeFor(62, dMajor, 'movable').syllable).toBe('do');
    expect(solfegeFor(66, dMajor, 'movable').syllable).toBe('mi');
    expect(solfegeFor(69, dMajor, 'movable').syllable).toBe('sol');
  });

  it('uses fixed do anchored on C', () => {
    expect(solfegeFor(62, { tonic: 2, mode: 'major' }, 'fixed').syllable).toBe('re');
    expect(solfegeFor(70, { tonic: 10, mode: 'major' }, 'fixed').syllable).toBe('li');
    expect(solfegeFor(68, { tonic: 10, mode: 'major' }, 'fixed').syllable).toBe('si');
  });

  it('produces the short d r m f s l t form', () => {
    const cMajor = { tonic: 0, mode: 'major' as const };
    const short = [60, 62, 64, 65, 67, 69, 71].map((m) => solfegeFor(m, cMajor, 'movable').short);
    expect(short).toEqual(['d', 'r', 'm', 'f', 's', 'l', 't']);
    expect(syllableForDegree(7, 'short')).toBe('t');
    expect(syllableForDegree(1, 'short')).toBe('d');
  });

  it('adds octave marks', () => {
    const cMajor = { tonic: 0, mode: 'major' as const };
    expect(solfegeText(72, cMajor, { display: 'short' })).toBe("d'");
    expect(solfegeText(48, cMajor, { display: 'short' })).toBe('d,');
    expect(solfegeText(59, cMajor, { display: 'short' })).toBe('t,');
  });

  it('names chromatic notes', () => {
    const cMajor = { tonic: 0, mode: 'major' as const };
    expect(solfegeFor(61, cMajor, 'movable').syllable).toBe('di');
    expect(solfegeFor(63, cMajor, 'movable').syllable).toBe('me');
    expect(solfegeFor(70, cMajor, 'movable').syllable).toBe('te');
    expect(solfegeFor(61, cMajor, 'movable').degree).toBeNull();
  });
});

describe('score model', () => {
  it('computes bar lengths and note values', () => {
    expect(beatsPerMeasure({ beats: 4, beatUnit: 4 })).toBe(4);
    expect(beatsPerMeasure({ beats: 6, beatUnit: 8 })).toBe(3);
    expect(noteValue(1).code).toBe('q');
    expect(noteValue(1.5)).toEqual({ code: 'q', dots: 1, beats: 1.5 });
    expect(noteValue(0.5).code).toBe('8');
    expect(noteValue(3)).toEqual({ code: 'h', dots: 1, beats: 3 });
  });

  it('groups chords and splits across bar lines', () => {
    const part = createPart('S', [
      { midi: 60, start: 0, duration: 2, velocity: 0.8 },
      { midi: 64, start: 0, duration: 2, velocity: 0.8 },
      { midi: 67, start: 2, duration: 4, velocity: 0.8 },
    ]);
    expect(chordGroups(part.notes).map((g) => g.midis)).toEqual([[60, 64], [67]]);
    const split = splitAtBarLines(part, { beats: 4, beatUnit: 4 });
    expect(split.map((n) => [n.start, n.duration])).toEqual([
      [0, 2],
      [0, 2],
      [2, 2],
      [4, 2],
    ]);
  });

  it('transposes notes and the key together', () => {
    const score = emptyScore({ key: { tonic: 0, mode: 'major' } });
    score.parts.S = createPart('S', [{ midi: 60, start: 0, duration: 1, velocity: 1 }]);
    const up = transposeScore(score, 2);
    expect(up.parts.S.notes[0].midi).toBe(62);
    expect(up.key.tonic).toBe(2);
  });
});
