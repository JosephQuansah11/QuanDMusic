/**
 * Harmonic/percussive source separation with median filtering.
 *
 * The harmonic part feeds pitch detection (voices), the percussive part feeds
 * onset detection (rhythm). This is the classic Fitzgerald / Driedger
 * approach, implemented on plain typed arrays.
 */

import type { Spectrogram } from './fft';

export interface HpssResult {
  harmonic: Float32Array;
  percussive: Float32Array;
  frames: number;
  bins: number;
}

/** Quickselect based median of the first `count` entries of `values`. */
function medianInPlace(values: Float32Array, count: number): number {
  if (count <= 0) return 0;
  // Insertion sort: windows are tiny (7-31), so this beats a full sort.
  for (let i = 1; i < count; i++) {
    const value = values[i];
    let j = i - 1;
    while (j >= 0 && values[j] > value) {
      values[j + 1] = values[j];
      j--;
    }
    values[j + 1] = value;
  }
  const mid = count >> 1;
  return count % 2 === 0 ? (values[mid - 1] + values[mid]) / 2 : values[mid];
}

function medianFilterTime(data: Float32Array, frames: number, bins: number, radius: number): Float32Array {
  const out = new Float32Array(data.length);
  const scratch = new Float32Array(radius * 2 + 1);
  for (let b = 0; b < bins; b++) {
    for (let f = 0; f < frames; f++) {
      let count = 0;
      const from = Math.max(0, f - radius);
      const to = Math.min(frames - 1, f + radius);
      for (let k = from; k <= to; k++) scratch[count++] = data[k * bins + b];
      out[f * bins + b] = medianInPlace(scratch, count);
    }
  }
  return out;
}

function medianFilterFrequency(data: Float32Array, frames: number, bins: number, radius: number): Float32Array {
  const out = new Float32Array(data.length);
  const scratch = new Float32Array(radius * 2 + 1);
  for (let f = 0; f < frames; f++) {
    const base = f * bins;
    for (let b = 0; b < bins; b++) {
      let count = 0;
      const from = Math.max(0, b - radius);
      const to = Math.min(bins - 1, b + radius);
      for (let k = from; k <= to; k++) scratch[count++] = data[base + k];
      out[base + b] = medianInPlace(scratch, count);
    }
  }
  return out;
}

export interface HpssOptions {
  timeRadius?: number;
  freqRadius?: number;
  /** Exponent of the soft mask; 2 is a good default. */
  power?: number;
}

export function hpss(spec: Spectrogram, options: HpssOptions = {}): HpssResult {
  const timeRadius = options.timeRadius ?? 4;
  const freqRadius = options.freqRadius ?? 4;
  const power = options.power ?? 2;
  const { frames, bins, data } = spec;

  const harmonicMedian = medianFilterTime(data, frames, bins, timeRadius);
  const percussiveMedian = medianFilterFrequency(data, frames, bins, freqRadius);

  const harmonic = new Float32Array(data.length);
  const percussive = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const h = Math.pow(harmonicMedian[i], power);
    const p = Math.pow(percussiveMedian[i], power);
    const sum = h + p + 1e-12;
    harmonic[i] = (data[i] * h) / sum;
    percussive[i] = (data[i] * p) / sum;
  }
  return { harmonic, percussive, frames, bins };
}
