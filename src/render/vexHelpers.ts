/**
 * VexFlow drawing helpers: one measure into one stave.
 */

import { Accidental, Annotation, Beam, Dot, Formatter, GhostNote, Stave, StaveNote, StaveTie, Voice } from 'vexflow';
import { beatsPerMeasure, noteValue, type TimeSignature } from '../core/score';
import { vexKeySpec, type Key } from '../core/keys';
import type { ClefName } from '../core/instruments';
import { spellForXml } from '../core/musicxmlExport';
import { midiToName } from '../core/pitch';
import { solfegeText, type SolfegeDisplay, type SolfegeSystem } from '../core/solfege';
import type { MeasureChunk } from './layout';

export const CLEF_FOR_VEX: Record<ClefName, string> = {
  treble: 'treble',
  bass: 'bass',
  alto: 'alto',
  tenor: 'tenor',
};

export interface LabelOptions {
  solfege: { enabled: boolean; system: SolfegeSystem; display: SolfegeDisplay };
  letters: boolean;
}

export interface DrawnNote {
  note: StaveNote;
  midi: number;
  startBeat: number;
  duration: number;
}

type VexContext = ReturnType<import('vexflow').Renderer['getContext']>;

function ghostNote(beats: number): GhostNote {
  const value = noteValue(beats);
  // VexFlow writes dots after the duration code: "qd" is a dotted quarter.
  return new GhostNote({ duration: `${value.code}${'d'.repeat(value.dots)}` });
}

function labelFor(midis: number[], key: Key, options: LabelOptions): string {
  const sorted = midis.slice().sort((a, b) => a - b);
  if (options.solfege.enabled) {
    return sorted
      .map((midi) => solfegeText(midi, key, { system: options.solfege.system, display: options.solfege.display }))
      .join(' ');
  }
  if (options.letters) return sorted.map((midi) => midiToName(midi)).join(' ');
  return '';
}

/** Draws one measure of one part and returns the notes for tie drawing. */
export function drawMeasure(
  context: VexContext,
  stave: Stave,
  chunk: MeasureChunk,
  key: Key,
  options: LabelOptions,
  ts: TimeSignature,
  clef: ClefName,
): DrawnNote[] {
  const bpm = beatsPerMeasure(ts);
  const notes = chunk.notes;

  if (notes.length === 0) {
    try {
      const rest = new StaveNote({ keys: ['b/4'], duration: 'wr', clef: CLEF_FOR_VEX[clef] });
      const voice = new Voice({ num_beats: bpm, beat_value: ts.beatUnit }).addTickables([rest]);
      new Formatter().joinVoices([voice]).format([voice], Math.max(60, stave.getWidth() - 40));
      voice.draw(context, stave);
    } catch {
      /* ignore */
    }
    return [];
  }

  const groups: { start: number; duration: number; midis: number[] }[] = [];
  for (const note of notes) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.start - note.start) < 1e-4) {
      last.midis.push(note.midi);
      last.duration = Math.max(last.duration, note.duration);
    } else {
      groups.push({ start: note.start, duration: note.duration, midis: [note.midi] });
    }
  }

  const staveNotes: StaveNote[] = [];
  const tickables: (StaveNote | GhostNote)[] = [];
  const drawn: DrawnNote[] = [];
  let cursor = 0;

  for (const group of groups) {
    if (group.start > cursor + 1e-4) {
      tickables.push(ghostNote(group.start - cursor));
      cursor = group.start;
    }
    const value = noteValue(Math.max(0.125, Math.min(group.duration, bpm)));
    const keys = group.midis.map((midi) => {
      const spelled = spellForXml(midi, key);
      return `${spelled.step.toLowerCase()}/${spelled.octave}`;
    });
    const staveNote = new StaveNote({
      keys,
      duration: value.code,
      clef: CLEF_FOR_VEX[clef],
      auto_stem: true,
    });
    if (value.dots > 0) Dot.buildAndAttach([staveNote], { all: true });

    const text = labelFor(group.midis, key, options);
    if (text) {
      staveNote.addModifier(
        new Annotation(text)
          .setFont('Arial', 8, 'normal')
          .setVerticalJustification(Annotation.VerticalJustify.BOTTOM),
        0,
      );
    }

    staveNotes.push(staveNote);
    tickables.push(staveNote);
    for (const midi of group.midis) {
      drawn.push({ note: staveNote, midi, startBeat: group.start, duration: group.duration });
    }
    cursor = group.start + group.duration;
  }

  if (cursor < bpm - 1e-4) tickables.push(ghostNote(bpm - cursor));

  try {
    const voice = new Voice({ num_beats: bpm, beat_value: ts.beatUnit }).addTickables(tickables as never);
    Accidental.applyAccidentals([voice], vexKeySpec(key));
    const beams = Beam.generateBeams(staveNotes);
    const formatter = new Formatter();
    formatter.joinVoices([voice]).format([voice], Math.max(80, stave.getWidth() - 44));
    voice.draw(context, stave);
    for (const beam of beams) beam.setContext(context).draw();
  } catch {
    // A malformed measure should never break the whole score.
  }

  return drawn;
}

/** Ties for notes that were split at a bar line. */
export function drawTies(context: VexContext, drawn: DrawnNote[]): void {
  for (let i = 0; i < drawn.length - 1; i++) {
    const current = drawn[i];
    const next = drawn[i + 1];
    if (current.midi !== next.midi) continue;
    if (Math.abs(current.startBeat + current.duration - next.startBeat) > 1e-4) continue;
    if (current.note === next.note) continue;
    try {
      new StaveTie({ first_note: current.note, last_note: next.note }).setContext(context).draw();
    } catch {
      /* cosmetic only */
    }
  }
}
