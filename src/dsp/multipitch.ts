/**
 * Polyphonic pitch detection by harmonic salience.
 *
 * For every candidate MIDI note we add up the energy of its first harmonics in
 * the harmonic spectrogram. Peaks in that salience function are the notes that
 * are sounding; runs of salience become note events.
 */

import type { Spectrogram } from './fft';
import { midiToFrequency } from '../core/pitch';

export interface DetectedNote {
  midi: number;
  /** Seconds. */
  start: number;
  end: number;
  velocity: number;
  salience: number;
}

export interface MultiPitchOptions {
  minMidi?: number;
  maxMidi?: number;
  harmonics?: number;
  /** Salience threshold relative to the strongest note of the frame. */
  threshold?: number;
  maxVoices?: number;
  /** Minimum length of a note, in frames. */
  minFrames?: number;
  /** Frames of silence tolerated inside a note. */
  maxGapFrames?: number;
  /** Frames flatter than this are treated as noise and skipped. */
  maxFlatness?: number;
}

export interface SalienceMap {
  minMidi: number;
  maxMidi: number;
  /** One row of (maxMidi - minMidi + 1) values per frame. */
  values: Float32Array;
  /** Fundamental peak strength relative to the loudest peak of the frame. */
  fundamental: Float32Array;
  frames: number;
  count: number;
}

export interface SpectralPeak {
  /** Interpolated frequency in Hz. */
  freq: number;
  /** Interpolated magnitude. */
  mag: number;
}

/** Local maxima with parabolic interpolation, sorted by frequency. */
export function spectralPeaks(spec: Spectrogram, data: Float32Array, frame: number): SpectralPeak[] {
  const base = frame * spec.bins;
  let frameMax = 0;
  for (let b = 1; b < spec.bins - 1; b++) frameMax = Math.max(frameMax, data[base + b]);
  if (frameMax <= 0) return [];
  const floor = frameMax * 0.01;
  const peaks: SpectralPeak[] = [];
  const binHz = spec.sampleRate / spec.frameSize;

  for (let b = 1; b < spec.bins - 1; b++) {
    const value = data[base + b];
    if (value < floor) continue;
    if (value <= data[base + b - 1] || value < data[base + b + 1]) continue;
    const left = Math.log1p(data[base + b - 1]);
    const centre = Math.log1p(value);
    const right = Math.log1p(data[base + b + 1]);
    const denom = left - 2 * centre + right;
    const shift = denom !== 0 ? (0.5 * (left - right)) / denom : 0;
    const bin = b + Math.max(-0.5, Math.min(0.5, shift));
    peaks.push({ freq: bin * binHz, mag: value });
  }
  return peaks;
}

/** 0 = perfectly tonal, 1 = perfectly flat (noise). */
export function spectralFlatness(spec: Spectrogram, data: Float32Array, frame: number): number {
  const base = frame * spec.bins;
  let logSum = 0;
  let sum = 0;
  let count = 0;
  for (let b = 2; b < spec.bins; b++) {
    const value = data[base + b] + 1e-12;
    logSum += Math.log(value);
    sum += value;
    count++;
  }
  if (count === 0 || sum <= 0) return 1;
  const geometric = Math.exp(logSum / count);
  const arithmetic = sum / count;
  return Math.min(1, geometric / arithmetic);
}

/** Index of the first peak with freq >= target. */
function lowerBound(peaks: SpectralPeak[], target: number): number {
  let low = 0;
  let high = peaks.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (peaks[mid].freq < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Salience of a candidate note: how much of its own harmonic series is present
 * in the frame. Peaks are matched in cents so nearby partials of other notes are
 * not mistaken for harmonics of the candidate.
 */
export function pitchSalience(
  spec: Spectrogram,
  harmonicSpec: Float32Array,
  options: MultiPitchOptions = {},
): SalienceMap {
  const minMidi = options.minMidi ?? 40;
  const maxMidi = options.maxMidi ?? 84;
  const harmonics = options.harmonics ?? 8;
  const count = maxMidi - minMidi + 1;
  const values = new Float32Array(spec.frames * count);
  const fundamental = new Float32Array(spec.frames * count);
  const nyquist = spec.sampleRate / 2;
  const centsTolerance = 60;

  const templates: { targets: number[]; weights: number[]; total: number }[] = [];
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const f0 = midiToFrequency(midi);
    const targets: number[] = [];
    const weights: number[] = [];
    let total = 0;
    for (let h = 1; h <= harmonics; h++) {
      const target = f0 * h;
      if (target >= nyquist * 0.95) break;
      const weight = 1 / h;
      targets.push(target);
      weights.push(weight);
      total += weight;
    }
    templates.push({ targets, weights, total: total || 1 });
  }

  for (let f = 0; f < spec.frames; f++) {
    // Skip noise-like frames (clicks, consonants): they have no stable pitch.
    if (spectralFlatness(spec, harmonicSpec, f) > (options.maxFlatness ?? 0.4)) continue;
    const peaks = spectralPeaks(spec, harmonicSpec, f);
    if (peaks.length === 0) continue;
    let frameMax = 0;
    for (const peak of peaks) frameMax = Math.max(frameMax, peak.mag);
    if (frameMax <= 0) continue;

    for (let index = 0; index < count; index++) {
      const template = templates[index];
      let sum = 0;
      for (let h = 0; h < template.targets.length; h++) {
        const target = template.targets[h];
        const low = lowerBound(peaks, target * Math.pow(2, -centsTolerance / 1200));
        let best = 0;
        for (let k = low; k < peaks.length; k++) {
          const peak = peaks[k];
          const cents = Math.abs(1200 * Math.log2(peak.freq / target));
          if (cents > centsTolerance) break;
          if (peak.mag > best) best = peak.mag;
        }
        sum += template.weights[h] * best;
      }
      values[f * count + index] = sum / template.total / frameMax;
      const f0 = midiToFrequency(minMidi + index);
      const low = lowerBound(peaks, f0 * Math.pow(2, -0.5 / 12));
      let fundamentalPeak = 0;
      for (let k = low; k < peaks.length; k++) {
        const peak = peaks[k];
        if (1200 * Math.log2(peak.freq / f0) > 50) break;
        fundamentalPeak = Math.max(fundamentalPeak, peak.mag);
      }
      fundamental[f * count + index] = fundamentalPeak / frameMax;
    }

    // Sub-octave guard: a note without its own fundamental is probably an
    // artefact of the octave below being strong.
    for (let index = 0; index < count - 12; index++) {
      const own = values[f * count + index];
      if (own <= 0) continue;
      if (fundamental[f * count + index] < 0.05 && values[f * count + index + 12] > own * 0.6) {
        values[f * count + index] = own * 0.3;
      }
    }
  }

  return { minMidi, maxMidi, values, fundamental, frames: spec.frames, count };
}

/** Frame-wise peak picking with a small non-maximum suppression window. */
export function activePitchMap(salience: SalienceMap, options: MultiPitchOptions = {}): Uint8Array {
  const threshold = options.threshold ?? 0.3;
  const maxVoices = options.maxVoices ?? 6;
  const { frames, count, values } = salience;
  const active = new Uint8Array(frames * count);

  for (let f = 0; f < frames; f++) {
    const base = f * count;
    let frameMax = 0;
    for (let index = 0; index < count; index++) frameMax = Math.max(frameMax, values[base + index]);
    if (frameMax < 0.05) continue;
    const limit = frameMax * threshold;
    const candidates: { index: number; value: number }[] = [];
    for (let index = 1; index < count - 1; index++) {
      const value = values[base + index];
      if (value < limit) continue;
      if (value < values[base + index - 1] || value < values[base + index + 1]) continue;
      candidates.push({ index, value });
    }
    candidates.sort((a, b) => b.value - a.value);
    const chosen: number[] = [];
    for (const candidate of candidates) {
      if (chosen.length >= maxVoices) break;
      if (chosen.some((index) => Math.abs(index - candidate.index) <= 1)) continue;
      chosen.push(candidate.index);
    }

    // Harmonic guard: a weak note that sits exactly on a harmonic of a
    // stronger note is usually colour, not a separate voice.
    const kept = chosen.filter((index, position) => {
      const ownFundamental = salience.fundamental[base + index];
      // An octave doubling adds no new voice: drop it when the lower octave is
      // at least as strong and the upper note's fundamental is weak.
      if (index >= 12) {
        const lower = values[base + index - 12];
        if (lower > 0.6 * values[base + index] && ownFundamental < 0.75 * salience.fundamental[base + index - 12]) {
          return false;
        }
      }
      for (let j = 0; j < position; j++) {
        const stronger = chosen[j];
        const ratio = midiToFrequency(salience.minMidi + index) / midiToFrequency(salience.minMidi + stronger);
        const harmonic = Math.round(ratio);
        if (harmonic < 2) continue;
        const cents = Math.abs(1200 * Math.log2(ratio / harmonic));
        if (cents < 45 && ownFundamental < 0.35 * salience.fundamental[base + stronger]) return false;
      }
      return true;
    });
    for (const index of kept) active[base + index] = 1;
  }
  return active;
}

export function detectNotes(
  spec: Spectrogram,
  harmonicSpec: Float32Array,
  options: MultiPitchOptions = {},
): DetectedNote[] {
  const salience = pitchSalience(spec, harmonicSpec, options);
  const active = activePitchMap(salience, options);
  const minFrames = options.minFrames ?? 3;
  const maxGapFrames = options.maxGapFrames ?? 2;
  const { frames, count } = salience;
  const notes: DetectedNote[] = [];
  const hopSeconds = spec.hopSize / spec.sampleRate;

  for (let index = 0; index < count; index++) {
    let runStart = -1;
    let gap = 0;
    let salienceSum = 0;
    let salienceFrames = 0;
    for (let f = 0; f <= frames; f++) {
      const isActive = f < frames && active[f * count + index] === 1;
      if (isActive) {
        if (runStart === -1) runStart = f;
        gap = 0;
        salienceSum += salience.values[f * count + index];
        salienceFrames++;
      } else if (runStart !== -1) {
        gap++;
        if (gap > maxGapFrames || f === frames) {
          const end = f - gap + 1;
          const length = end - runStart;
          if (length >= minFrames && salienceFrames > 0) {
            const startSeconds = runStart * hopSeconds;
            const endSeconds = end * hopSeconds + hopSeconds;
            const meanSalience = salienceSum / salienceFrames;
            notes.push({
              midi: salience.minMidi + index,
              start: startSeconds,
              end: Math.max(startSeconds + hopSeconds, endSeconds),
              velocity: Math.max(0.2, Math.min(1, meanSalience)),
              salience: meanSalience,
            });
          }
          runStart = -1;
          salienceSum = 0;
          salienceFrames = 0;
          gap = 0;
        }
      }
    }
  }

  return notes.sort((a, b) => a.start - b.start || b.midi - a.midi);
}

/** Chroma histogram from a spectrogram, used for key detection. */
export function chromaFromSpectrogram(
  spec: Spectrogram,
  data: Float32Array,
  minHz = 55,
  maxHz = 2000,
): number[] {
  const chroma = new Array(12).fill(0);
  const binHz = spec.sampleRate / spec.frameSize;
  const from = Math.max(1, Math.floor(minHz / binHz));
  const to = Math.min(spec.bins - 1, Math.ceil(maxHz / binHz));
  for (let f = 0; f < spec.frames; f++) {
    const base = f * spec.bins;
    for (let b = from; b <= to; b++) {
      const magnitude = data[base + b];
      if (magnitude <= 1e-4) continue;
      const hz = b * binHz;
      const midi = 69 + 12 * Math.log2(hz / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += magnitude;
    }
  }
  return chroma;
}
