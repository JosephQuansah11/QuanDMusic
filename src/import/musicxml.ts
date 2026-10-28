/**
 * MusicXML (score-partwise) importer.
 *
 * Supports the constructs that matter for choral and instrumental scores:
 * divisions, key/time/clef changes, chords, rests, backup/forward and ties.
 */

import { childText, childrenNamed, findFirst, firstChild, parseXml, type XmlNode } from './xml';
import {
  createPart,
  PART_IDS,
  type NoteEvent,
  type Part,
  type PartId,
  type Score,
  type TimeSignature,
} from '../core/score';
import { keyFromFifths, type Key } from '../core/keys';
import { estimateKey } from '../core/keydetect';
import { averagePitch } from '../core/voices';

export interface MusicXmlToScoreOptions {
  title?: string;
  composer?: string;
  keyOverride?: Key;
}

const STEP_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function pitchToMidi(pitch: XmlNode): number | null {
  const step = childText(pitch, 'step');
  const octave = childText(pitch, 'octave');
  if (!step || !octave) return null;
  const alter = Number(childText(pitch, 'alter') ?? '0');
  const semitone = STEP_SEMITONES[step.toUpperCase()];
  if (semitone === undefined) return null;
  return 12 * (Number(octave) + 1) + semitone + alter;
}

interface ParsedPart {
  id: string;
  name: string;
  notes: NoteEvent[];
  clef: string;
}

function parsePart(node: XmlNode, names: Record<string, string>): ParsedPart {
  const id = node.attrs.id ?? '';
  const name = names[id] ?? id;
  const notes: NoteEvent[] = [];
  let divisions = 1;
  let clef = 'treble';
  let cursor = 0; // in divisions
  const openTies = new Map<number, NoteEvent>();

  for (const measure of childrenNamed(node, 'measure')) {
    const attributes = firstChild(measure, 'attributes');
    if (attributes) {
      const divisionsText = childText(attributes, 'divisions');
      if (divisionsText) divisions = Math.max(1, Number(divisionsText));
      const clefNode = firstChild(attributes, 'clef');
      const sign = childText(clefNode, 'sign');
      const line = childText(clefNode, 'line');
      if (sign === 'F') clef = 'bass';
      else if (sign === 'C' && line === '3') clef = 'alto';
      else if (sign === 'C' && line === '4') clef = 'tenor';
      else if (sign === 'G') clef = 'treble';
    }

    let lastStart = 0;
    for (const child of measure.children) {
      if (child.name === 'backup') {
        cursor -= Number(childText(child, 'duration') ?? '0');
        continue;
      }
      if (child.name === 'forward') {
        cursor += Number(childText(child, 'duration') ?? '0');
        continue;
      }
      if (child.name !== 'note') continue;

      const isGrace = Boolean(firstChild(child, 'grace'));
      const isChord = Boolean(firstChild(child, 'chord'));
      const isRest = Boolean(firstChild(child, 'rest'));
      const durationDivisions = Number(childText(child, 'duration') ?? '0');
      const beats = durationDivisions / divisions;

      let start: number;
      if (isChord) {
        start = lastStart;
      } else if (isRest) {
        cursor += durationDivisions;
        continue;
      } else {
        start = cursor / divisions;
        lastStart = start;
        cursor += durationDivisions;
      }

      if (isGrace) continue;
      const pitch = firstChild(child, 'pitch');
      if (!pitch) continue;
      const midi = pitchToMidi(pitch);
      if (midi === null) continue;

      const tieTypes = childrenNamed(child, 'tie').map((tie) => tie.attrs.type);
      const tieStop = tieTypes.includes('stop');
      const tieStart = tieTypes.includes('start');

      if (tieStop) {
        const open = openTies.get(midi);
        if (open) {
          open.duration = Math.max(open.duration, start + beats - open.start);
          if (tieStart) openTies.set(midi, open);
          else openTies.delete(midi);
          continue;
        }
      }

      const note: NoteEvent = {
        midi,
        start: Math.max(0, start),
        duration: Math.max(1 / 32, beats),
        velocity: 0.85,
      };
      notes.push(note);
      if (tieStart) openTies.set(midi, note);
    }
  }

  // Only explicit ties are merged: two equal notes in a row stay separate so
  // the rhythm survives the round trip.
  return { id, name, notes, clef };
}

function partNames(root: XmlNode): Record<string, string> {
  const names: Record<string, string> = {};
  const partList = findFirst(root, 'part-list');
  if (!partList) return names;
  for (const scorePart of childrenNamed(partList, 'score-part')) {
    const id = scorePart.attrs.id;
    if (!id) continue;
    names[id] = childText(scorePart, 'part-name') ?? id;
  }
  return names;
}

function roleFromName(name: string): PartId | null {
  const lower = name.toLowerCase();
  if (/sopran|descant/i.test(lower)) return 'S';
  if (/alto|contralto|counter/i.test(lower)) return 'A';
  if (/tenor/i.test(lower)) return 'T';
  if (/bass|bariton/i.test(lower)) return 'B';
  return null;
}

function assignParts(parts: ParsedPart[]): Record<PartId, Part> {
  const result = {} as Record<PartId, Part>;
  const used = new Set<ParsedPart>();

  for (const part of parts) {
    const role = roleFromName(part.name);
    if (role && !result[role]) {
      result[role] = createPart(role, part.notes.map((n) => ({ ...n })));
      used.add(part);
    }
  }

  const remaining = parts.filter((p) => !used.has(p));
  if (remaining.length > 0) {
    const ordered = [...remaining].sort((a, b) => averagePitch(b.notes) - averagePitch(a.notes));
    for (const part of ordered) {
      const free = PART_IDS.find((id) => !result[id]);
      if (!free) break;
      result[free] = createPart(free, part.notes.map((n) => ({ ...n })));
    }
  }

  for (const id of PART_IDS) {
    if (!result[id]) result[id] = createPart(id);
  }
  return result;
}

/** Parses a MusicXML document into the app score model. */
export function musicXmlToScore(source: string, options: MusicXmlToScoreOptions = {}): Score {
  const root = parseXml(source);
  const scoreNode = findFirst(root, 'score-partwise');
  if (!scoreNode) throw new Error('Only MusicXML score-partwise files are supported');

  const names = partNames(scoreNode);
  const parts = childrenNamed(scoreNode, 'part').map((node) => parsePart(node, names));
  if (parts.length === 0) throw new Error('The MusicXML file has no parts');

  let fifths: number | null = null;
  let mode: 'major' | 'minor' = 'major';
  let timeSignature: TimeSignature = { beats: 4, beatUnit: 4 };
  let tempo = 100;

  const firstAttributes = findFirst(scoreNode, 'attributes');
  if (firstAttributes) {
    const keyNode = firstChild(firstAttributes, 'key');
    const fifthsText = childText(keyNode, 'fifths');
    if (fifthsText !== undefined) fifths = Number(fifthsText);
    if (childText(keyNode, 'mode') === 'minor') mode = 'minor';
    const timeNode = firstChild(firstAttributes, 'time');
    const beats = childText(timeNode, 'beats');
    const beatType = childText(timeNode, 'beat-type');
    if (beats && beatType) timeSignature = { beats: Number(beats), beatUnit: Number(beatType) };
  }

  const sound = findFirst(scoreNode, 'sound');
  if (sound?.attrs.tempo) tempo = Number(sound.attrs.tempo);
  const perMinute = findFirst(scoreNode, 'per-minute');
  if (perMinute && !sound?.attrs.tempo) tempo = Number(perMinute.text);

  const title =
    options.title ??
    childText(findFirst(scoreNode, 'work'), 'work-title') ??
    childText(scoreNode, 'movement-title') ??
    'Imported MusicXML';
  const composer = options.composer ?? findFirst(scoreNode, 'creator')?.text.trim() ?? '';

  const key =
    options.keyOverride ??
    (fifths !== null ? keyFromFifths(fifths, mode) : estimateKey(parts.flatMap((p) => p.notes)).key);

  return {
    title,
    composer,
    tempo: Math.max(20, Math.min(300, tempo || 100)),
    timeSignature,
    key,
    source: 'musicxml',
    parts: assignParts(parts),
    notes: parts.map((p) => `${p.name} (${p.notes.length} notes, ${p.clef} clef)`).join(', '),
    createdAt: Date.now(),
  };
}
