/** UI state shared by the panels. */

import type { PartId, TimeSignature } from '../core/score';
import type { Key } from '../core/keys';
import type { ClefName } from '../core/instruments';
import type { SolfegeDisplay, SolfegeSystem } from '../core/solfege';

export type TabId = 'import' | 'score' | 'practice' | 'instrument' | 'offline';

export interface UiState
{
  visibleParts: PartId[];
  clefs: Partial<Record<PartId, ClefName>>;
  showSolfege: boolean;
  solfegeSystem: SolfegeSystem;
  solfegeDisplay: SolfegeDisplay;
  showLetters: boolean;
  /** Semitones the whole score is shifted by, for a comfortable key. */
  transpose: number;
  focusPart: PartId;
  instrumentId: string;
  metronome: boolean;
  drone: boolean;
  countIn: boolean;
  tempoScale: number;
  /** Practice loop, in bars (1-based, inclusive). */
  loopMeasures: { start: number; end: number } | null;
  muted: Record<PartId, boolean>;
  solo: PartId | null;
  showOriginal: boolean;
  originalVolume: number;
  practiceKey: Key | null;
}

export const DEFAULT_UI: UiState = {
  visibleParts: ['S', 'A', 'T', 'B'],
  clefs: {},
  showSolfege: true,
  solfegeSystem: 'movable',
  solfegeDisplay: 'short',
  showLetters: false,
  transpose: 0,
  focusPart: 'S',
  instrumentId: 'trumpet',
  metronome: false,
  drone: false,
  countIn: true,
  tempoScale: 1,
  loopMeasures: null,
  muted: { S: false, A: false, T: false, B: false },
  solo: null,
  showOriginal: true,
  originalVolume: 0.7,
  practiceKey: null,
};

export interface Transport {
  isPlaying: boolean;
  beat: number;
  play: (fromBeat?: number, countInBeats?: number) => void;
  pause: () => void;
  stop: () => void;
  seek: (beat: number) => void;
}

export function timeSignatureLabel(ts: TimeSignature): string {
  return `${ts.beats}/${ts.beatUnit}`;
}
