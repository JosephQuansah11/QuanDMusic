/**
 * Web Audio playback engine.
 *
 * - every SATB part gets its own gain node (mute / solo / balance),
 * - each note is a formant-shaped oscillator, so the guide track carries the
 *   pitch, the exact rhythm and the tempo of the score,
 * - optional metronome, count-in, looping and a practice drone,
 * - an uploaded recording can be played in sync with the score timeline.
 */

import { beatDurationSeconds, PART_IDS, type PartId, type Score } from '../core/score';
import { midiToFrequency, pitchClass } from '../core/pitch';

export type PlaybackListener = (beat: number, playing: boolean) => void;

interface ScheduledNode {
  stop: () => void;
}

const VOWEL_FORMANTS: Record<string, [number, number, number]> = {
  S: [800, 1150, 2900],
  A: [700, 1200, 2600],
  T: [600, 900, 2400],
  B: [450, 800, 2300],
};

let sharedContext: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!sharedContext) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedContext = new Ctor();
  }
  return sharedContext;
}

export class ScorePlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private partGain: Record<PartId, GainNode> | null = null;
  private originalGain: GainNode | null = null;
  private originalSource: AudioBufferSourceNode | null = null;
  private score: Score | null = null;
  private scheduled: ScheduledNode[] = [];
  private listeners = new Set<PlaybackListener>();
  private frame: number | null = null;

  private tempoScale = 1;
  private metronome = false;
  private drone = false;
  private muted: Record<PartId, boolean> = { S: false, A: false, T: false, B: false };
  private solo: PartId | null = null;
  private volumes: Record<PartId, number> = { S: 0.8, A: 0.8, T: 0.8, B: 0.8 };
  private originalVolume = 0.7;
  private originalMuted = false;

  private playing = false;
  private originBeat = 0;
  private originTime = 0;
  private loopRange: { start: number; end: number } | null = null;

  onUpdate(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(beat: number): void {
    for (const listener of this.listeners) listener(beat, this.playing);
  }

  private ensureNodes(): AudioContext {
    if (!this.ctx) {
      this.ctx = getAudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.partGain = {} as Record<PartId, GainNode>;
      for (const id of PART_IDS) {
        const gain = this.ctx.createGain();
        gain.gain.value = this.muted[id] ? 0 : this.volumes[id];
        gain.connect(this.master);
        this.partGain[id] = gain;
      }
      this.originalGain = this.ctx.createGain();
      this.originalGain.gain.value = this.originalMuted ? 0 : this.originalVolume;
      this.originalGain.connect(this.master);
    }
    return this.ctx;
  }

  setScore(score: Score | null): void {
    this.stop();
    this.score = score;
  }

  getScore(): Score | null {
    return this.score;
  }

  setTempoScale(scale: number): void {
    const wasPlaying = this.playing;
    const beat = this.position;
    this.tempoScale = Math.max(0.25, Math.min(2, scale));
    if (wasPlaying) {
      this.stop();
      void this.play(beat);
    }
  }

  getTempoScale(): number {
    return this.tempoScale;
  }

  setMetronome(on: boolean): void {
    this.metronome = on;
  }

  isMetronomeOn(): boolean {
    return this.metronome;
  }

  setDrone(on: boolean): void {
    this.drone = on;
  }

  isDroneOn(): boolean {
    return this.drone;
  }

  setPartVolume(id: PartId, volume: number): void {
    this.volumes[id] = Math.max(0, Math.min(1.5, volume));
    this.applyGains();
  }

  setPartMuted(id: PartId, muted: boolean): void {
    this.muted[id] = muted;
    this.applyGains();
  }

  isPartMuted(id: PartId): boolean {
    return this.muted[id];
  }

  setSolo(id: PartId | null): void {
    this.solo = id;
    this.applyGains();
  }

  getSolo(): PartId | null {
    return this.solo;
  }

  setOriginalVolume(volume: number): void {
    this.originalVolume = Math.max(0, Math.min(1.5, volume));
    if (this.originalGain) this.originalGain.gain.value = this.originalMuted ? 0 : this.originalVolume;
  }

  setOriginalMuted(muted: boolean): void {
    this.originalMuted = muted;
    if (this.originalGain) this.originalGain.gain.value = muted ? 0 : this.originalVolume;
  }

  private applyGains(): void {
    if (!this.partGain) return;
    for (const id of PART_IDS) {
      const audible = !this.muted[id] && (this.solo === null || this.solo === id);
      this.partGain[id].gain.value = audible ? this.volumes[id] : 0;
    }
  }

  setLoop(range: { start: number; end: number } | null): void {
    this.loopRange = range;
  }

  getLoop(): { start: number; end: number } | null {
    return this.loopRange;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get position(): number {
    if (!this.ctx || !this.playing) return this.originBeat;
    const beatDur = this.beatLength();
    const elapsed = Math.max(0, this.ctx.currentTime - this.originTime);
    return this.originBeat + elapsed / beatDur;
  }

  private beatLength(): number {
    const tempo = this.score?.tempo ?? 100;
    return beatDurationSeconds(tempo) / this.tempoScale;
  }

  /** Cached formant wave per part and pitch class keeps playback cheap. */
  private waveCache = new Map<string, PeriodicWave>();

  private voiceWave(ctx: AudioContext, midi: number, part: PartId): PeriodicWave {
    const key = `${part}:${midi}`;
    const cached = this.waveCache.get(key);
    if (cached) return cached;
    const formants = VOWEL_FORMANTS[part];
    const freq = midiToFrequency(midi);
    const harmonics = 16;
    const real = new Float32Array(harmonics + 1);
    const imag = new Float32Array(harmonics + 1);
    for (let h = 1; h <= harmonics; h++) {
      const hz = freq * h;
      let gain = 0.08;
      for (let f = 0; f < formants.length; f++) {
        const bandwidth = 120 + f * 70;
        const distance = (hz - formants[f]) / bandwidth;
        gain += (1 / (f + 1)) * Math.exp(-0.5 * distance * distance);
      }
      const amplitude = (gain / Math.pow(h, 1.2)) * (h % 2 === 0 ? 0.75 : 1);
      imag[h] = amplitude;
    }
    // Normalise so quiet and loud notes feel similar.
    let max = 0;
    for (let h = 1; h <= harmonics; h++) max = Math.max(max, Math.abs(imag[h]));
    if (max > 0) for (let h = 1; h <= harmonics; h++) imag[h] /= max;
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this.waveCache.set(key, wave);
    return wave;
  }

  private scheduleNote(
    ctx: AudioContext,
    part: PartId,
    midi: number,
    when: number,
    duration: number,
    velocity: number,
  ): void {
    if (!this.partGain) return;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.voiceWave(ctx, midi, part));
    osc.frequency.value = midiToFrequency(midi);
    if (part === 'T') osc.detune.value = -3;
    if (part === 'B') osc.detune.value = 3;

    const gain = ctx.createGain();
    const peak = Math.max(0.05, Math.min(1, velocity)) * 0.32;
    const attack = 0.035;
    const release = 0.08;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + attack);
    gain.gain.setValueAtTime(peak, Math.max(when + attack, when + duration - release));
    gain.gain.linearRampToValueAtTime(0.0001, when + duration + 0.02);

    osc.connect(gain);
    gain.connect(this.partGain[part]);
    osc.start(when);
    osc.stop(when + duration + 0.05);
    this.scheduled.push({ stop: () => { try { osc.stop(); } catch { /* already stopped */ } } });
  }

  private scheduleClick(ctx: AudioContext, when: number, accent: boolean): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1600 : 1050;
    gain.gain.setValueAtTime(accent ? 0.16 : 0.09, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
    osc.connect(gain);
    gain.connect(this.master ?? ctx.destination);
    osc.start(when);
    osc.stop(when + 0.06);
    this.scheduled.push({ stop: () => { try { osc.stop(); } catch { /* already stopped */ } } });
  }
  /** Schedules every note that starts inside [fromBeat, toBeat). */
  private scheduleRange(ctx: AudioContext, fromBeat: number, toBeat: number, originTime: number): void {
    const score = this.score;
    if (!score) return;
    const beatDur = this.beatLength();
    const metersPerBeat = score.timeSignature.beats;

    for (const id of PART_IDS) {
      for (const note of score.parts[id].notes) {
        if (note.start < fromBeat - 1e-6 || note.start >= toBeat - 1e-6) continue;
        const when = originTime + (note.start - fromBeat) * beatDur;
        const duration = note.duration * beatDur * 0.98;
        this.scheduleNote(ctx, id, note.midi, when, duration, note.velocity);
      }
    }

    if (this.metronome) {
      const firstBeat = Math.ceil(fromBeat - 1e-6);
      for (let beat = firstBeat; beat < toBeat - 1e-6; beat++) {
        if (beat < fromBeat - 1e-6) continue;
        const when = originTime + (beat - fromBeat) * beatDur;
        const accent = beat % metersPerBeat === 0;
        this.scheduleClick(ctx, when, accent);
      }
    }

    if (this.drone && score) {
      // Soft reference pitch on the tonic, an octave below the soprano line.
      const tonic = 60 + ((pitchClass(score.key.tonic) - 60) % 12 + 12) % 12;
      const startWhen = originTime;
      const duration = (toBeat - fromBeat) * beatDur;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = midiToFrequency(tonic - 12);
      gain.gain.setValueAtTime(0.0001, startWhen);
      gain.gain.linearRampToValueAtTime(0.06, startWhen + 0.2);
      gain.gain.setValueAtTime(0.06, startWhen + Math.max(0.2, duration - 0.2));
      gain.gain.linearRampToValueAtTime(0.0001, startWhen + duration);
      osc.connect(gain);
      gain.connect(this.master ?? ctx.destination);
      osc.start(startWhen);
      osc.stop(startWhen + duration + 0.05);
      this.scheduled.push({ stop: () => { try { osc.stop(); } catch { /* already stopped */ } } });
    }
  }

  private startOriginal(ctx: AudioContext, buffer: AudioBuffer, fromBeat: number, when: number): void {
    if (!this.originalGain) return;
    const offset = Math.max(0, (fromBeat * this.beatLength()) || 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.originalGain);
    if (offset >= buffer.duration) return;
    source.start(when, offset);
    this.originalSource = source;
  }

  async play(fromBeat = 0, countInBeats = 0, originalBuffer: AudioBuffer | null = null): Promise<void> {
    const ctx = this.ensureNodes();
    if (ctx.state === 'suspended') await ctx.resume();
    this.stopNodes();

    const score = this.score;
    if (!score) return;
    const beatDur = this.beatLength();
    const total = Math.max(
      1,
      ...PART_IDS.flatMap((id) => score.parts[id].notes.map((n) => n.start + n.duration)),
    );
    const loop = this.loopRange;
    const endBeat = loop ? Math.min(loop.end, total + 1) : total + 0.5;
    const startTime = ctx.currentTime + 0.1;

    // Count-in clicks happen before the music starts.
    for (let i = 0; i < countInBeats; i++) {
      this.scheduleClick(ctx, startTime + i * beatDur, i % score.timeSignature.beats === 0);
    }
    const originTime = startTime + countInBeats * beatDur;

    this.playing = true;
    this.originBeat = fromBeat;
    this.originTime = originTime;
    this.scheduleRange(ctx, fromBeat, endBeat, originTime);
    if (originalBuffer) this.startOriginal(ctx, originalBuffer, fromBeat, originTime);

    this.startTracking();
    this.emit(fromBeat);
  }

  private startTracking(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    const tick = () => {
      if (!this.playing) return;
      const beat = this.position;
      this.emit(beat);
      const loop = this.loopRange;
      if (loop && beat >= loop.end - 1e-3) {
        // Restart the loop without the count-in.
        const ctx = this.ensureNodes();
        this.stopNodes();
        this.originBeat = loop.start;
        this.originTime = ctx.currentTime + 0.03;
        this.scheduleRange(ctx, loop.start, loop.end, this.originTime);
        this.emit(loop.start);
      }
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopNodes(): void {
    for (const node of this.scheduled) node.stop();
    this.scheduled = [];
    if (this.originalSource) {
      try {
        this.originalSource.stop();
      } catch {
        /* already stopped */
      }
      this.originalSource = null;
    }
  }

  pause(): void {
    if (!this.playing) return;
    const beat = this.position;
    this.playing = false;
    this.originBeat = beat;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.stopNodes();
    this.emit(beat);
  }

  stop(): void {
    this.playing = false;
    this.originBeat = 0;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.stopNodes();
    this.emit(0);
  }

  seek(beat: number): void {
    const wasPlaying = this.playing;
    this.stopNodes();
    this.originBeat = beat;
    if (wasPlaying) {
      void this.play(beat);
    } else {
      this.emit(beat);
    }
  }

  /** Decodes any audio file the browser can read. */
  async decodeFile(file: File | ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensureNodes();
    const buffer = file instanceof File ? await file.arrayBuffer() : file;
    return await new Promise<AudioBuffer>((resolve, reject) => {
      // decodeAudioData uses callbacks in older Safari and promises elsewhere.
      const maybePromise = ctx.decodeAudioData(buffer.slice(0), resolve, reject);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(resolve).catch(reject);
      }
    });
  }

  /** Mono analysis buffer from a decoded file. */
  static toMonoPcm(buffer: AudioBuffer): Float32Array {
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    if (channels.length === 1) return channels[0];
    const length = buffer.length;
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i];
      out[i] = sum / channels.length;
    }
    return out;
  }
}
