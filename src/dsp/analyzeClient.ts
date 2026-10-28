/**
 * Client wrapper around the analysis worker, with a main-thread fallback for
 * browsers without module workers.
 */

import { analyzeAudio, type AnalyzeResult } from './analyze';

export interface AnalyzeProgress {
  stage: string;
  ratio: number;
}

export async function analyzeInWorker(
  pcm: Float32Array,
  sampleRate: number,
  title: string,
  onProgress: (progress: AnalyzeProgress) => void,
): Promise<AnalyzeResult> {
  if (typeof Worker === 'undefined') {
    return analyzeAudio(pcm, sampleRate, { title, onProgress: (stage, ratio) => onProgress({ stage, ratio }) });
  }

  try {
    const worker = new Worker(new URL('./analyze.worker.ts', import.meta.url), { type: 'module' });
    return await new Promise<AnalyzeResult>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent) => {
        const data = event.data as
          | { type: 'progress'; stage: string; ratio: number }
          | { type: 'result'; score: AnalyzeResult['score']; meta: Omit<AnalyzeResult, 'score'> }
          | { type: 'error'; message: string };

        if (data.type === 'progress') {
          onProgress({ stage: data.stage, ratio: data.ratio });
          return;
        }
        worker.terminate();
        if (data.type === 'error') {
          reject(new Error(data.message));
          return;
        }
        resolve({ score: data.score, ...data.meta });
      };
      worker.onerror = () => {
        worker.terminate();
        try {
          const result = analyzeAudio(pcm, sampleRate, {
            title,
            onProgress: (stage, ratio) => onProgress({ stage, ratio }),
          });
          resolve(result);
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Analysis failed'));
        }
      };
      // The worker gets its own copy so the main thread can retry if it fails.
      worker.postMessage({ pcm: pcm.slice(), sampleRate, title });
    });
  } catch {
    return analyzeAudio(pcm, sampleRate, { title, onProgress: (stage, ratio) => onProgress({ stage, ratio }) });
  }
}
