// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ScoreView } from '../src/render/ScoreView';
import { DEMO_SCORE } from '../src/core/demo';
import { transposeScore } from '../src/core/score';
import { chunkMeasures, systemsForMeasureCount, pointToBeat } from '../src/render/layout';

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => ({
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillText: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      scale: () => undefined,
      clearRect: () => undefined,
      fillRect: () => undefined,
      beginPath: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => undefined,
      fill: () => undefined,
      closePath: () => undefined,
      setLineDash: () => undefined,
    }),
  });
});

const OPTIONS = {
  parts: ['S'] as const,
  clefs: {},
  focusPart: 'S' as const,
  solfege: { enabled: true, system: 'movable' as const, display: 'short' as const },
  letters: false,
};

async function renderScore(score: typeof DEMO_SCORE, options = OPTIONS): Promise<HTMLDivElement> {
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: 960, configurable: true });
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ScoreView score={score} options={{ ...options, parts: [...OPTIONS.parts] }} cursorBeat={0} />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

function labels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('text'))
    .map((node) => node.textContent ?? '')
    .filter((text) => /^[drmafslte,']+$/.test(text));
}

describe('score engraving', () => {
  it('draws a staff per part with solfege under every note', async () => {
    const container = await renderScore(DEMO_SCORE);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    // Soprano of the demo: E4 C4 (bar 1) then F4 D4 (bar 2).
    expect(labels(container).slice(0, 4)).toEqual(['m', 'd', 'f', 'r']);
    expect(svg?.querySelectorAll('path').length ?? 0).toBeGreaterThan(20);
    const barNumbers = Array.from(container.querySelectorAll('text')).map((node) => node.textContent);
    expect(barNumbers).toContain('1');
  });

  it('moves the actual pitches and the key when transposed', async () => {
    const letters = { ...OPTIONS, solfege: { enabled: false, system: 'movable' as const, display: 'short' as const }, letters: true };
    const tokens = (root: HTMLElement) =>
      Array.from(root.querySelectorAll('text'))
        .map((node) => node.textContent ?? '')
        .filter((text) => /^[A-G](#|b)?-?\d$/.test(text));

    const original = await renderScore(DEMO_SCORE, letters);
    expect(tokens(original)[0]).toBe('E4');

    const shifted = await renderScore(transposeScore(DEMO_SCORE, 2), letters);
    expect(tokens(shifted)[0]).toBe('F#4');
  });

  it('still engraves keys with many accidentals', async () => {
    const container = await renderScore(transposeScore(DEMO_SCORE, -3));
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(labels(container).length).toBeGreaterThan(4);
  });

  it('switches clef without losing notes', async () => {
    const container = await renderScore(DEMO_SCORE, { ...OPTIONS, clefs: { S: 'bass' } });
    expect(labels(container).length).toBeGreaterThan(4);
  });

  it('draws a cursor that follows the beat', async () => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', { value: 960, configurable: true });
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<ScoreView score={DEMO_SCORE} options={{ ...OPTIONS, parts: ['S'] }} cursorBeat={0} />);
    });
    const rect = container.querySelector('svg rect[fill="#7c5cff"]');
    expect(rect?.getAttribute('x')).toBe('82');
    await act(async () => {
      root.render(<ScoreView score={DEMO_SCORE} options={{ ...OPTIONS, parts: ['S'] }} cursorBeat={4} />);
    });
    const moved = container.querySelector('svg rect[fill="#7c5cff"]');
    expect(Number(moved?.getAttribute('x'))).toBeGreaterThan(82);
  });
});

describe('layout helpers', () => {
  it('clips notes at bar lines and keeps every note', () => {
    const chunks = chunkMeasures(DEMO_SCORE.parts.S, DEMO_SCORE.timeSignature, 8);
    expect(chunks).toHaveLength(8);
    const totalNotes = chunks.reduce((sum, chunk) => sum + chunk.notes.length, 0);
    expect(totalNotes).toBe(DEMO_SCORE.parts.S.notes.length);
    // No chunk may extend past its own measure.
    for (const chunk of chunks) {
      for (const note of chunk.notes) {
        expect(note.start + note.duration).toBeLessThanOrEqual(4 + 1e-6);
      }
    }
  });

  it('wraps bars into systems', () => {
    expect(systemsForMeasureCount(5, 4)).toEqual([[0, 1, 2, 3], [4]]);
    expect(systemsForMeasureCount(0, 4)).toEqual([[0]]);
  });

  it('turns a click into a beat', () => {
    const systems = [[0, 1], [2, 3]];
    const rowTop = (index: number) => index * 100;
    // second bar, halfway: 4 + 2 beats
    expect(pointToBeat(82 + 240 + 120, 10, systems, 240, 82, rowTop, 100, 4)).toBeCloseTo(6, 5);
    // first bar of the second system
    expect(pointToBeat(82 + 10, 150, systems, 240, 82, rowTop, 100, 4)).toBeCloseTo(8.1667, 3);
  });
});

describe('gaps and rests', () => {
  it('fills rests without breaking the measure', async () => {
    const score = {
      ...DEMO_SCORE,
      parts: {
        ...DEMO_SCORE.parts,
        S: {
          id: 'S' as const,
          name: 'Soprano',
          notes: [
            { midi: 72, start: 0, duration: 1, velocity: 0.8 },
            { midi: 74, start: 2.5, duration: 0.5, velocity: 0.8 },
            { midi: 76, start: 3, duration: 1, velocity: 0.8 },
          ],
        },
      },
    };
    const container = await renderScore(score, { ...OPTIONS, parts: ['S'] });
    const texts = Array.from(container.querySelectorAll('text')).map((node) => node.textContent ?? '');
    // C5, D5 and E5 are the upper octave: do', re', mi'.
    expect(texts.filter((text) => /^[drmafslte,']+$/.test(text))).toEqual(["d'", "r'", "m'"]);
    expect(container.querySelectorAll('svg path').length).toBeGreaterThan(5);
  });
});
