/**
 * Instrument catalogue: transposition, range, clef and the fingering system
 * each instrument uses. Concert pitch = written pitch + concertOffset.
 */

import { pitchClass } from './pitch';
import type { Key } from './keys';

export type InstrumentFamily = 'brass' | 'woodwind' | 'strings' | 'keyboard' | 'voice';
export type FingeringSystem = 'valve' | 'slide' | 'keyboard' | 'fretboard' | 'none';
export type ClefName = 'treble' | 'bass' | 'alto' | 'tenor';

export interface Instrument {
  id: string;
  name: string;
  family: InstrumentFamily;
  /** Semitones added to the written note to obtain the sounding note. */
  concertOffset: number;
  /** Written (not sounding) range in MIDI numbers. */
  range: { low: number; high: number };
  /** Clef normally used for this instrument. */
  clef: ClefName;
  system: FingeringSystem;
  /** Written MIDI number of the instrument's fundamental (partial 1). */
  fundamental: number;
  /** Short explanation of the transposition. */
  transposition: string;
  /** Teaching blurb. */
  description: string;
  /** Strings for fretboard instruments, written pitches, lowest first. */
  tuning?: number[];
}

export const INSTRUMENTS: Instrument[] = [
  {
    id: 'trumpet',
    name: 'Trumpet (B♭)',
    family: 'brass',
    concertOffset: -2,
    range: { low: 52, high: 84 },
    clef: 'treble',
    system: 'valve',
    fundamental: 48,
    transposition: 'Sounds a major 2nd lower than written (written C4 = concert B♭3).',
    description:
      'Three valves give seven combinations. The open bugle series is written C4, G4, C5, E5, G5, B♭5, C6; valves fill the gaps.',
  },
  {
    id: 'cornet',
    name: 'Cornet (B♭)',
    family: 'brass',
    concertOffset: -2,
    range: { low: 52, high: 84 },
    clef: 'treble',
    system: 'valve',
    fundamental: 48,
    transposition: 'Sounds a major 2nd lower than written.',
    description: 'Same valves and harmonic series as the trumpet, with a mellower tone.',
  },
  {
    id: 'flugelhorn',
    name: 'Flugelhorn (B♭)',
    family: 'brass',
    concertOffset: -2,
    range: { low: 52, high: 82 },
    clef: 'treble',
    system: 'valve',
    fundamental: 48,
    transposition: 'Sounds a major 2nd lower than written.',
    description: 'B♭ valved bugle; fingerings match the trumpet for the same written note.',
  },
  {
    id: 'horn',
    name: 'French horn (F)',
    family: 'brass',
    concertOffset: -7,
    range: { low: 42, high: 84 },
    clef: 'treble',
    system: 'valve',
    fundamental: 36,
    transposition: 'Sounds a perfect 5th lower than written (written C4 = concert F3).',
    description:
      'The F horn sits a fifth below the trumpet. The same valve combinations apply, but the fundamental is written C2.',
  },
  {
    id: 'trombone',
    name: 'Trombone (B♭)',
    family: 'brass',
    concertOffset: 0,
    range: { low: 40, high: 72 },
    clef: 'bass',
    system: 'slide',
    fundamental: 34,
    transposition: 'Non-transposing: reads concert pitch in bass clef.',
    description:
      'Seven slide positions, each lowering the harmonic series by one semitone. 1st position is all the way in, 7th all the way out.',
  },
  {
    id: 'euphonium',
    name: 'Euphonium (B♭)',
    family: 'brass',
    concertOffset: -14,
    range: { low: 54, high: 84 },
    clef: 'treble',
    system: 'valve',
    fundamental: 48,
    transposition: 'Treble clef part sounds a major 9th lower than written.',
    description: 'Valved B♭ instrument; the treble clef part uses exactly the trumpet fingerings.',
  },
  {
    id: 'tuba',
    name: 'Tuba (C)',
    family: 'brass',
    concertOffset: 0,
    range: { low: 26, high: 65 },
    clef: 'bass',
    system: 'valve',
    fundamental: 24,
    transposition: 'Non-transposing: reads concert pitch in bass clef.',
    description: 'Valves work like the trumpet, an octave lower again.',
  },
  {
    id: 'alto-sax',
    name: 'Alto saxophone (E♭)',
    family: 'woodwind',
    concertOffset: -9,
    range: { low: 58, high: 88 },
    clef: 'treble',
    system: 'none',
    fundamental: 58,
    transposition: 'Sounds a major 6th lower than written (written C4 = concert E♭3).',
    description: 'Study the scale in written fingering order; add the octave key from written A4 upwards.',
  },
  {
    id: 'tenor-sax',
    name: 'Tenor saxophone (B♭)',
    family: 'woodwind',
    concertOffset: -14,
    range: { low: 56, high: 84 },
    clef: 'treble',
    system: 'none',
    fundamental: 56,
    transposition: 'Sounds a major 9th lower than written.',
    description: 'Same written fingerings as the alto but a fourth lower sounding.',
  },
  {
    id: 'clarinet',
    name: 'Clarinet (B♭)',
    family: 'woodwind',
    concertOffset: -2,
    range: { low: 52, high: 91 },
    clef: 'treble',
    system: 'none',
    fundamental: 50,
    transposition: 'Sounds a major 2nd lower than written.',
    description: 'Mind the break between written B♭4 and B4: different fingerings and the register key.',
  },
  {
    id: 'flute',
    name: 'Flute (C)',
    family: 'woodwind',
    concertOffset: 0,
    range: { low: 60, high: 96 },
    clef: 'treble',
    system: 'none',
    fundamental: 60,
    transposition: 'Non-transposing.',
    description: 'Learn the scale in the low octave first, then repeat it with a tighter embouchure one octave higher.',
  },
  {
    id: 'recorder',
    name: 'Recorder (soprano)',
    family: 'woodwind',
    concertOffset: 12,
    range: { low: 72, high: 96 },
    clef: 'treble',
    system: 'none',
    fundamental: 72,
    transposition: 'Soprano recorder sounds an octave higher than written.',
    description: 'Seven finger holes plus the thumb hole: start from written C5 with as few fingers as possible.',
  },
  {
    id: 'violin',
    name: 'Violin',
    family: 'strings',
    concertOffset: 0,
    range: { low: 55, high: 100 },
    clef: 'treble',
    system: 'none',
    fundamental: 55,
    transposition: 'Non-transposing.',
    description: 'Tune the open strings G3 D4 A4 E5, then find each scale note with the finger pattern.',
  },
  {
    id: 'viola',
    name: 'Viola',
    family: 'strings',
    concertOffset: 0,
    range: { low: 48, high: 88 },
    clef: 'alto',
    system: 'none',
    fundamental: 48,
    transposition: 'Non-transposing, reads alto clef.',
    description: 'Open strings C3 G3 D4 A4.',
  },
  {
    id: 'cello',
    name: 'Cello',
    family: 'strings',
    concertOffset: 0,
    range: { low: 36, high: 84 },
    clef: 'bass',
    system: 'none',
    fundamental: 36,
    transposition: 'Non-transposing.',
    description: 'Open strings C2 G2 D3 A3.',
  },
  {
    id: 'double-bass',
    name: 'Double bass',
    family: 'strings',
    concertOffset: -12,
    range: { low: 28, high: 67 },
    clef: 'bass',
    system: 'none',
    fundamental: 28,
    transposition: 'Sounds an octave lower than written.',
    description: 'Open strings E1 A1 D2 G2.',
  },
  {
    id: 'guitar',
    name: 'Guitar',
    family: 'strings',
    concertOffset: -12,
    range: { low: 52, high: 88 },
    clef: 'treble',
    system: 'fretboard',
    fundamental: 40,
    transposition: 'Sounds an octave lower than written.',
    description: 'Standard tuning written E3 A3 D4 G4 B4 E5; each fret is one semitone.',
    tuning: [64, 59, 55, 50, 45, 40],
  },
  {
    id: 'piano',
    name: 'Piano',
    family: 'keyboard',
    concertOffset: 0,
    range: { low: 21, high: 108 },
    clef: 'treble',
    system: 'keyboard',
    fundamental: 21,
    transposition: 'Non-transposing: left hand bass clef, right hand treble clef.',
    description: 'Every flat or sharp is a black key; practise the scale slowly with one hand first.',
  },
  {
    id: 'voice',
    name: 'Voice',
    family: 'voice',
    concertOffset: 0,
    range: { low: 48, high: 84 },
    clef: 'treble',
    system: 'none',
    fundamental: 48,
    transposition: 'Non-transposing.',
    description: 'Sing the solfege syllables before adding the words. Breathe where the phrase allows.',
  },
];

export const INSTRUMENT_BY_ID: Record<string, Instrument> = Object.fromEntries(
  INSTRUMENTS.map((i) => [i.id, i]),
);

export function getInstrument(id: string): Instrument {
  return INSTRUMENT_BY_ID[id] ?? INSTRUMENT_BY_ID.trumpet;
}

/** Written pitch for a concert MIDI number. */
export function concertToWritten(instrument: Instrument, concertMidi: number): number {
  return concertMidi - instrument.concertOffset;
}

/** Sounding pitch for a written MIDI number. */
export function writtenToConcert(instrument: Instrument, writtenMidi: number): number {
  return writtenMidi + instrument.concertOffset;
}

/** Shift by octaves until the note fits the written range. */
export function fitWrittenToRange(instrument: Instrument, writtenMidi: number): number {
  let midi = writtenMidi;
  let guard = 0;
  while (midi < instrument.range.low && guard++ < 8) midi += 12;
  while (midi > instrument.range.high && guard++ < 16) midi -= 12;
  return midi;
}

export function inWrittenRange(instrument: Instrument, writtenMidi: number): boolean {
  return writtenMidi >= instrument.range.low && writtenMidi <= instrument.range.high;
}

/** Best octave to start a scale of the given key on this instrument. */
export function scaleStartWritten(instrument: Instrument, key: Key): number {
  const pc = pitchClass(key.tonic);
  let midi = instrument.range.low + ((((pc - instrument.range.low) % 12) + 12) % 12);
  if (midi > instrument.range.high - 12) midi -= 12;
  if (midi < instrument.range.low) midi += 12;
  return midi;
}

export function instrumentFamilies(): { id: InstrumentFamily; label: string }[] {
  return [
    { id: 'brass', label: 'Brass' },
    { id: 'woodwind', label: 'Woodwind' },
    { id: 'strings', label: 'Strings' },
    { id: 'keyboard', label: 'Keyboard' },
    { id: 'voice', label: 'Voice' },
  ];
}
