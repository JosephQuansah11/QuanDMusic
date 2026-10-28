import { describe, expect, it } from 'vitest';
import { exportMusicXml, spellForXml } from '../src/core/musicxmlExport';
import { musicXmlToScore } from '../src/import/musicxml';
import { emptyScore, createPart, type Score } from '../src/core/score';
import { DEMO_SCORE } from '../src/core/demo';

function compareScores(original: Score, roundTripped: Score) {
  for (const id of ['S', 'A', 'T', 'B'] as const) {
    const a = original.parts[id].notes.map((n) => [n.midi, n.start, n.duration]);
    const b = roundTripped.parts[id].notes.map((n) => [n.midi, n.start, n.duration]);
    expect(b, id).toEqual(a);
  }
}

describe('MusicXML export', () => {
  it('spells notes in the key', () => {
    const eflat = { tonic: 3, mode: 'major' as const };
    expect(spellForXml(63, eflat)).toEqual({ step: 'E', alter: -1, octave: 4 });
    expect(spellForXml(70, eflat)).toEqual({ step: 'B', alter: -1, octave: 4 });
    const gMajor = { tonic: 7, mode: 'major' as const };
    expect(spellForXml(66, gMajor)).toEqual({ step: 'F', alter: 1, octave: 4 });
    // chromatic note in a flat key -> flat spelling
    expect(spellForXml(61, eflat).alter).toBe(-1);
    // chromatic note in a sharp key -> sharp spelling
    expect(spellForXml(61, gMajor).alter).toBe(1);
  });

  it('writes a document that imports back to the same notes', () => {
    const xml = exportMusicXml(DEMO_SCORE);
    expect(xml).toContain('<score-partwise');
    expect(xml).toContain('<part-name>Soprano</part-name>');
    expect(xml).toContain('<fifths>');

    const back = musicXmlToScore(xml);
    expect(back.tempo).toBe(DEMO_SCORE.tempo);
    expect(back.timeSignature).toEqual(DEMO_SCORE.timeSignature);
    expect(back.key).toEqual(DEMO_SCORE.key);
    compareScores(DEMO_SCORE, back);
  });

  it('round trips a score with a chord, a rest and a tie over the bar line', () => {
    const score = emptyScore({ title: 'Round trip', tempo: 88, key: { tonic: 10, mode: 'major' } });
    score.parts.S = createPart('S', [
      { midi: 65, start: 0, duration: 4, velocity: 0.8 },
      { midi: 67, start: 4, duration: 3, velocity: 0.8 },
      { midi: 69, start: 7, duration: 1, velocity: 0.8 },
    ]);
    score.parts.A = createPart('A', [
      { midi: 60, start: 0, duration: 4, velocity: 0.8 },
      { midi: 62, start: 4, duration: 4, velocity: 0.8 },
    ]);
    score.parts.T = createPart('T', [
      { midi: 53, start: 0, duration: 2, velocity: 0.8 },
      { midi: 55, start: 2, duration: 2, velocity: 0.8 },
    ]);
    score.parts.B = createPart('B', [
      { midi: 41, start: 0, duration: 6, velocity: 0.8 },
      { midi: 43, start: 6, duration: 2, velocity: 0.8 },
    ]);

    const back = musicXmlToScore(exportMusicXml(score));
    compareScores(score, back);
  });

  it('exports a single part', () => {
    const xml = exportMusicXml(DEMO_SCORE, { parts: ['S'] });
    expect(xml).toContain('<part-name>Soprano</part-name>');
    expect(xml).not.toContain('<part-name>Bass</part-name>');
  });
});
