/**
 * Fingering engines and practice generators.
 *
 * Brass fingerings are derived from the physics of the instrument: every note
 * is a harmonic of the fundamental, lowered by a valve combination or a slide
 * position. Instruments that are not modelled get clear note names,
 * transposition and range guidance instead of invented fingerings.
 */

import {
  type Instrument,
  type FingeringSystem,
  concertToWritten,
  inWrittenRange,
  scaleStartWritten,
  writtenToConcert,
} from './instruments';
import { diatonicScale, keyName, type Key, scaleOffset } from './keys';
import { isBlackKey, midiToName, pitchClass } from './pitch';
import { solfegeFor, octaveMarks } from './solfege';

export interface FingeringOption {
  /** Short label such as "1·2" or "3rd position". */
  label: string;
  /** Semitones the valve combination or slide position removes. */
  offset: number;
  /** Harmonic number on the instrument (1 = fundamental). */
  partial?: number;
  detail: string;
}

export interface Fingering {
  instrumentId: string;
  writtenMidi: number;
  system: FingeringSystem;
  primary: string;
  options: FingeringOption[];
  playable: boolean;
  explanation: string;
}

interface BrassCombo {
  offset: number;
  label: string;
  detail: string;
}

const VALVE_COMBOS: BrassCombo[] = [
  { offset: 0, label: 'open', detail: 'no valves' },
  { offset: -1, label: '2', detail: '2nd valve' },
  { offset: -2, label: '1', detail: '1st valve' },
  { offset: -3, label: '1·2', detail: '1st + 2nd valve' },
  { offset: -4, label: '2·3', detail: '2nd + 3rd valve' },
  { offset: -5, label: '1·3', detail: '1st + 3rd valve' },
  { offset: -6, label: '1·2·3', detail: 'all three valves' },
];

const SLIDE_POSITIONS: BrassCombo[] = Array.from({ length: 7 }, (_, i) => ({
  offset: -i,
  label: `${i + 1}`,
  detail: `${i + 1}${i === 0 ? 'st' : i === 1 ? 'nd' : i === 2 ? 'rd' : 'th'} position`,
}));

const STRING_NAMES = ['high E', 'B', 'G', 'D', 'A', 'low E'];

function brassOptions(
  instrument: Instrument,
  writtenMidi: number,
  combos: BrassCombo[],
  kind: 'valve' | 'slide',
): FingeringOption[] {
  const options: FingeringOption[] = [];
  for (let partial = 1; partial <= 20; partial++) {
    const harmonic = instrument.fundamental + 12 * Math.log2(partial);
    for (const combo of combos) {
      if (Math.round(harmonic + combo.offset) !== writtenMidi) continue;
      options.push({
        label: kind === 'valve' ? combo.label : combo.detail,
        offset: combo.offset,
        partial,
        detail:
          kind === 'valve'
            ? `${combo.detail}, harmonic ${partial}`
            : `${combo.detail}, harmonic ${partial}`,
      });
    }
  }
  // Prefer the most open fingering / shortest slide, then the lowest harmonic.
  options.sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset) || (a.partial ?? 0) - (b.partial ?? 0));
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.label}|${option.partial}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Guitar: string + fret options for a written pitch. */
export function guitarPositions(instrument: Instrument, writtenMidi: number): FingeringOption[] {
  const tuning = instrument.tuning ?? [];
  const options: FingeringOption[] = [];
  tuning.forEach((openMidi, index) => {
    const fret = writtenMidi - openMidi;
    if (fret < 0 || fret > 19) return;
    options.push({
      label: fret === 0 ? `${STRING_NAMES[index]} open` : `${STRING_NAMES[index]} str, fret ${fret}`,
      offset: fret,
      detail: fret === 0 ? `open ${STRING_NAMES[index]} string` : `fret ${fret} on the ${STRING_NAMES[index]} string`,
    });
  });
  options.sort((a, b) => a.offset - b.offset);
  return options;
}

export function fingeringFor(instrument: Instrument, concertMidi: number): Fingering {
  const writtenMidi = concertToWritten(instrument, concertMidi);
  const playable = inWrittenRange(instrument, writtenMidi);
  const result: Fingering = {
    instrumentId: instrument.id,
    writtenMidi,
    system: instrument.system,
    primary: '—',
    options: [],
    playable,
    explanation: '',
  };

  switch (instrument.system) {
    case 'valve':
      result.options = brassOptions(instrument, writtenMidi, VALVE_COMBOS, 'valve');
      result.primary = result.options[0]?.label ?? 'unplayable';
      result.explanation =
        'Valves lower the harmonic series: 2 = one semitone, 1 = two, 1·2 = three, 2·3 = four, 1·3 = five, 1·2·3 = six.';
      break;
    case 'slide':
      result.options = brassOptions(instrument, writtenMidi, SLIDE_POSITIONS, 'slide');
      result.primary = result.options[0]?.label ?? 'unplayable';
      result.explanation =
        'Each slide position lowers the harmonic series by one semitone; 1st position is all the way in.';
      break;
    case 'fretboard':
      result.options = guitarPositions(instrument, writtenMidi);
      result.primary = result.options[0]?.label ?? 'unplayable';
      result.explanation = 'Written an octave above sounding pitch; nearest fret in standard tuning.';
      break;
    case 'keyboard':
      result.primary = midiToName(writtenMidi);
      result.options = [
        { label: midiToName(writtenMidi), offset: 0, detail: isBlackKey(writtenMidi) ? 'black key' : 'white key' },
      ];
      result.explanation = isBlackKey(writtenMidi) ? 'This note is a black key.' : 'This note is a white key.';
      break;
    default:
      result.primary = midiToName(writtenMidi);
      result.options = [];
      result.explanation = 'Note name shown; use your instrument chart for the exact fingering.';
      break;
  }

  if (!playable) {
    result.options = [];
    result.primary = 'unplayable';
    result.explanation = `Outside the written range (${midiToName(instrument.range.low)} – ${midiToName(
      instrument.range.high,
    )}). Transpose the part or play it in another octave.`;
  }
  return result;
}

export interface PracticeNote {
  concertMidi: number;
  writtenMidi: number;
  writtenName: string;
  concertName: string;
  solfege: string;
  shortSolfege: string;
  degree: number | null;
  fingering: string;
  fingerings: FingeringOption[];
  explanation: string;
  playable: boolean;
  /** True when the note had to be moved by octaves to fit the instrument. */
  octaveShifted: boolean;
}

/** The key as written for a transposing instrument (e.g. concert B♭ = written C for a B♭ trumpet). */
export function writtenKeyFor(instrument: Instrument, key: Key): Key {
  return { tonic: pitchClass(key.tonic - instrument.concertOffset), mode: key.mode };
}

function solfegeLabel(writtenMidi: number, writtenKey: Key): { full: string; short: string; degree: number | null } {
  const info = solfegeFor(writtenMidi, writtenKey, 'movable');
  const marks = octaveMarks(info.octave);
  return { full: `${info.syllable}${marks}`, short: `${info.short}${marks}`, degree: info.degree };
}

/** Everything a student needs to know about one note on one instrument. */
export function practiceNote(
  instrument: Instrument,
  key: Key,
  concertMidi: number,
  preferFlats = false,
): PracticeNote {
  const writtenRaw = concertToWritten(instrument, concertMidi);
  const writtenMidi = inWrittenRange(instrument, writtenRaw)
    ? writtenRaw
    : ((): number => {
        let midi = writtenRaw;
        for (let i = 0; i < 6 && midi < instrument.range.low; i++) midi += 12;
        for (let i = 0; i < 6 && midi > instrument.range.high; i++) midi -= 12;
        return midi;
      })();
  const fingering = fingeringFor(instrument, writtenToConcert(instrument, writtenMidi));
  const writtenKey = writtenKeyFor(instrument, key);
  const solfege = solfegeLabel(writtenMidi, writtenKey);
  return {
    concertMidi,
    writtenMidi,
    writtenName: midiToName(writtenMidi, preferFlats),
    concertName: midiToName(concertMidi, preferFlats),
    solfege: solfege.full,
    shortSolfege: solfege.short,
    degree: solfege.degree,
    fingering: fingering.primary,
    fingerings: fingering.options,
    explanation: fingering.explanation,
    playable: fingering.playable,
    octaveShifted: writtenMidi !== writtenRaw,
  };
}

/**
 * One octave of the key, from the tonic, spelled with the key's own accidentals
 * and annotated with fingerings and solfege.
 */
export function scalePractice(instrument: Instrument, key: Key, octaves = 1): PracticeNote[] {
  const writtenKey = writtenKeyFor(instrument, key);
  const startConcert = writtenToConcert(instrument, scaleStartWritten(instrument, writtenKey));
  const degrees = diatonicScale(writtenKey);
  const notes: PracticeNote[] = [];
  for (let octave = 0; octave < octaves; octave++) {
    for (const degree of degrees) {
      const writtenMidi = scaleStartWritten(instrument, writtenKey) + octave * 12 + scaleOffset(degree.pc, writtenKey);
      notes.push(practiceNote(instrument, key, writtenToConcert(instrument, writtenMidi)));
    }
  }
  const tonicWritten = scaleStartWritten(instrument, writtenKey) + octaves * 12;
  notes.push(practiceNote(instrument, key, writtenToConcert(instrument, tonicWritten)));
  void startConcert;
  return notes;
}

/** Tonic arpeggio (1 - 3 - 5 - 8) for the written key. */
export function arpeggioPractice(instrument: Instrument, key: Key): PracticeNote[] {
  const writtenKey = writtenKeyFor(instrument, key);
  const start = scaleStartWritten(instrument, writtenKey);
  const steps = [0, 4, 7, 12];
  return steps.map((step) => practiceNote(instrument, key, writtenToConcert(instrument, start + step)));
}


/** The five flat pitch classes, in the order students normally meet them. */
export const FLAT_DRILL_PITCH_CLASSES = [1, 3, 6, 8, 10];

/** Drill for playing flats on the instrument, in a comfortable register. */
export function flatsDrill(instrument: Instrument, key: Key): PracticeNote[] {
  const writtenKey = writtenKeyFor(instrument, key);
  let anchor = scaleStartWritten(instrument, writtenKey);
  if (anchor + 11 > instrument.range.high) anchor -= 12;
  const out: PracticeNote[] = [];
  for (const pc of FLAT_DRILL_PITCH_CLASSES) {
    const midi = anchor + ((((pc - anchor) % 12) + 12) % 12);
    if (midi < instrument.range.low || midi > instrument.range.high) continue;
    out.push(practiceNote(instrument, key, writtenToConcert(instrument, midi), true));
  }
  return out.sort((a, b) => a.writtenMidi - b.writtenMidi);
}

/** Everything about how a key sits on a particular instrument. */
export interface KeyAccidentalInfo {
  writtenKeyName: string;
  concertKeyName: string;
  flats: PracticeNote[];
  sharps: PracticeNote[];
  lines: string[];
}

export function describeKeyOnInstrument(instrument: Instrument, key: Key): KeyAccidentalInfo {
  const writtenKey = writtenKeyFor(instrument, key);
  const low = instrument.range.low;
  const high = instrument.range.high;
  const accidentals: PracticeNote[] = [];
  for (const degree of diatonicScale(writtenKey)) {
    if (degree.alter === 0) continue;
    const midi = Math.min(low + ((((degree.pc - low) % 12) + 12) % 12), high);
    accidentals.push(practiceNote(instrument, key, writtenToConcert(instrument, midi)));
  }
  const flats = accidentals.filter((n) => n.writtenName.includes('b'));
  const sharps = accidentals.filter((n) => n.writtenName.includes('#'));
  const lines = [
    `Concert key: ${keyName(key)}.`,
    `Written key for the ${instrument.name}: ${keyName(writtenKey)}.`,
    instrument.transposition,
  ];
  if (accidentals.length === 0) {
    lines.push('This key has no accidentals - every note is a natural.');
  } else {
    lines.push(`Accidentals in the written key: ${accidentals.map((n) => n.writtenName).join(', ')}.`);
  }
  return { writtenKeyName: keyName(writtenKey), concertKeyName: keyName(key), flats, sharps, lines };
}

/** Converts a song part into a practice sequence on the chosen instrument. */
export function songPractice(
  instrument: Instrument,
  key: Key,
  notes: { midi: number; start: number; duration: number }[],
): (PracticeNote & { start: number; duration: number })[] {
  return notes.map((note) => ({
    ...practiceNote(instrument, key, note.midi),
    start: note.start,
    duration: note.duration,
  }));
}
