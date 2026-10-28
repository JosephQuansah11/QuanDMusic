/**
 * Onset detection on the percussive spectrogram.
 */

import type { Spectrogram } from './fft';

export interface OnsetOptions {
  /** Multiplier applied to the local median before a peak counts. */
  medianMultiplier?: number;
  /** Absolute floor added to the threshold (0..1 normalised flux). */
  offset?: number;
  /** Minimum gap between onsets in frames. */
  minGapFrames?: number;
}

/** Half-wave rectified log-magnitude spectral flux, normalised to 0..1. */
export function spectralFlux(data: Float32Array, frames: number, bins: number): Float32Array {
  const flux = new Float32Array(frames);
  const previous = new Float32Array(bins);
  for (let b = 0; b < bins; b++) previous[b] = Math.log1p(data[b]);

  for (let f = 1; f < frames; f++) {
    const base = f * bins;
    let sum = 0;
    for (let b = 0; b < bins; b++) {
      const value = Math.log1p(data[base + b]);
      const diff = value - previous[b];
      if (diff > 0) sum += diff;
      previous[b] = value;
    }
    flux[f] = sum;
  }

  let max = 0;
  for (let f = 0; f < frames; f++) max = Math.max(max, flux[f]);
  if (max > 0) for (let f = 0; f < frames; f++) flux[f] /= max;
  return flux;
}

export function spectralFluxOf(spec: Spectrogram, data: Float32Array = spec.data): Float32Array {
  return spectralFlux(data, spec.frames, spec.bins);
}

function median(values: Float32Array, from: number, to: number): number {
  const slice = Array.from(values.slice(Math.max(0, from), Math.min(values.length, to))).sort((a, b) => a - b);
  if (slice.length === 0) return 0;
  const mid = slice.length >> 1;
  return slice.length % 2 === 0 ? (slice[mid - 1] + slice[mid]) / 2 : slice[mid];
}

export interface OnsetPeak {
  frame: number;
  strength: number;
}

export function pickOnsets(flux: Float32Array, options: OnsetOptions = {}): OnsetPeak[] {
  const medianMultiplier = options.medianMultiplier ?? 1.6;
  const offset = options.offset ?? 0.02;
  const minGapFrames = options.minGapFrames ?? 3;
  const window = 12;

  const peaks: OnsetPeak[] = [];
  for (let f = 1; f < flux.length - 1; f++) {
    const value = flux[f];
    if (value <= flux[f - 1] || value < flux[f + 1]) continue;
    const localMedian = median(flux, f - window, f + window + 1);
    const threshold = localMedian * medianMultiplier + offset;
    if (value < threshold) continue;
    const last = peaks[peaks.length - 1];
    if (last && f - last.frame < minGapFrames) {
      if (value > last.strength) {
        last.frame = f;
        last.strength = value;
      }
      continue;
    }
    peaks.push({ frame: f, strength: value });
  }
  return peaks;
}

/** Onset times in seconds. */
export function onsetTimes(
  spec: Spectrogram,
  percussive: Float32Array,
  options: OnsetOptions = {},
): { times: number[]; strengths: number[]; flux: Float32Array } {
  const flux = spectralFlux(percussive, spec.frames, spec.bins);
  const peaks = pickOnsets(flux, options);
  return {
    times: peaks.map((p) => (p.frame * spec.hopSize) / spec.sampleRate),
    strengths: peaks.map((p) => p.strength),
    flux,
  };
}
