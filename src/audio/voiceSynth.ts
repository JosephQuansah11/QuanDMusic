/**
 * Offline voice synthesis.
 *
 * Used for the "sung" guide track of a part, for downloadable practice WAVs,
 * and for the demo audio that the analyser can be tried on without an upload.
 * Pure TypeScript, so it also runs in tests.
 */

import { beatDurationSeconds, PART_IDS, type PartId, type Score } from '../core/score';
import { midiToFrequency } from '../core/pitch';
import { DEMO_SCORE } from '../core/demo';

export type Vowel = 'ah' | 'oh' | 'oo' | 'ee';

/** Formant frequencies (F1, F2, F3) and gains for a few vowels. */
const VOWELS: Record<Vowel, { freqs: [number, number, number]; gains: [number, number, number] }> = {
  ah: { freqs: [730, 1090, 2440], gains: [1, 0.5, 0.28] },
  oh: { freqs: [570, 840, 2410], gains: [1, 0.55, 0.2] },
  oo: { freqs: [300, 870, 2240], gains: [1, 0.35, 0.15] },
  ee: { freqs: [270, 2290, 3010], gains: [1, 0.45, 0.3] },
};

export interface VoiceOptions {
  sampleRate?: number;
  vowel?: Vowel;
  /** Vibrato depth in cents. */
  vibratoCents?: number;
  vibratoRate?: number;
  /** Attack and release in seconds. */
  attack?: number;
  release?: number;
  gain?: number;
}

/**
 * A tiny formant synthesiser: a harmonic stack shaped by three resonances,
 * with vibrato and an envelope. Not a real singer, but it carries pitch,
 * rhythm and vowels clearly enough to practise with.
 */
export function renderVoice(
  pcm: Float32Array,
  sampleRate: number,
  midi: number,
  startSeconds: number,
  durationSeconds: number,
  options: VoiceOptions = {},
): void {
  const vowel = VOWELS[options.vowel ?? 'ah'];
  const attack = options.attack ?? 0.03;
  const release = options.release ?? 0.09;
  const vibratoCents = options.vibratoCents ?? 8;
  const vibratoRate = options.vibratoRate ?? 5.2;
  const gain = options.gain ?? 1;
  const start = Math.floor(startSeconds * sampleRate);
  const length = Math.floor(durationSeconds * sampleRate);
  const baseFreq = midiToFrequency(midi);
  const maxHarmonic = Math.min(18, Math.floor((sampleRate / 2 - 100) / baseFreq));

  let phase = 0;
  const phaseStep = (2 * Math.PI) / sampleRate;

  for (let i = 0; i < length; i++) {
    const index = start + i;
    if (index < 0) continue;
    if (index >= pcm.length) break;
    const t = i / sampleRate;
    const envelope =
      Math.min(1, t / Math.max(1e-4, attack)) *
      Math.min(1, Math.max(0, (durationSeconds - t) / Math.max(1e-4, release)));
    if (envelope <= 0) continue;

    // Vibrato must modulate the *phase increment*, not the phase itself:
    // using sin(2*pi*f(t)*t) would drag the pitch flat as t grows.
    const freq = baseFreq * (1 + (vibratoCents / 1200) * Math.sin(2 * Math.PI * vibratoRate * t));
    phase += phaseStep * freq;
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI;

    let sample = 0;
    for (let h = 1; h <= maxHarmonic; h++) {
      const harmonicFreq = freq * h;
      let amplitude = 1 / Math.pow(h, 1.35);
      let formantGain = 0.12;
      for (let f = 0; f < 3; f++) {
        const bandwidth = 110 + f * 60;
        const distance = (harmonicFreq - vowel.freqs[f]) / bandwidth;
        formantGain += vowel.gains[f] * Math.exp(-0.5 * distance * distance);
      }
      amplitude *= formantGain;
      if (h % 2 === 0) amplitude *= 0.85;
      sample += amplitude * Math.sin(phase * h + h * 0.7);
    }
    pcm[index] += sample * envelope * gain * 0.09;
  }
}

/** Options for rendering whole parts, including an optional practice beat. */
export interface RenderPartOptions extends VoiceOptions {
  metronome?: boolean;
}

/** Renders one or more parts of a score to mono PCM. */
export function renderScoreToPcm(score: Score, parts: PartId[], options: RenderPartOptions = {}): Float32Array {
  const sampleRate = options.sampleRate ?? 44100;
  const beat = beatDurationSeconds(score.tempo);
  const endBeat = Math.max(
    1,
    ...parts.flatMap((id) => score.parts[id].notes.map((n) => n.start + n.duration)),
  );
  const totalSeconds = endBeat * beat + 0.6;
  const pcm = new Float32Array(Math.ceil(totalSeconds * sampleRate));
  const vowels: Record<PartId, Vowel> = { S: 'ah', A: 'ah', T: 'oh', B: 'oo' };

  for (const id of parts) {
    for (const note of score.parts[id].notes) {
      renderVoice(pcm, sampleRate, note.midi, note.start * beat, note.duration * beat * 0.97, {
        ...options,
        vowel: options.vowel ?? vowels[id],
        gain: (options.gain ?? 1) * note.velocity,
      });
    }
  }

  if (options.metronome) {
    const clickLength = Math.floor(0.02 * sampleRate);
    for (let b = 0; b * beat < totalSeconds; b++) {
      const start = Math.floor(b * beat * sampleRate);
      for (let i = 0; i < clickLength && start + i < pcm.length; i++) {
        const envelope = Math.exp(-i / (0.0035 * sampleRate));
        pcm[start + i] += (Math.random() * 2 - 1) * 0.12 * envelope;
      }
    }
  }

  let max = 0;
  for (let i = 0; i < pcm.length; i++) max = Math.max(max, Math.abs(pcm[i]));
  if (max > 0) {
    const scale = 0.9 / max;
    for (let i = 0; i < pcm.length; i++) pcm[i] *= scale;
  }
  return pcm;
}

/** The demo chorale as audio, used by "analyse the demo performance". */
export function renderDemoAudio(sampleRate = 44100): Float32Array {
  return renderScoreToPcm(DEMO_SCORE, [...PART_IDS], { sampleRate, metronome: true });
}
