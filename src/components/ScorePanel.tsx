import { useMemo } from 'react';
import { ScoreView } from '../render/ScoreView';
import { PART_IDS, PART_NAMES, PART_RANGES, partRange, totalBeats, type PartId, type Score } from '../core/score';
import { keyName, keySignatureAccidentals } from '../core/keys';
import { midiToName } from '../core/pitch';
import type { Transport, UiState } from '../state/ui';
import { ScoreControls } from './ScoreControls';

export interface ScorePanelProps {
  score: Score;
  ui: UiState;
  onUiChange: (patch: Partial<UiState>) => void;
  transport: Transport;
  onExportXml: (part?: PartId) => void;
  onDownloadWav: (part: PartId) => void;
  onSave: () => void;
  originalName: string | null;
}

export function ScorePanel({
  score,
  ui,
  onUiChange,
  transport,
  onExportXml,
  onDownloadWav,
  onSave,
  originalName,
}: ScorePanelProps) {
  const signature = useMemo(() => keySignatureAccidentals(score.key), [score.key]);
  const range = partRange(score.parts[ui.focusPart]);

  return (
    <div className="stack">
      <section className="panel">
        <div className="row between wrap">
          <div>
            <h1 className="title">{score.title}</h1>
            <p className="muted small">
              {score.composer ? `${score.composer} · ` : ''}
              {Math.round(score.tempo)} BPM · {score.timeSignature.beats}/{score.timeSignature.beatUnit} ·{' '}
              {keyName(score.key)} ({signature.length} {signature.length === 1 ? 'accidental' : 'accidentals'}) ·{' '}
              {Math.round(totalBeats(score))} beats · {score.source}
              {originalName ? ` · ${originalName}` : ''}
            </p>
          </div>
          <div className="row gap wrap">
            <button type="button" className="ghost" onClick={() => onExportXml()}>
              Export full score
            </button>
            <button type="button" className="ghost" onClick={() => onExportXml(ui.focusPart)}>
              Export {PART_NAMES[ui.focusPart]}
            </button>
            <button type="button" className="ghost" onClick={() => onDownloadWav(ui.focusPart)}>
              Download {PART_NAMES[ui.focusPart]} audio
            </button>
            <button type="button" className="primary" onClick={onSave}>
              Save offline
            </button>
          </div>
        </div>
      </section>

      <ScoreControls score={score} ui={ui} onUiChange={onUiChange} />

      <section className="panel score-panel">
        <ScoreView
          score={score}
          cursorBeat={transport.beat}
          onSeek={(value) => transport.seek(value)}
          options={{
            parts: ui.visibleParts,
            clefs: ui.clefs,
            focusPart: ui.focusPart,
            solfege: { enabled: ui.showSolfege, system: ui.solfegeSystem, display: ui.solfegeDisplay },
            letters: ui.showLetters,
          }}
        />
        <p className="muted small">
          Click the staff to start from that beat. {PART_NAMES[ui.focusPart]}: {score.parts[ui.focusPart].notes.length}{' '}
          notes{range ? `, ${midiToName(range.low)}–${midiToName(range.high)}` : ''} (comfortable range{' '}
          {midiToName(PART_RANGES[ui.focusPart].low)}–{midiToName(PART_RANGES[ui.focusPart].high)}).
        </p>
        {score.notes && <p className="muted small">{score.notes}</p>}
      </section>

      <section className="panel">
        <h2>Mix</h2>
        <div className="mixer">
          {PART_IDS.map((id) => (
            <div key={id} className="mixer-row">
              <span className="mixer-name">{PART_NAMES[id]}</span>
              <button
                type="button"
                className={ui.muted[id] ? 'chip' : 'chip on'}
                onClick={() => onUiChange({ muted: { ...ui.muted, [id]: !ui.muted[id] } })}
              >
                {ui.muted[id] ? 'muted' : 'audible'}
              </button>
              <button
                type="button"
                className={ui.solo === id ? 'chip on' : 'chip'}
                onClick={() => onUiChange({ solo: ui.solo === id ? null : id })}
              >
                solo
              </button>
            </div>
          ))}
          <div className="mixer-row">
            <span className="mixer-name">Original recording</span>
            <button
              type="button"
              className={ui.showOriginal ? 'chip on' : 'chip'}
              onClick={() => onUiChange({ showOriginal: !ui.showOriginal })}
              disabled={!originalName}
            >
              {originalName ? (ui.showOriginal ? 'in mix' : 'muted') : 'no audio loaded'}
            </button>
            <label className="inline">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={ui.originalVolume}
                onChange={(event) => onUiChange({ originalVolume: Number(event.target.value) })}
                disabled={!originalName}
              />
            </label>
          </div>
        </div>
        <p className="muted small">
          Every part is synthesized with its own vowel and the exact rhythm of the song, so you can sing against the other
          three.
        </p>
      </section>
    </div>
  );
}
