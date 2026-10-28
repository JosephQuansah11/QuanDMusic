/**
 * Monophonic pitch detection for the practice room (microphone input).
 * Autocorrelation with parabolic interpolation; cheap enough for the UI thread.
 */

export interface PitchResult {
  /** Hz, 0 when nothing was detected. */
  frequency: number;
  /** 0..1, how periodic the signal is. */
  clarity: number;
  /** Nearest MIDI note, null when nothing was detected. */
  midi: number | null;
  /** Deviation from the nearest equal-tempered note, in cents. */
  cents: number;
}

export function detectPitch(
  buffer: Float32Array,
  sampleRate: number,
  minHz = 65,
  maxHz = 1200,
): PitchResult {
  const size = buffer.length;
  if (size < 256) return { frequency: 0, clarity: 0, midi: null, cents: 0 };

  let mean = 0;
  for (let i = 0; i < size; i++) mean += buffer[i];
  mean /= size;
  const samples = new Float32Array(size);
  for (let i = 0; i < size; i++) samples[i] = buffer[i] - mean;

  let energy = 0;
  for (let i = 0; i < size; i++) energy += samples[i] * samples[i];
  if (energy / size < 1e-6) return { frequency: 0, clarity: 0, midi: null, cents: 0 };

  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(size - 1, Math.ceil(sampleRate / minHz));
  const correlations = new Float32Array(maxLag + 1);

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let normA = 0;
    let normB = 0;
    const limit = size - lag;
    for (let i = 0; i < limit; i++) {
      const a = samples[i];
      const b = samples[i + lag];
      sum += a * b;
      normA += a * a;
      normB += b * b;
    }
    const denom = Math.sqrt(normA * normB) || 1;
    correlations[lag] = sum / denom;
  }

  let bestLag = minLag;
  let bestValue = -1;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const value = correlations[lag];
    if (value > bestValue && value >= correlations[lag - 1] && value >= correlations[lag + 1]) {
      bestValue = value;
      bestLag = lag;
    }
  }
  if (bestValue <= 0.2) return { frequency: 0, clarity: Math.max(0, bestValue), midi: null, cents: 0 };

  const left = correlations[bestLag - 1];
  const right = correlations[bestLag + 1];
  const denom = left - 2 * bestValue + right;
  const shift = denom !== 0 ? (0.5 * (left - right)) / denom : 0;
  const refinedLag = bestLag + Math.max(-0.5, Math.min(0.5, shift));
  const frequency = sampleRate / refinedLag;
  const midiFloat = 69 + 12 * Math.log2(frequency / 440);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);

  return { frequency, clarity: bestValue, midi, cents };
}
