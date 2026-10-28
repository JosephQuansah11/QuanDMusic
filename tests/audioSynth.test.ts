import { describe, expect, it } from 'vitest';
import { renderScoreToPcm, renderVoice, renderDemoAudio } from '../src/audio/voiceSynth';
import { magnitudeSpectrogram } from '../src/dsp/fft';
import { decodeWav, encodeWav } from '../src/audio/wav';
import { analyzeAudio } from '../src/dsp/analyze';
import { DEMO_SCORE } from '../src/core/demo';
import { PART_IDS, totalBeats } from '../src/core/score';

const SR = 22050;

describe('voice synthesis', () => {
  it('renders a note with energy around its fundamental', () => {
    const pcm = new Float32Array(SR);
    renderVoice(pcm, SR, 60, 0, 1, { vowel: 'ah' });
    let energy = 0;
    for (let i = 0; i < pcm.length; i++) energy += pcm[i] * pcm[i];
    expect(energy).toBeGreaterThan(0.01);
  });

  it('renders the whole demo without clipping', () => {
    const pcm = renderScoreToPcm(DEMO_SCORE, [...PART_IDS], { sampleRate: SR });
    const expected = (totalBeats(DEMO_SCORE) * (60 / DEMO_SCORE.tempo) + 0.6) * SR;
    expect(pcm.length).toBeGreaterThan(expected * 0.9);
    let max = 0;
    for (let i = 0; i < pcm.length; i++) max = Math.max(max, Math.abs(pcm[i]));
    expect(max).toBeLessThanOrEqual(0.9501);
    expect(max).toBeGreaterThan(0.3);
  });
});

describe('wav encoding', () => {
  it('round trips 16 bit audio', () => {
    const pcm = new Float32Array(1000);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * i) / 50) * 0.5;
    const wav = encodeWav(pcm, 44100);
    const decoded = decodeWav(wav);
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.pcm.length).toBe(pcm.length);
    for (let i = 0; i < 20; i++) expect(decoded.pcm[i]).toBeCloseTo(pcm[i], 2);
  });
});

describe('analysing the synthesized demo', () => {
  it('recovers tempo, key and four parts from the rendered demo audio', () => {
    const pcm = renderDemoAudio(SR);
    const result = analyzeAudio(pcm, SR, { title: 'Analysed demo' });
    expect(result.score.tempo).toBeGreaterThan(80);
    expect(result.score.tempo).toBeLessThan(115);
    expect(result.score.key.mode).toBe('major');
    expect(result.detectedNoteCount).toBeGreaterThan(8);
    for (const id of PART_IDS) {
      expect(result.score.parts[id].notes.length, id).toBeGreaterThan(0);
    }
    expect(result.score.source).toBe('audio');
  }, 120000);
});

describe('synthesis tuning', () => {
  it('holds a steady pitch while the vibrato runs', () => {
    const pcm = new Float32Array(SR * 2);
    renderVoice(pcm, SR, 60, 0, 1.5, { vowel: 'ah', vibratoCents: 12 });
    const spec = magnitudeSpectrogram(pcm, SR, 8192, 2048);
    const binHz = SR / 8192;
    const expected = 261.63;
    for (const frame of [1, 3, 5]) {
      const base = frame * spec.bins;
      // The formant boosts upper partials, so look for the fundamental itself.
      let best = 0;
      let bestBin = 0;
      const centre = Math.round(expected / binHz);
      for (let b = centre - 8; b <= centre + 8; b++) {
        if (spec.data[base + b] > best) {
          best = spec.data[base + b];
          bestBin = b;
        }
      }
      const hz = bestBin * binHz;
      // Within a semitone through the whole note: the old phase bug drifted by
      // more than two semitones here.
      expect(Math.abs(1200 * Math.log2(hz / expected))).toBeLessThan(100);
    }
  });
});
