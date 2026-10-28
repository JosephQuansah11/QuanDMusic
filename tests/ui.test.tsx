// @vitest-environment jsdom
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App';

// jsdom has no audio hardware: give the player the smallest possible stubs.
class StubAudioContext {
  currentTime = 0;
  state = 'running';
  destination = {};
  createGain() {
    return {
      gain: { value: 1, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined },
      connect: () => undefined,
    };
  }
  createOscillator() {
    return {
      frequency: { value: 0 },
      detune: { value: 0 },
      type: 'sine',
      connect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
      setPeriodicWave: () => undefined,
    };
  }
  createBufferSource() {
    return { buffer: null, connect: () => undefined, start: () => undefined, stop: () => undefined };
  }
  createPeriodicWave() {
    return {};
  }
  resume() {
    return Promise.resolve();
  }
  decodeAudioData(_data: ArrayBuffer, ok: (buffer: unknown) => void) {
    ok({ duration: 1, sampleRate: 22050, length: 22050, numberOfChannels: 1, getChannelData: () => new Float32Array(22050) });
  }
}

beforeAll(() => {
  // Tell React that this environment supports act().
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('AudioContext', StubAudioContext);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
  // VexFlow measures text through a 2D canvas; jsdom returns null without node-canvas.
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

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('app shell', () => {
  it('renders the upload screen and the demo score', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });
    await flush();

    expect(container.textContent).toContain('Split any song into Soprano, Alto, Tenor and Bass');
    const buttons = Array.from(container.querySelectorAll('button'));
    const demo = buttons.find((button) => button.textContent?.includes('demo chorale'));
    expect(demo).toBeTruthy();

    await act(async () => {
      demo?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    await flush();

    expect(container.textContent).toContain('QuanD Demo Chorale');
    const svg = container.querySelector('.score-canvas svg');
    expect(svg).not.toBeNull();
    // Clefs, accidentals and noteheads all end up as paths.
    expect(svg?.querySelectorAll('path').length ?? 0).toBeGreaterThan(10);

    const tabs = Array.from(container.querySelectorAll('button.tab')).map((tab) => tab.textContent);
    expect(tabs).toEqual(['Upload', 'Score', 'Practice', 'Instrument', 'Offline']);

    root.unmount();
    container.remove();
  }, 30000);

  it('opens the practice and instrument tabs without crashing', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await flush();

    const demo = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('demo chorale'),
    );
    await act(async () => {
      demo?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    await flush();

    const clickTab = async (label: string) => {
      const tab = Array.from(container.querySelectorAll('button.tab')).find((button) => button.textContent === label);
      await act(async () => {
        tab?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();
      await flush();
    };

    await clickTab('Practice');
    expect(container.textContent).toContain('Practice room');
    expect(container.textContent).toContain('Soprano guide');

    await clickTab('Instrument');
    expect(container.textContent).toContain('Play it on your instrument');
    expect(container.textContent).toContain('Playing flats in this key');
    // The generated trumpet fingering for written C4 in C major is "open".
    expect(container.textContent).toContain('open');

    await clickTab('Offline');
    expect(container.textContent).toContain('Offline and on your device');

    root.unmount();
    container.remove();
  }, 30000);
});
