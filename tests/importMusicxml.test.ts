import { describe, expect, it } from 'vitest';
import { musicXmlToScore } from '../src/import/musicxml';
import { parseXml } from '../src/import/xml';

const CHORALE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>QuanD Chorale</work-title></work>
  <identification><creator type="composer">A. Composer</creator></identification>
  <part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
    <score-part id="P2"><part-name>Alto</part-name></score-part>
    <score-part id="P3"><part-name>Tenor</part-name></score-part>
    <score-part id="P4"><part-name>Bass</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>2</divisions>
        <key><fifths>-2</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <sound tempo="92"/>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><type>half</type></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
      <note><pitch><step>A</step><alter>1</alter><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>
    </measure>
  </part>
  <part id="P2">
    <measure number="1">
      <attributes><divisions>2</divisions></attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>half</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration></note>
    </measure>
  </part>
  <part id="P3">
    <measure number="1">
      <attributes><divisions>2</divisions><clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef></attributes>
      <note><pitch><step>B</step><octave>3</octave></pitch><duration>4</duration></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration></note>
    </measure>
  </part>
  <part id="P4">
    <measure number="1">
      <attributes><divisions>2</divisions><clef><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>B</step><alter>-1</alter><octave>2</octave></pitch><duration>4</duration></note>
      <note><pitch><step>F</step><octave>2</octave></pitch><duration>4</duration></note>
    </measure>
  </part>
</score-partwise>`;

describe('XML reader', () => {
  it('parses nested elements and attributes', () => {
    const root = parseXml('<a x="1"><b>text</b><c/></a>');
    const a = root.children[0];
    expect(a.name).toBe('a');
    expect(a.attrs.x).toBe('1');
    expect(a.children[0].text).toBe('text');
    expect(a.children[1].name).toBe('c');
  });
});

describe('MusicXML importer', () => {
  const score = musicXmlToScore(CHORALE);

  it('reads metadata', () => {
    expect(score.title).toBe('QuanD Chorale');
    expect(score.composer).toBe('A. Composer');
    expect(score.tempo).toBe(92);
    expect(score.timeSignature).toEqual({ beats: 4, beatUnit: 4 });
    expect(score.key).toEqual({ tonic: 10, mode: 'major' });
    expect(score.source).toBe('musicxml');
  });

  it('maps named parts onto SATB', () => {
    expect(score.parts.S.notes.map((n) => n.midi)).toEqual([65, 67, 70]);
    expect(score.parts.A.notes.map((n) => n.midi)).toEqual([62, 64, 65]);
    expect(score.parts.T.notes.map((n) => n.midi)).toEqual([59, 60, 62]);
    expect(score.parts.B.notes.map((n) => n.midi)).toEqual([46, 41]);
  });

  it('keeps the rhythm from the divisions', () => {
    expect(score.parts.S.notes.map((n) => [n.start, n.duration])).toEqual([
      [0, 2],
      [2, 1],
      [3, 1],
    ]);
    expect(score.parts.B.notes.map((n) => [n.start, n.duration])).toEqual([
      [0, 2],
      [2, 2],
    ]);
  });
});
