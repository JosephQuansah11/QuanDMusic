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
  /** Minimum fundamental strength (relative to the frame peak). */
  minFundamental?: number;
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
  const binHz = spec.sampleRate / spec.frameSize;
  const centsTolerance = 55;

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
        // The FFT cannot resolve better than one bin, so the matching window is
        // never narrower than three quarters of a bin (important for bass notes
        // and for vibrato, which spreads energy over neighbouring bins).
        const tolerance = Math.max(centsTolerance, 1200 * Math.log2(1 + (0.75 * binHz) / target));
        const low = lowerBound(peaks, target * Math.pow(2, -tolerance / 1200));
        let best = 0;
        for (let k = low; k < peaks.length; k++) {
          const peak = peaks[k];
          const cents = Math.abs(1200 * Math.log2(peak.freq / target));
          if (cents > tolerance) break;
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

/** Three-frame moving average, so a single noisy frame cannot start a note. */
export function smoothSalience(salience: SalienceMap): void {
  const { values, fundamental, frames, count } = salience;
  const copy = values.slice();
  const copyFundamental = fundamental.slice();
  for (let f = 1; f < frames - 1; f++) {
    const base = f * count;
    for (let index = 0; index < count; index++) {
      const i = base + index;
      values[i] = (copy[i - count] + copy[i] + copy[i + count]) / 3;
      fundamental[i] = Math.max(copyFundamental[i - count], copyFundamental[i], copyFundamental[i + count]);
    }
  }
}

export interface PitchRun {
  index: number;
  startFrame: number;
  endFrame: number;
  meanSalience: number;
  meanFundamental: number;
}

/**
 * Finds sustained pitches with hysteresis, then keeps at most `maxVoices`
 * overlapping runs. Working on runs instead of single frames avoids chopping a
 * held note into dozens of fragments when one frame dips.
 */
export function findPitchRuns(salience: SalienceMap, options: MultiPitchOptions = {}): PitchRun[] {
  const { frames, count, values, fundamental } = salience;
  const onThreshold = options.threshold ?? 0.22;
  const offThreshold = onThreshold * 0.65;
  const minFrames = options.minFrames ?? 6;
  const maxGapFrames = options.maxGapFrames ?? 3;
  const minFundamental = options.minFundamental ?? 0.05;
  const runs: PitchRun[] = [];

  for (let index = 0; index < count; index++) {
    let active = false;
    let startFrame = -1;
    let gap = 0;
    let sum = 0;
    let fundSum = 0;
    let counted = 0;

    const close = (endFrame: number) => {
      const length = endFrame - startFrame;
      if (length > 0 && counted > 0) {
        runs.push({
          index,
          startFrame,
          endFrame,
          meanSalience: sum / counted,
          meanFundamental: fundSum / counted,
        });
      }
      active = false;
      startFrame = -1;
      gap = 0;
      sum = 0;
      fundSum = 0;
      counted = 0;
    };

    for (let f = 0; f < frames; f++) {
      const i = f * count + index;
      const value = values[i];
      const on = active ? value > offThreshold : value > onThreshold;
      if (on) {
        if (!active) {
          active = true;
          startFrame = f;
        }
        gap = 0;
        sum += value;
        fundSum += fundamental[i];
        counted++;
      } else if (active) {
        gap++;
        if (gap > maxGapFrames) close(f - gap + 1);
      }
    }
    if (active) close(frames);
  }

  return runs
    .filter((run) => run.endFrame - run.startFrame >= minFrames && run.meanFundamental >= minFundamental)
    .sort((a, b) => b.meanSalience - a.meanSalience);
}

function overlapFrames(a: PitchRun, b: PitchRun): number {
  return Math.max(0, Math.min(a.endFrame, b.endFrame) - Math.max(a.startFrame, b.startFrame));
}

/** Keeps the strongest runs while respecting the polyphony limit and the octave rule. */
export function selectRuns(runs: PitchRun[], frames: number, options: MultiPitchOptions = {}): PitchRun[] {
  const maxVoices = options.maxVoices ?? 4;
  const overlap = new Int16Array(frames + 1);
  const accepted: PitchRun[] = [];

  for (const run of runs) {
    // Drop a note that is only the octave of a stronger, lower note.
    const lower = accepted.find(
      (other) => other.index === run.index - 12 && overlapFrames(other, run) > 0.4 * (run.endFrame - run.startFrame),
    );
    if (lower && lower.meanSalience > 0.55 * run.meanSalience && run.meanFundamental < 0.75 * lower.meanFundamental) {
      continue;
    }
    let fits = true;
    for (let f = run.startFrame; f < run.endFrame; f++) {
      if (overlap[f] + 1 > maxVoices) {
        fits = false;
        break;
      }
    }
    if (!fits) continue;
    for (let f = run.startFrame; f < run.endFrame; f++) overlap[f]++;
    accepted.push(run);
  }

  return accepted;
}

export function detectNotes(
  spec: Spectrogram,
  harmonicSpec: Float32Array,
  options: MultiPitchOptions = {},
): DetectedNote[] {
  const salience = pitchSalience(spec, harmonicSpec, options);
  smoothSalience(salience);
  const runs = selectRuns(findPitchRuns(salience, options), salience.frames, options);
  const hopSeconds = spec.hopSize / spec.sampleRate;

  return runs
    .map((run) => {
      const start = run.startFrame * hopSeconds;
      const end = run.endFrame * hopSeconds;
      return {
        midi: salience.minMidi + run.index,
        start,
        end: Math.max(start + hopSeconds, end),
        velocity: Math.max(0.2, Math.min(1, run.meanSalience)),
        salience: run.meanSalience,
      };
    })
    .sort((a, b) => a.start - b.start || b.midi - a.midi);
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
