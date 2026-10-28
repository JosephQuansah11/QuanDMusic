/**
 * FFT and spectrogram helpers.
 *
 * Everything is plain typed-array maths so the analyser can run in a worker,
 * in the main thread, and in Node during tests without any native code.
 */

export interface Spectrogram {
  /** frames * bins magnitudes. */
  data: Float32Array;
  frames: number;
  bins: number;
  sampleRate: number;
  frameSize: number;
  hopSize: number;
}

export function createSpectrogram(
  sampleRate: number,
  frameSize: number,
  hopSize: number,
  frames: number,
): Spectrogram {
  const bins = frameSize / 2 + 1;
  return { data: new Float32Array(frames * bins), frames, bins, sampleRate, frameSize, hopSize };
}

export function binToHz(spec: Spectrogram, bin: number): number {
  return (bin * spec.sampleRate) / spec.frameSize;
}

export function frameToSeconds(spec: Spectrogram, frame: number): number {
  return (frame * spec.hopSize) / spec.sampleRate;
}

/** In-place iterative radix-2 FFT. Length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error('FFT length must be a power of two');

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const vRe = re[b] * curRe - im[b] * curIm;
        const vIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - vRe;
        im[b] = im[a] - vIm;
        re[a] += vRe;
        im[a] += vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

export function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
  return window;
}

/** Magnitude spectrogram of a mono signal. */
export function magnitudeSpectrogram(
  pcm: Float32Array,
  sampleRate: number,
  frameSize = 2048,
  hopSize = 512,
): Spectrogram {
  if (frameSize <= 0 || (frameSize & (frameSize - 1)) !== 0) throw new Error('frameSize must be a power of two');
  const bins = frameSize / 2 + 1;
  const frames = pcm.length <= frameSize ? 1 : Math.floor((pcm.length - frameSize) / hopSize) + 1;
  const spec = createSpectrogram(sampleRate, frameSize, hopSize, frames);
  const window = hannWindow(frameSize);
  const re = new Float64Array(frameSize);
  const im = new Float64Array(frameSize);

  for (let f = 0; f < frames; f++) {
    const offset = f * hopSize;
    for (let i = 0; i < frameSize; i++) {
      const sample = offset + i < pcm.length ? pcm[offset + i] : 0;
      re[i] = sample * window[i];
      im[i] = 0;
    }
    fft(re, im);
    const base = f * bins;
    for (let b = 0; b < bins; b++) {
      spec.data[base + b] = Math.hypot(re[b], im[b]);
    }
  }
  return spec;
}

/** Converts any number of channels into a mono mixdown. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const length = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i];
    out[i] = sum / channels.length;
  }
  return out;
}

/** Linear resampling; used to bring any input down to the analysis rate. */
export function resample(pcm: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) return pcm;
  const ratio = sourceRate / targetRate;
  const length = Math.max(1, Math.floor(pcm.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const frac = position - index;
    const a = pcm[index] ?? 0;
    const b = pcm[index + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Peak level of a signal, 0 when silent. */
export function peak(pcm: Float32Array): number {
  let max = 0;
  for (let i = 0; i < pcm.length; i++) max = Math.max(max, Math.abs(pcm[i]));
  return max;
}

/** Removes DC offset and normalises to a comfortable analysis level. */
export function normalize(pcm: Float32Array, target = 0.9): Float32Array {
  if (pcm.length === 0) return pcm;
  let mean = 0;
  for (let i = 0; i < pcm.length; i++) mean += pcm[i];
  mean /= pcm.length;
  const out = new Float32Array(pcm.length);
  let max = 0;
  for (let i = 0; i < pcm.length; i++) {
    out[i] = pcm[i] - mean;
    max = Math.max(max, Math.abs(out[i]));
  }
  if (max > 0) {
    const gain = target / max;
    for (let i = 0; i < out.length; i++) out[i] *= gain;
  }
  return out;
}
