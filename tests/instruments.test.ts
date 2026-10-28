import { describe, expect, it } from 'vitest';
import {
  concertToWritten,
  getInstrument,
  writtenToConcert,
} from '../src/core/instruments';
import {
  describeKeyOnInstrument,
  fingeringFor,
  flatsDrill,
  scalePractice,
  songPractice,
  writtenKeyFor,
} from '../src/core/fingerings';
import { midiToName } from '../src/core/pitch';

function nameToMidi(name: string): number {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(name);
  if (!match) throw new Error(`bad note name ${name}`);
  const letters: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const alter = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  return 12 * (Number(match[3]) + 1) + letters[match[1]] + alter;
}

describe('instrument transposition', () => {
  const trumpet = getInstrument('trumpet');
  const sax = getInstrument('alto-sax');
  const guitar = getInstrument('guitar');

  it('maps written to sounding pitch', () => {
    expect(writtenToConcert(trumpet, 60)).toBe(58);
    expect(concertToWritten(trumpet, 58)).toBe(60);
    expect(writtenToConcert(sax, 60)).toBe(51);
    expect(writtenToConcert(guitar, 64)).toBe(52);
    expect(writtenKeyFor(trumpet, { tonic: 10, mode: 'major' }).tonic).toBe(0);
    expect(writtenKeyFor(sax, { tonic: 10, mode: 'major' }).tonic).toBe(7);
  });
});

describe('brass fingerings', () => {
  const trumpet = getInstrument('trumpet');
  const trombone = getInstrument('trombone');

  it('matches the standard trumpet valve chart', () => {
    const expected: Record<string, string> = {
      'F#3': '1·2·3',
      G3: '1·3',
      Ab3: '2·3',
      A3: '1·2',
      Bb3: '1',
      B3: '2',
      C4: 'open',
      'C#4': '1·2·3',
      D4: '1·3',
      Eb4: '2·3',
      E4: '1·2',
      F4: '1',
      'F#4': '2',
      G4: 'open',
      Ab4: '2·3',
      A4: '1·2',
      Bb4: '1',
      B4: '2',
      C5: 'open',
      D5: '1',
      Eb5: '2',
      E5: 'open',
      G5: 'open',
    };
    for (const [name, fingering] of Object.entries(expected)) {
      const concert = writtenToConcert(trumpet, nameToMidi(name));
      expect(fingeringFor(trumpet, concert).primary, name).toBe(fingering);
    }
  });

  it('matches the standard trombone slide positions', () => {
    const expected: Record<string, string> = {
      Bb2: '1st position',
      F3: '1st position',
      Bb3: '1st position',
      D4: '1st position',
      Ab3: '3rd position',
      A3: '2nd position',
      C4: '3rd position',
      E2: '7th position',
      F2: '6th position',
    };
    for (const [name, position] of Object.entries(expected)) {
      expect(fingeringFor(trombone, nameToMidi(name)).primary, name).toBe(position);
    }
  });

  it('reports unplayable notes outside the range', () => {
    const result = fingeringFor(trombone, nameToMidi('C6'));
    expect(result.playable).toBe(false);
    expect(result.primary).toBe('unplayable');
  });
});

describe('practice generation', () => {
  const trumpet = getInstrument('trumpet');

  it('builds a written C major scale for concert Bb major with fingerings', () => {
    const scale = scalePractice(trumpet, { tonic: 10, mode: 'major' });
    expect(scale.map((n) => n.writtenName)).toEqual([
      'C4',
      'D4',
      'E4',
      'F4',
      'G4',
      'A4',
      'B4',
      'C5',
    ]);
    expect(scale.map((n) => n.fingering)).toEqual([
      'open',
      '1·3',
      '1·2',
      '1',
      'open',
      '1·2',
      '2',
      'open',
    ]);
    expect(scale.map((n) => n.shortSolfege)).toEqual(['d', 'r', 'm', 'f', 's', 'l', 't', "d'"]);
  });

  it('drills the flat notes with fingerings', () => {
    // Concert C major is written D major for a Bb trumpet, so the drill runs D4..D5.
    const drill = flatsDrill(trumpet, { tonic: 0, mode: 'major' });
    expect(drill.map((n) => n.writtenName)).toEqual(['Eb4', 'Gb4', 'Ab4', 'Bb4', 'Db5']);
    expect(drill[0].fingering).toBe('2·3'); // Eb4
    expect(drill.every((n) => n.playable)).toBe(true);
  });

  it('describes the key on the instrument', () => {
    const info = describeKeyOnInstrument(trumpet, { tonic: 10, mode: 'major' });
    expect(info.writtenKeyName).toBe('C major');
    expect(info.concertKeyName).toBe('Bb major');
    expect(info.lines.join(' ')).toContain('major 2nd lower');
  });

  it('maps a song part onto the instrument', () => {
    const notes = songPractice(trumpet, { tonic: 0, mode: 'major' }, [
      { midi: 58, start: 0, duration: 1 },
      { midi: 60, start: 1, duration: 1 },
    ]);
    expect(notes.map((n) => midiToName(n.writtenMidi))).toEqual(['C4', 'D4']);
    expect(notes[0].fingering).toBe('open');
  });
});

describe('guitar and piano positions', () => {
  const guitar = getInstrument('guitar');
  const piano = getInstrument('piano');

  it('finds the nearest fret with the right string', () => {
    // Written pitch is an octave above sounding pitch, so concert E4 is the open
    // high E string (written E5) and concert E2 is the open low E string.
    expect(fingeringFor(guitar, nameToMidi('E4')).primary).toBe('high E open');
    expect(fingeringFor(guitar, nameToMidi('E2')).primary).toBe('low E open');
    expect(fingeringFor(guitar, nameToMidi('B3')).primary).toBe('B open');
    // Concert A4 is written A5: 5th fret of the high E string.
    const a5 = fingeringFor(guitar, nameToMidi('A4'));
    expect(a5.primary).toBe('high E str, fret 5');
    expect(a5.options[0].string).toBe(0);
    // Concert E3 is written E4: second fret of the D string is the easiest.
    expect(fingeringFor(guitar, nameToMidi('E3')).primary).toBe('D str, fret 2');
  });

  it('names the piano key', () => {
    expect(fingeringFor(piano, 60).primary).toBe('C4');
    expect(fingeringFor(piano, 61).options[0].detail).toBe('black key');
    expect(fingeringFor(piano, 62).options[0].detail).toBe('white key');
  });
});
