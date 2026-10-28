/**
 * MusicXML export.
 *
 * The generated file opens in MuseScore, Finale, Dorico or any notation app,
 * which is how users take a practice part offline to a music stand.
 */

import {
  beatsPerMeasure,
  noteValue,
  PART_IDS,
  PART_NAMES,
  sortNotes,
  totalBeats,
  type NoteEvent,
  type PartId,
  type Score,
} from './score';
import { diatonicScale, keyFifths } from './keys';
import { accidentalToString, LETTER_SEMITONES, LETTERS, pitchClass } from './pitch';

const CLEFS: Record<PartId, { sign: string; line: number; octave?: number }> = {
  S: { sign: 'G', line: 2 },
  A: { sign: 'G', line: 2 },
  T: { sign: 'G', line: 2, octave: -1 },
  B: { sign: 'F', line: 4 },
};

const TYPE_NAMES: Record<string, string> = {
  w: 'whole',
  h: 'half',
  q: 'quarter',
  '8': 'eighth',
  '16': '16th',
  '32': '32nd',
};

/** Ticks per quarter note in the exported file. */
const DIVISIONS = 8;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Spells a MIDI note using the key's own letters and accidentals. */
export function spellForXml(midi: number, key: Score['key']): { step: string; alter: number; octave: number } {
  const pc = pitchClass(midi);
  const degree = diatonicScale(key).find((d) => d.pc === pc);
  let letter: number;
  let alter: number;

  if (degree) {
    letter = degree.letter;
    alter = degree.alter;
  } else {
    // Chromatic note: flats in flat keys, sharps in sharp keys.
    const preferFlats = keyFifths(key) < 0;
    const naturals = [0, 2, 4, 5, 7, 9, 11];
    const sharpLetter = naturals.find((natural) => (natural + 1) % 12 === pc);
    const flatLetter = naturals.find((natural) => (natural - 1 + 12) % 12 === pc);
    if (preferFlats && flatLetter !== undefined) {
      letter = flatLetter;
      alter = -1;
    } else if (sharpLetter !== undefined) {
      letter = sharpLetter;
      alter = 1;
    } else if (flatLetter !== undefined) {
      letter = flatLetter;
      alter = -1;
    } else {
      letter = naturals.reduce((best, natural) => (Math.abs(natural - pc) < Math.abs(best - pc) ? natural : best), 0);
      alter = pc - letter;
    }
  }

  let octave = Math.round((midi - alter - LETTER_SEMITONES[letter]) / 12) - 1;
  if (!Number.isFinite(octave)) octave = 4;
  return { step: LETTERS[letter], alter, octave };
}

function durationElements(beats: number): string {
  const value = noteValue(beats);
  const dots = '      <dot/>\n'.repeat(value.dots);
  return `      <duration>${Math.max(1, Math.round(beats * DIVISIONS))}</duration>\n      <type>${
    TYPE_NAMES[value.code]
  }</type>\n${dots}`;
}

function noteXml(
  note: NoteEvent,
  key: Score['key'],
  options: { chord?: boolean; tieStart?: boolean; tieStop?: boolean },
): string {
  const spelled = spellForXml(note.midi, key);
  const alter = spelled.alter !== 0 ? `<alter>${spelled.alter}</alter>` : '';
  const ties = `${options.tieStop ? '      <tie type="stop"/>\n' : ''}${
    options.tieStart ? '      <tie type="start"/>\n' : ''
  }`;
  const notations =
    options.tieStart || options.tieStop
      ? `      <notations>\n${options.tieStop ? '        <tied type="stop"/>\n' : ''}${
          options.tieStart ? '        <tied type="start"/>\n' : ''
        }      </notations>\n`
      : '';
  return (
    `    <note>\n${options.chord ? '      <chord/>\n' : ''}` +
    `      <pitch><step>${spelled.step}</step>${alter}<octave>${spelled.octave}</octave></pitch>\n` +
    durationElements(note.duration) +
    ties +
    notations +
    `    </note>\n`
  );
}

function restXml(beats: number): string {
  return `    <note>\n      <rest/>\n${durationElements(beats)}    </note>\n`;
}

export interface MusicXmlExportOptions {
  /** Persist each part's notes only (used for single-part exports). */
  parts?: PartId[];
}

/** Renders the score as a score-partwise MusicXML document. */
export function exportMusicXml(score: Score, options: MusicXmlExportOptions = {}): string {
  const bpm = beatsPerMeasure(score.timeSignature);
  const measures = Math.max(1, Math.ceil(totalBeats(score) / bpm));
  const fifths = keyFifths(score.key);
  const partsToWrite = options.parts ?? [...PART_IDS];

  const header =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n` +
    `<score-partwise version="3.1">\n` +
    `  <work><work-title>${escapeXml(score.title)}</work-title></work>\n` +
    `  <identification>\n    <creator type="composer">${escapeXml(score.composer)}</creator>\n` +
    `    <encoding><software>QuanDMusic</software></encoding>\n  </identification>\n` +
    `  <part-list>\n` +
    partsToWrite
      .map((id) => `    <score-part id="P${id}"><part-name>${PART_NAMES[id]}</part-name></score-part>\n`)
      .join('') +
    `  </part-list>\n`;

  const parts = partsToWrite
    .map((id) => {
      // Split at bar lines up front so ties are only written where a note really
      // continues into the next bar.
      const segments: (NoteEvent & { tieStart: boolean; tieStop: boolean })[] = [];
      for (const note of sortNotes(score.parts[id].notes)) {
        let start = note.start;
        let remaining = note.duration;
        const chunks: NoteEvent[] = [];
        let guard = 0;
        while (remaining > 1e-6 && guard++ < 64) {
          const nextBar = (Math.floor(start / bpm) + 1) * bpm;
          const chunk = Math.min(remaining, nextBar - start);
          chunks.push({ ...note, start, duration: chunk });
          start += chunk;
          remaining -= chunk;
        }
        chunks.forEach((chunk, index) => {
          segments.push({ ...chunk, tieStop: index > 0, tieStart: index < chunks.length - 1 });
        });
      }
      segments.sort((a, b) => a.start - b.start || b.midi - a.midi);

      let xml = `  <part id="P${id}">\n`;
      for (let measure = 0; measure < measures; measure++) {
        const measureStart = measure * bpm;
        const measureEnd = measureStart + bpm;
        xml += `    <measure number="${measure + 1}">\n`;

        if (measure === 0) {
          const clef = CLEFS[id];
          xml +=
            `      <attributes>\n        <divisions>${DIVISIONS}</divisions>\n` +
            `        <key><fifths>${fifths}</fifths><mode>${score.key.mode}</mode></key>\n` +
            `        <time><beats>${score.timeSignature.beats}</beats><beat-type>${score.timeSignature.beatUnit}</beat-type></time>\n` +
            `        <clef><sign>${clef.sign}</sign><line>${clef.line}</line>${
              clef.octave ? `<clef-octave-change>${clef.octave}</clef-octave-change>` : ''
            }</clef>\n      </attributes>\n` +
            `      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(
              score.tempo,
            )}</per-minute></metronome></direction-type><sound tempo="${Math.round(
              score.tempo,
            )}"/></direction>\n`;
        }

        const inMeasure = segments.filter((n) => n.start >= measureStart - 1e-6 && n.start < measureEnd - 1e-6);
        let cursor = measureStart;
        let lastStart = Number.NaN;

        for (const note of inMeasure) {
          if (note.start > cursor + 1e-6) {
            xml += restXml(note.start - cursor);
            cursor = note.start;
          }
          const isChord = Math.abs(note.start - lastStart) < 1e-6;
          xml += noteXml(note, score.key, { chord: isChord, tieStart: note.tieStart, tieStop: note.tieStop });
          lastStart = note.start;
          if (!isChord) cursor = note.start + note.duration;
        }

        if (cursor < measureEnd - 1e-6) xml += restXml(measureEnd - cursor);
        xml += `    </measure>\n`;
      }

      xml += `  </part>\n`;
      return xml;
    })
    .join('');

  return `${header}${parts}</score-partwise>\n`;
}

/** Filename-friendly export, e.g. "My song - Soprano.musicxml". */
export function exportFileName(score: Score, part?: PartId): string {
  const base = score.title.replace(/[^\w\- ]+/g, '').trim() || 'score';
  const suffix = part ? ` - ${PART_NAMES[part]}` : '';
  return `${base}${suffix}.musicxml`;
}

export { accidentalToString };
