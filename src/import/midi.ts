/**
 * Standard MIDI File parser (formats 0, 1 and 2), written from scratch so the
 * app keeps working offline with no external dependencies.
 */

import type { NoteEvent, Score, TimeSignature } from '../core/score';
import { PART_IDS } from '../core/score';
import { keyFromFifths, type Key } from '../core/keys';
import { estimateKey } from '../core/keydetect';
import { partsFromTracks } from '../core/voices';
import { quantizeNotes } from '../core/quantize';

export interface MidiNote extends NoteEvent {
  channel: number;
}

export interface MidiTrack {
  name: string;
  notes: MidiNote[];
  program: number;
}

export interface ParsedMidi {
  format: number;
  ticksPerQuarter: number;
  tempo: number;
  timeSignature: TimeSignature;
  keyFifths: number | null;
  keyMode: 'major' | 'minor';
  tracks: MidiTrack[];
}

class Reader {
  pos = 0;
  readonly view: DataView;
  constructor(readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  u8(): number {
    return this.data[this.pos++];
  }

  u16(): number {
    const value = this.view.getUint16(this.pos);
    this.pos += 2;
    return value;
  }

  i16(): number {
    const value = this.view.getInt16(this.pos);
    this.pos += 2;
    return value;
  }

  u32(): number {
    const value = this.view.getUint32(this.pos);
    this.pos += 4;
    return value;
  }

  str(length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) out += String.fromCharCode(this.data[this.pos + i]);
    this.pos += length;
    return out;
  }

  varInt(): number {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const byte = this.u8();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) break;
    }
    return value;
  }
}

interface RawEventNote {
  midi: number;
  startTick: number;
  durationTicks: number;
  velocity: number;
  channel: number;
}


export function parseMidi(input: ArrayBuffer | Uint8Array): ParsedMidi {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const reader = new Reader(data);
  if (reader.str(4) !== 'MThd') throw new Error('Not a MIDI file (missing MThd header)');
  const headerLength = reader.u32();
  const headerEnd = reader.pos + headerLength;
  const format = reader.u16();
  reader.u16(); // declared track count: the chunk loop below is authoritative
  const division = reader.i16();
  let ticksPerQuarter = division > 0 ? division : 480;
  if (division < 0) {
    // SMPTE: high byte holds negative frames per second, low byte ticks per frame.
    const fps = -((division >> 8) & 0xff);
    const ticksPerFrame = division & 0xff;
    ticksPerQuarter = Math.max(24, Math.round(fps * ticksPerFrame * 0.5));
  }
  reader.pos = headerEnd;

  let tempo = 120;
  let timeSignature: TimeSignature = { beats: 4, beatUnit: 4 };
  let keyFifths: number | null = null;
  let keyMode: 'major' | 'minor' = 'major';
  const tracks: MidiTrack[] = [];

  while (reader.pos + 8 <= data.length) {
    const id = reader.str(4);
    const length = reader.u32();
    const end = Math.min(reader.pos + length, data.length);
    if (id !== 'MTrk') {
      reader.pos = end;
      continue;
    }

    const notes: RawEventNote[] = [];
    const active = new Map<number, { tick: number; velocity: number }>();
    let tick = 0;
    let runningStatus = 0;
    let name = `Track ${tracks.length + 1}`;
    let program = 0;
    let sawTempo = false;

    while (reader.pos < end) {
      tick += reader.varInt();
      if (reader.pos >= end) break;
      let status = reader.data[reader.pos];
      if (status & 0x80) {
        runningStatus = status;
        reader.pos++;
      } else {
        status = runningStatus;
      }

      if (status === 0xff) {
        const type = reader.u8();
        const metaLength = reader.varInt();
        const metaStart = reader.pos;
        if (type === 0x51 && metaLength >= 3) {
          const micros = (reader.data[metaStart] << 16) | (reader.data[metaStart + 1] << 8) | reader.data[metaStart + 2];
          if (!sawTempo) {
            tempo = 60_000_000 / micros;
            sawTempo = true;
          }
        } else if (type === 0x58 && metaLength >= 2) {
          const beats = reader.data[metaStart];
          const beatUnit = Math.pow(2, reader.data[metaStart + 1]);
          timeSignature = { beats, beatUnit };
        } else if (type === 0x59 && metaLength >= 2) {
          const sf = (reader.data[metaStart] << 24) >> 24; // sign extend one byte
          keyFifths = sf;
          if (reader.data[metaStart + 1] === 1) keyMode = 'minor';
        } else if (type === 0x03) {
          let text = '';
          for (let i = 0; i < metaLength; i++) text += String.fromCharCode(reader.data[metaStart + i]);
          if (text.trim()) name = text.trim();
        }
        reader.pos = metaStart + metaLength;
        continue;
      }

      if (status === 0xf0 || status === 0xf7) {
        const sysexLength = reader.varInt();
        reader.pos += sysexLength;
        continue;
      }

      const high = status & 0xf0;
      const channel = status & 0x0f;
      if (high === 0xc0) {
        program = reader.u8();
        continue;
      }
      if (high === 0xd0) {
        reader.pos += 1;
        continue;
      }

      const data1 = reader.u8();
      const twoByte = high === 0x80 || high === 0x90 || high === 0xa0 || high === 0xb0 || high === 0xe0;
      const data2 = twoByte ? reader.u8() : 0;

      if (high === 0x90 && data2 > 0) {
        active.set(channel * 128 + data1, { tick, velocity: data2 / 127 });
      } else if (high === 0x80 || (high === 0x90 && data2 === 0)) {
        const key = channel * 128 + data1;
        const started = active.get(key);
        if (started) {
          active.delete(key);
          if (tick > started.tick) {
            notes.push({
              midi: data1,
              startTick: started.tick,
              durationTicks: tick - started.tick,
              velocity: started.velocity,
              channel,
            });
          }
        }
      }
    }

    for (const [key, started] of active) {
      notes.push({
        midi: key % 128,
        startTick: started.tick,
        durationTicks: Math.max(1, tick - started.tick),
        velocity: started.velocity,
        channel: Math.floor(key / 128),
      });
    }

    tracks.push({
      name,
      program,
      notes: notes.map((n) => ({
        midi: n.midi,
        start: n.startTick / ticksPerQuarter,
        duration: n.durationTicks / ticksPerQuarter,
        velocity: n.velocity,
        channel: n.channel,
      })),
    });
  }

  return { format, ticksPerQuarter, tempo, timeSignature, keyFifths, keyMode, tracks };
}

export interface MidiToScoreOptions {
  title?: string;
  composer?: string;
  keyOverride?: Key;
  /** Quantise grid in beats, 0 disables quantisation. */
  quantizeGrid?: number;
  tempoOverride?: number;
}

/** Splits a merged format-0 track into one pseudo-track per MIDI channel. */
function splitByChannel(track: MidiTrack): MidiTrack[] {
  const channels = new Map<number, MidiNote[]>();
  for (const note of track.notes) {
    const list = channels.get(note.channel) ?? [];
    list.push(note);
    channels.set(note.channel, list);
  }
  return [...channels.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([channel, notes]) => ({ name: `${track.name} ch${channel + 1}`, program: track.program, notes }));
}

/** Turns a parsed MIDI file into the app score model. */
export function midiToScore(parsed: ParsedMidi, options: MidiToScoreOptions = {}): Score {
  let tracks = parsed.tracks.filter((t) => t.notes.length > 0);
  if (tracks.length === 1 && new Set(tracks[0].notes.map((n) => n.channel)).size > 1) {
    tracks = splitByChannel(tracks[0]);
  }

  const minStart = tracks.reduce((min, track) => Math.min(min, ...track.notes.map((n) => n.start)), Infinity);
  const offset = Number.isFinite(minStart) ? Math.floor(minStart) : 0;

  const shifted = tracks.map((track) => ({
    name: track.name,
    notes: track.notes.map((n) => ({
      midi: n.midi,
      start: Math.max(0, n.start - offset),
      duration: Math.max(0.05, n.duration),
      velocity: n.velocity,
    })),
  }));

  const parts = partsFromTracks(shifted);
  const grid = options.quantizeGrid ?? 0;
  if (grid > 0) {
    for (const id of PART_IDS) {
      parts[id].notes = quantizeNotes(parts[id].notes, { grid, minDuration: grid });
    }
  }

  const allNotes = shifted.flatMap((t) => t.notes);
  const key = options.keyOverride ?? (parsed.keyFifths !== null
    ? keyFromFifths(parsed.keyFifths, parsed.keyMode)
    : estimateKey(allNotes).key);

  return {
    title: options.title ?? 'Imported MIDI file',
    composer: options.composer ?? '',
    tempo: Math.max(20, Math.min(300, options.tempoOverride ?? parsed.tempo)),
    timeSignature: parsed.timeSignature,
    key,
    source: 'midi',
    parts,
    notes: tracks.map((t) => `${t.name} (${t.notes.length} notes)`).join(', '),
    createdAt: Date.now(),
  };
}
