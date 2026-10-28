/**
 * SATB voice assignment.
 *
 * Any polyphonic material (MIDI tracks, MusicXML parts, audio analysis
 * output) can be turned into four monophonic voices. A small dynamic program
 * picks the assignment that keeps voices inside their ranges, avoids crossing
 * and avoids big leaps.
 */

import {
  createPart,
  mergeTiedNotes,
  PART_IDS,
  PART_RANGES,
  sortNotes,
  type NoteEvent,
  type Part,
  type PartId,
} from './score';

const VOICE_ORDER: PartId[] = ['S', 'A', 'T', 'B'];

function rangeCost(pitch: number, voice: PartId): number {
  const { low, high, center } = PART_RANGES[voice];
  let cost = Math.abs(pitch - center) / 24;
  if (pitch < low) cost += (low - pitch) * 1.5;
  if (pitch > high) cost += (pitch - high) * 1.5;
  return cost;
}

function continuityCost(pitch: number, previous: number | null): number {
  if (previous === null) return 0;
  const leap = Math.abs(pitch - previous);
  return Math.min(leap, 12) / 12 + (leap > 7 ? 0.4 : 0);
}

export interface VoiceAssignmentOptions {
  /** Ranges can be tightened, e.g. for a children's choir. */
  ranges?: Partial<Record<PartId, { low: number; high: number }>>;
}

function effectiveRange(voice: PartId, options: VoiceAssignmentOptions) {
  const base = PART_RANGES[voice];
  const override = options.ranges?.[voice];
  return override ? { low: override.low, high: override.high } : base;
}

export interface VoiceAssignmentEntry {
  pitch: number;
  voice: PartId;
}

/**
 * Assigns every simultaneous group of pitches to the four voices.
 * Pitches that cannot be sung are still assigned, to the closest voice.
 */
export function assignVoices(events: NoteEvent[], options: VoiceAssignmentOptions = {}): Record<PartId, Part> {
  const boundaries = new Set<number>();
  for (const note of events) {
    boundaries.add(round(note.start));
    boundaries.add(round(note.start + note.duration));
  }
  const times = [...boundaries].sort((a, b) => a - b);

  const previous: Record<PartId, { pitch: number; end: number } | null> = { S: null, A: null, T: null, B: null };
  const collected: Record<PartId, NoteEvent[]> = { S: [], A: [], T: [], B: [] };

  const sorted = sortNotes(events);
  let cursor = 0;

  for (let i = 0; i < times.length - 1; i++) {
    const start = times[i];
    const end = times[i + 1];
    if (end - start < 1e-6) continue;

    while (cursor < sorted.length && sorted[cursor].start + sorted[cursor].duration <= start + 1e-6) cursor++;
    const active: NoteEvent[] = [];
    for (let j = cursor; j < sorted.length && sorted[j].start < end - 1e-6; j++) {
      if (sorted[j].start <= start + 1e-6 && sorted[j].start + sorted[j].duration > start + 1e-6) active.push(sorted[j]);
    }
    if (active.length === 0) continue;

    const pitches = Array.from(new Set(active.map((n) => n.midi)))
      .sort((a, b) => b - a)
      .slice(0, 4);
    const assignment = bestAssignment(pitches, previous, options);

    for (const entry of assignment) {
      const source = active.find((n) => n.midi === entry.pitch);
      collected[entry.voice].push({
        midi: entry.pitch,
        start,
        duration: end - start,
        velocity: source?.velocity ?? 0.8,
      });
    }
    for (const id of VOICE_ORDER) {
      const entry = assignment.find((a) => a.voice === id);
      previous[id] = entry ? { pitch: entry.pitch, end } : null;
    }
  }

  const parts = {} as Record<PartId, Part>;
  for (const id of VOICE_ORDER) {
    parts[id] = createPart(id, mergeTiedNotes(cleanupOverlaps(collected[id])));
  }
  return parts;
}

function bestAssignment(
  pitches: number[],
  previous: Record<PartId, { pitch: number; end: number } | null>,
  options: VoiceAssignmentOptions,
): VoiceAssignmentEntry[] {
  if (pitches.length === 0) return [];
  const k = pitches.length;

  const dp: { cost: number; prev: number }[][] = [];
  for (let p = 0; p < k; p++) {
    dp.push(
      VOICE_ORDER.map((voice, v) => {
        const prevPitch = previous[voice]?.pitch ?? null;
        const range = effectiveRange(voice, options);
        const inside = pitches[p] >= range.low && pitches[p] <= range.high;
        const cost = rangeCost(pitches[p], voice) + continuityCost(pitches[p], prevPitch) + (inside ? 0 : 0.8);
        if (p === 0) return { cost, prev: -1 };
        let best = { cost: Infinity, prev: -1 };
        for (let vPrev = 0; vPrev < v; vPrev++) {
          const candidate = dp[p - 1][vPrev].cost + cost;
          if (candidate < best.cost) best = { cost: candidate, prev: vPrev };
        }
        return best;
      }),
    );
  }

  let bestVoice = 2; // prefer alto/tenor for a single line
  let bestCost = Infinity;
  for (let v = 0; v < 4; v++) {
    if (dp[k - 1][v].cost < bestCost) {
      bestCost = dp[k - 1][v].cost;
      bestVoice = v;
    }
  }

  const result: VoiceAssignmentEntry[] = [];
  let voiceIndex = bestVoice;
  for (let p = k - 1; p >= 0; p--) {
    result.push({ pitch: pitches[p], voice: VOICE_ORDER[voiceIndex] });
    voiceIndex = dp[p][voiceIndex].prev;
  }
  return result.reverse();
}

function cleanupOverlaps(notes: NoteEvent[]): NoteEvent[] {
  const sorted = sortNotes(notes);
  for (let i = 0; i < sorted.length - 1; i++) {
    const end = sorted[i].start + sorted[i].duration;
    if (end > sorted[i + 1].start + 1e-6) {
      sorted[i].duration = Math.max(1e-3, sorted[i + 1].start - sorted[i].start);
    }
  }
  return sorted;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Mean pitch of a group of notes, -1 when empty. */
export function averagePitch(notes: NoteEvent[]): number {
  if (notes.length === 0) return -1;
  return notes.reduce((sum, n) => sum + n.midi, 0) / notes.length;
}

/**
 * Maps imported tracks onto SATB: with four or more tracks the voices are
 * sorted by average pitch, otherwise everything is split by voice leading.
 */
export function partsFromTracks(tracks: { name: string; notes: NoteEvent[] }[]): Record<PartId, Part> {
  const usable = tracks.filter((t) => t.notes.length > 0);
  const result = {} as Record<PartId, Part>;

  if (usable.length >= 4) {
    const byPitch = [...usable].sort((a, b) => averagePitch(b.notes) - averagePitch(a.notes));
    VOICE_ORDER.forEach((id, index) => {
      result[id] = createPart(id, byPitch[index].notes.map((n) => ({ ...n })));
    });
    return result;
  }

  return assignVoices(usable.flatMap((t) => t.notes));
}

export function emptyVoices(): Record<PartId, Part> {
  const parts = {} as Record<PartId, Part>;
  for (const id of PART_IDS) parts[id] = createPart(id);
  return parts;
}
