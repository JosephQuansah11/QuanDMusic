/// <reference lib="webworker" />
/**
 * Runs the audio analysis off the main thread so the page stays responsive.
 */

import { analyzeAudio } from './analyze';

export interface AnalyzeRequest {
  pcm: Float32Array;
  sampleRate: number;
  title: string;
}

export type AnalyzeResponse =
  | { type: 'progress'; stage: string; ratio: number }
  | { type: 'result'; score: ReturnType<typeof analyzeAudio>['score']; meta: Omit<ReturnType<typeof analyzeAudio>, 'score'> }
  | { type: 'error'; message: string };

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  const { pcm, sampleRate, title } = event.data;
  try {
    const result = analyzeAudio(pcm, sampleRate, {
      title,
      onProgress: (stage, ratio) => {
        const message: AnalyzeResponse = { type: 'progress', stage, ratio };
        self.postMessage(message);
      },
    });
    const { score, ...meta } = result;
    const response: AnalyzeResponse = { type: 'result', score, meta };
    self.postMessage(response);
  } catch (error) {
    const response: AnalyzeResponse = {
      type: 'error',
      message: error instanceof Error ? error.message : 'Analysis failed',
    };
    self.postMessage(response);
  }
};
