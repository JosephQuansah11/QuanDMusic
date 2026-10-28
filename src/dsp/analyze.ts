/**
 * The audio analysis pipeline.
 *
 * audio (mono PCM) -> spectrogram -> harmonic/percussive split
 *   harmonic   -> key estimate, polyphonic note detection
 *   percussive -> onsets -> tempo -> beat grid -> quantisation
 * -> SATB voice assignment -> Score
 *
 * Everything here is pure: no Web Audio, no DOM. The browser decodes the file
 * and hands the samples over; Node can call this directly in tests.
 */

import { magnitudeSpectrogram, normalize, resample, type Spectrogram } from './fft';
import { hpss } from './hpss';
import { onsetTimes, spectralFlux } from './onsets';
import { beatGrid, estimateTempo, onsetEnvelope, secondsToBeats, type BeatGrid } from './tempo';
import { chromaFromSpectrogram, detectNotes } from './multipitch';
import { estimateKeyFromChroma } from '../core/keydetect';
import { quantizeNotes, trimOverlaps } from '../core/quantize';
import { assignVoices } from '../core/voices';
import { PART_IDS, type Score, type TimeSignature } from '../core/score';
import type { Key } from '../core/keys';

export interface AnalyzeOptions {
  title?: string;
  /** Internal analysis rate; 22050 Hz is plenty for singing voices. */
  targetSampleRate?: number;
  frameSize?: number;
  hopSize?: number;
  /** Quantisation grid in beats. */
  grid?: number;
  minMidi?: number;
  maxMidi?: number;
  maxVoices?: number;
  /** Salience threshold for a note to start. */
  threshold?: number;
  onProgress?: (stage: string, ratio: number) => void;
}

export interface AnalyzeResult {
  score: Score;
  beatGrid: BeatGrid;
  tempoConfidence: number;
  keyConfidence: number;
  detectedNoteCount: number;
  key: Key;
  timeSignature: TimeSignature;
  onsets: number;
}

export const ANALYSIS_SAMPLE_RATE = 22050;

/** Guesses the metre by looking at which beats carry the strongest onsets. */
function inferMeter(flux: Float32Array, grid: BeatGrid, frameRate: number): TimeSignature {
  const beatFrames = Math.max(1, Math.round(grid.beatDuration * frameRate));
  const candidates: { beats: number; score: number }[] = [];
  for (const beats of [4, 3, 2, 6]) {
    let accented = 0;
    let accentedCount = 0;
    let others = 0;
    let othersCount = 0;
    for (let beat = 0; beat * beatFrames < flux.length; beat++) {
      const frame = Math.round(beat * beatFrames + grid.phaseSeconds * frameRate);
      if (frame < 0 || frame >= flux.length) continue;
      const strength = flux[frame];
      if (beat % beats === 0) {
        accented += strength;
        accentedCount++;
      } else {
        others += strength;
        othersCount++;
      }
    }
    const accentedMean = accentedCount ? accented / accentedCount : 0;
    const othersMean = othersCount ? others / othersCount : 0;
    candidates.push({ beats, score: othersMean > 0 ? accentedMean / othersMean : 0 });
  }
  // 4/4 is the default; another metre has to be clearly stronger to win.
  const fourFour = candidates.find((c) => c.beats === 4)?.score ?? 0;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const beats = best.beats !== 4 && best.score < fourFour * 1.15 ? 4 : best.beats;
  return { beats, beatUnit: 4 };
}

export function analyzeAudio(
  pcm: Float32Array,
  sampleRate: number,
  options: AnalyzeOptions = {},
): AnalyzeResult {
  const targetRate = options.targetSampleRate ?? ANALYSIS_SAMPLE_RATE;
  const frameSize = options.frameSize ?? 2048;
  const hopSize = options.hopSize ?? 256;
  const grid = options.grid ?? 0.25;
  const report = options.onProgress ?? (() => undefined);

  if (pcm.length === 0) throw new Error('The audio file is empty');

  report('Preparing audio', 0.05);
  const mono = normalize(resample(pcm, sampleRate, targetRate));

  report('Building spectrogram', 0.2);
  const spec: Spectrogram = magnitudeSpectrogram(mono, targetRate, frameSize, hopSize);

  report('Separating harmony from rhythm', 0.45);
  const separated = hpss(spec);

  report('Detecting notes in every part', 0.75);
  const detected = detectNotes(spec, separated.harmonic, {
    minMidi: options.minMidi ?? 40,
    maxMidi: options.maxMidi ?? 84,
    maxVoices: options.maxVoices ?? 4,
    threshold: options.threshold ?? 0.22,
  });

  report('Detecting key', 0.85);
  // The full harmonic spectrogram is more reliable than the detected notes,
  // which can lose quiet inner voices.
  const keyEstimate = estimateKeyFromChroma(chromaFromSpectrogram(spec, separated.harmonic));

  report('Finding onsets and tempo', 0.6);
  const percussiveFlux = spectralFlux(separated.percussive, spec.frames, spec.bins);
  const frameRate = targetRate / hopSize;
  const envelope = onsetEnvelope(percussiveFlux, 3);
  const tempoEstimate = estimateTempo(envelope, frameRate, { minBpm: 50, maxBpm: 200 });
  const durationSeconds = mono.length / targetRate;
  const gridInfo = beatGrid(envelope, frameRate, tempoEstimate, durationSeconds);
  const onsets = onsetTimes(spec, separated.percussive, {
    medianMultiplier: 1.4,
    offset: 0.01,
    minGapFrames: 3,
  });

  report('Quantising rhythm and building parts', 0.92);
  const noteEvents = detected.map((note) => {
    const startBeat = Math.max(0, secondsToBeats(note.start, gridInfo));
    const endBeat = Math.max(startBeat + 0.05, secondsToBeats(note.end, gridInfo));
    return {
      midi: note.midi,
      start: startBeat,
      duration: endBeat - startBeat,
      velocity: note.velocity,
    };
  });

  const quantized = quantizeNotes(noteEvents, { grid, minDuration: grid });
  const parts = assignVoices(quantized);
  for (const id of PART_IDS) parts[id].notes = trimOverlaps(parts[id].notes);

  const timeSignature = inferMeter(percussiveFlux, gridInfo, frameRate);
  const tempo = Math.max(20, Math.min(300, Math.round(tempoEstimate.bpm)));

  const noteCount = PART_IDS.reduce((sum, id) => sum + parts[id].notes.length, 0);
  const score: Score = {
    title: options.title ?? 'Analysed audio',
    composer: '',
    tempo,
    timeSignature,
    key: keyEstimate.key,
    source: 'audio',
    parts,
    confidence: tempoEstimate.confidence,
    notes: `${noteCount} notes detected, key ${keyEstimate.key.mode} (${Math.round(
      keyEstimate.confidence * 100,
    )}% confident), ${onsets.times.length} onsets`,
    createdAt: Date.now(),
  };

  report('Done', 1);
  return {
    score,
    beatGrid: gridInfo,
    tempoConfidence: tempoEstimate.confidence,
    keyConfidence: keyEstimate.confidence,
    detectedNoteCount: noteCount,
    key: keyEstimate.key,
    timeSignature,
    onsets: onsets.times.length,
  };
}
