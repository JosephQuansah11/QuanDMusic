/**
 * Tempo and beat tracking.
 *
 * 1. The onset envelope is autocorrelated to find the beat period.
 * 2. A log-normal tempo prior resolves half/double tempo ambiguity.
 * 3. A comb filter finds the phase, then beats are written out.
 */

export interface TempoOptions {
  minBpm?: number;
  maxBpm?: number;
  /** Centre of the tempo prior in BPM. */
  priorBpm?: number;
  /** Width of the prior in octaves (higher = weaker prior). */
  priorWidth?: number;
}

export interface TempoEstimate {
  bpm: number;
  confidence: number;
  periodFrames: number;
}

export function onsetEnvelope(flux: Float32Array, smoothing = 3): Float32Array {
  const out = new Float32Array(flux.length);
  if (smoothing <= 1) {
    out.set(flux);
    return out;
  }
  const half = Math.floor(smoothing / 2);
  for (let i = 0; i < flux.length; i++) {
    let sum = 0;
    let count = 0;
    for (let k = -half; k <= half; k++) {
      const index = i + k;
      if (index < 0 || index >= flux.length) continue;
      sum += flux[index];
      count++;
    }
    out[i] = count ? sum / count : 0;
  }
  return out;
}

export function estimateTempo(env: Float32Array, frameRate: number, options: TempoOptions = {}): TempoEstimate {
  const minBpm = options.minBpm ?? 50;
  const maxBpm = options.maxBpm ?? 200;
  const priorBpm = options.priorBpm ?? 110;
  const priorWidth = options.priorWidth ?? 0.75;

  const minLag = Math.max(2, Math.floor((60 * frameRate) / maxBpm));
  const maxLag = Math.min(Math.floor(env.length / 2), Math.ceil((60 * frameRate) / minBpm));
  if (maxLag <= minLag) return { bpm: priorBpm, confidence: 0, periodFrames: (60 * frameRate) / priorBpm };

  // Remove the mean so the autocorrelation measures periodicity, not loudness.
  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i];
  mean /= Math.max(1, env.length);
  const centred = new Float32Array(env.length);
  for (let i = 0; i < env.length; i++) centred[i] = env[i] - mean;

  let bestLag = minLag;
  let bestScore = -Infinity;
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < centred.length; i++) sum += centred[i] * centred[i + lag];
    sum /= centred.length - lag;
    const bpm = (60 * frameRate) / lag;
    const octaves = Math.log2(bpm / priorBpm);
    const prior = Math.exp(-0.5 * Math.pow(octaves / priorWidth, 2));
    const score = sum * prior;
    scores[lag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // Parabolic interpolation around the winning lag for a smoother BPM.
  const left = scores[bestLag - 1] ?? bestScore;
  const right = scores[bestLag + 1] ?? bestScore;
  const denom = left - 2 * bestScore + right;
  const adjust = denom !== 0 ? (0.5 * (left - right)) / denom : 0;
  const refinedLag = bestLag + Math.max(-0.5, Math.min(0.5, adjust));
  const bpm = (60 * frameRate) / refinedLag;

  // Confidence: how much the best lag stands out from the average.
  let total = 0;
  let count = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (scores[lag] === undefined) continue;
    total += Math.abs(scores[lag]);
    count++;
  }
  const average = count ? total / count : 0;
  const confidence = average > 0 ? Math.max(0, Math.min(1, (bestScore / average - 1) / 3)) : 0;

  return { bpm, confidence, periodFrames: refinedLag };
}

export interface BeatGrid {
  bpm: number;
  /** Beat positions in seconds, starting with the first beat. */
  beats: number[];
  /** Offset of the first beat in seconds. */
  phaseSeconds: number;
  /** Seconds per beat. */
  beatDuration: number;
}

export function beatGrid(
  env: Float32Array,
  frameRate: number,
  tempo: TempoEstimate,
  durationSeconds: number,
): BeatGrid {
  const period = tempo.periodFrames;
  const steps = Math.max(1, Math.round(period));
  const phaseScores: number[] = [];

  for (let phase = 0; phase < steps; phase++) {
    let sum = 0;
    for (let frame = phase; frame < env.length; frame += period) {
      const index = Math.round(frame);
      if (index < env.length) sum += env[index];
    }
    phaseScores[phase] = sum;
  }

  let bestPhase = 0;
  for (let phase = 0; phase < steps; phase++) {
    if ((phaseScores[phase] ?? 0) > (phaseScores[bestPhase] ?? 0)) bestPhase = phase;
  }

  const beatDuration = 60 / tempo.bpm;
  const phaseSeconds = (bestPhase / frameRate);
  const beats: number[] = [];
  for (let time = phaseSeconds; time < durationSeconds; time += beatDuration) {
    beats.push(time);
  }
  return { bpm: tempo.bpm, beats, phaseSeconds, beatDuration };
}

/** Time in beats for an arbitrary moment, using a beat grid. */
export function secondsToBeats(seconds: number, grid: BeatGrid): number {
  return (seconds - grid.phaseSeconds) / grid.beatDuration;
}

export function beatsToSeconds(beats: number, grid: BeatGrid): number {
  return grid.phaseSeconds + beats * grid.beatDuration;
}
