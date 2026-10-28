/** Microphone pitch tracking for the practice room. */

import { detectPitch, type PitchResult } from '../dsp/pitchdetect';

export interface MicOptions {
  onPitch: (result: PitchResult) => void;
  onError?: (message: string) => void;
  minHz?: number;
  maxHz?: number;
  intervalMs?: number;
}

export class MicPitchTracker {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private timer: number | null = null;
  private buffer: Float32Array<ArrayBuffer> | null = null;
  private options: MicOptions | null = null;

  get running(): boolean {
    return this.stream !== null;
  }

  async start(options: MicOptions): Promise<void> {
    this.options = options;
    if (!navigator.mediaDevices?.getUserMedia) {
      options.onError?.('This browser does not expose microphone input.');
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
    } catch (error) {
      options.onError?.(
        error instanceof Error && error.name === 'NotAllowedError'
          ? 'Microphone permission was declined. You can still practise with the guide track.'
          : 'No microphone was found.',
      );
      return;
    }

    const Ctor = window.AudioContext;
    this.context = new Ctor();
    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    source.connect(this.analyser);
    this.buffer = new Float32Array(this.analyser.fftSize);

    const interval = options.intervalMs ?? 90;
    this.timer = window.setInterval(() => {
      if (!this.analyser || !this.buffer || !this.context) return;
      this.analyser.getFloatTimeDomainData(this.buffer);
      const result = detectPitch(this.buffer, this.context.sampleRate, options.minHz ?? 65, options.maxHz ?? 1200);
      this.options?.onPitch(result);
    }, interval);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
    this.analyser = null;
    this.buffer = null;
  }
}

/** Plays a single reference pitch. */
export function playReferencePitch(midi: number, durationSeconds = 0.9): void {
  const Ctor = window.AudioContext;
  const ctx = new Ctor();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.02);
  gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + durationSeconds);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + durationSeconds + 0.05);
  setTimeout(() => void ctx.close(), (durationSeconds + 0.3) * 1000);
}
