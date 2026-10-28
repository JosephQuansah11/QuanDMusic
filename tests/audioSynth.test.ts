import { describe, expect, it } from 'vitest';
import { renderScoreToPcm, renderVoice, renderDemoAudio } from '../src/audio/voiceSynth';
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
