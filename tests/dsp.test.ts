import { describe, expect, it } from 'vitest';
import { magnitudeSpectrogram, resample, toMono } from '../src/dsp/fft';
import { hpss } from '../src/dsp/hpss';
import { spectralFlux } from '../src/dsp/onsets';
import { beatGrid, estimateTempo, onsetEnvelope } from '../src/dsp/tempo';
import { detectNotes } from '../src/dsp/multipitch';
import { detectPitch } from '../src/dsp/pitchdetect';
import { analyzeAudio } from '../src/dsp/analyze';
import { midiToFrequency } from '../src/core/pitch';

const SR = 22050;

function tone(freq: number, seconds: number, sampleRate = SR, amplitude = 0.28): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    const attack = Math.min(1, t / 0.01);
    out[i] = amplitude * attack * (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t));
  }
  return out;
}

function click(sampleRate = SR): Float32Array {
  const out = new Float32Array(Math.floor(0.02 * sampleRate));
  for (let i = 0; i < out.length; i++) {
    out[i] = (Math.random() * 2 - 1) * 0.8 * Math.exp(-i / (0.003 * sampleRate));
  }
  return out;
}

function mix(buffers: Float32Array[]): Float32Array {
  const length = Math.max(...buffers.map((b) => b.length));
  const out = new Float32Array(length);
  for (const buffer of buffers) {
    for (let i = 0; i < buffer.length; i++) out[i] += buffer[i];
  }
  return out;
}

function overlay(target: Float32Array, source: Float32Array, offsetSeconds: number, sampleRate = SR): Float32Array {
  const offset = Math.floor(offsetSeconds * sampleRate);
  for (let i = 0; i < source.length && offset + i < target.length; i++) target[offset + i] += source[i];
  return target;
}

describe('fft and spectrogram', () => {
  it('finds the frequency of a sine tone', () => {
    const spec = magnitudeSpectrogram(tone(440, 0.5), SR, 2048, 512);
    const frame = 4;
    let peakBin = 0;
    for (let b = 1; b < spec.bins; b++) {
      if (spec.data[frame * spec.bins + b] > spec.data[frame * spec.bins + peakBin]) peakBin = b;
    }
    const hz = (peakBin * SR) / 2048;
    expect(Math.abs(hz - 440)).toBeLessThan(25);
  });

  it('mixes channels and resamples', () => {
    const a = new Float32Array([0, 1, 0, -1]);
    const b = new Float32Array([0, -1, 0, 1]);
    expect(Array.from(toMono([a, b]))).toEqual([0, 0, 0, 0]);
    const resampled = resample(new Float32Array(100).fill(1), 100, 50);
    expect(resampled.length).toBe(50);
    expect(resampled[10]).toBeCloseTo(1, 5);
  });
});

describe('hpss and onsets', () => {
  it('puts sustained tones in the harmonic part and clicks in the percussive part', () => {
    const pcm = new Float32Array(SR * 2);
    overlay(pcm, tone(220, 2), 0);
    for (let i = 0; i < 4; i++) overlay(pcm, click(), i * 0.5);
    const spec = magnitudeSpectrogram(pcm, SR, 1024, 256);
    const { harmonic, percussive } = hpss(spec, { timeRadius: 3, freqRadius: 3 });
    const fluxHarmonic = spectralFlux(harmonic, spec.frames, spec.bins);
    const fluxPercussive = spectralFlux(percussive, spec.frames, spec.bins);
    const mean = (arr: Float32Array) => Array.from(arr).reduce((s, v) => s + v, 0) / arr.length;
    expect(mean(fluxPercussive)).toBeGreaterThan(mean(fluxHarmonic));
  });
});

describe('tempo', () => {
  it('finds 120 bpm from clicks', () => {
    const seconds = 10;
    const pcm = new Float32Array(SR * seconds);
    for (let t = 0; t < seconds; t += 0.5) overlay(pcm, click(), t);
    const spec = magnitudeSpectrogram(pcm, SR, 1024, 256);
    const { percussive } = hpss(spec, { timeRadius: 3, freqRadius: 3 });
    const flux = spectralFlux(percussive, spec.frames, spec.bins);
    const frameRate = SR / 256;
    const env = onsetEnvelope(flux, 3);
    const tempo = estimateTempo(env, frameRate, { minBpm: 60, maxBpm: 180 });
    expect(tempo.bpm).toBeGreaterThan(112);
    expect(tempo.bpm).toBeLessThan(128);

    const grid = beatGrid(env, frameRate, tempo, seconds);
    expect(grid.beats.length).toBeGreaterThan(10);
    expect(grid.beatDuration).toBeCloseTo(0.5, 1);
  });
});

describe('polyphonic detection', () => {
  it('finds the four notes of a chord', () => {
    const chord = mix([
      tone(midiToFrequency(48), 2),
      tone(midiToFrequency(52), 2),
      tone(midiToFrequency(55), 2),
      tone(midiToFrequency(60), 2),
    ]);
    const spec = magnitudeSpectrogram(chord, SR, 2048, 256);
    const { harmonic } = hpss(spec);
    const notes = detectNotes(spec, harmonic, { minMidi: 40, maxMidi: 72, maxVoices: 4 });
    const pitches = Array.from(new Set(notes.map((n) => n.midi))).sort((a, b) => a - b);
    expect(pitches).toEqual([48, 52, 55, 60]);
  });
});

describe('mic pitch detection', () => {
  it('reports the sung note', () => {
    const buffer = tone(midiToFrequency(69), 0.2, 44100);
    const result = detectPitch(buffer, 44100);
    expect(result.midi).toBe(69);
    expect(Math.abs(result.cents)).toBeLessThan(20);
    expect(result.clarity).toBeGreaterThan(0.5);
  });

  it('reports silence as no note', () => {
    expect(detectPitch(new Float32Array(2048), 44100).midi).toBeNull();
  });
});

describe('full analysis', () => {
  it('turns a four-part chord progression into a score', () => {
    const seconds = 6;
    const pcm = new Float32Array(SR * seconds);
    const bars = [
      [48, 52, 55, 60],
      [50, 53, 57, 62],
      [43, 50, 55, 59],
      [48, 52, 55, 60],
    ];
    bars.forEach((chord, index) => {
      const start = index * 1.5;
      chord.forEach((midi) => overlay(pcm, tone(midiToFrequency(midi), 1.4), start));
      for (let beat = 0; beat < 3; beat++) overlay(pcm, click(), start + beat * 0.5);
    });

    const result = analyzeAudio(pcm, SR, { title: 'Test chorale' });
    expect(result.score.title).toBe('Test chorale');
    expect(result.score.tempo).toBeGreaterThan(90);
    expect(result.score.tempo).toBeLessThan(140);
    expect(result.detectedNoteCount).toBeGreaterThan(4);

    const total = (['S', 'A', 'T', 'B'] as const).reduce(
      (sum, id) => sum + result.score.parts[id].notes.length,
      0,
    );
    expect(total).toBeGreaterThan(4);
    expect(['major', 'minor']).toContain(result.score.key.mode);
  }, 30000);
});
