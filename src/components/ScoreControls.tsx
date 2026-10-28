import { PART_IDS, PART_NAMES, type Score } from '../core/score';
import { accidentalCount, keyName } from '../core/keys';
import type { ClefName } from '../core/instruments';
import type { UiState } from '../state/ui';

export interface ScoreControlsProps {
  score: Score;
  ui: UiState;
  onUiChange: (patch: Partial<UiState>) => void;
}

const CLEF_OPTIONS: ClefName[] = ['treble', 'alto', 'tenor', 'bass'];

/** Part visibility, reading system, clef and key controls. */
export function ScoreControls({ score, ui, onUiChange }: ScoreControlsProps) {
  return (
    <section className="panel controls">
      <div className="control-group">
        <span className="label">Parts</span>
        {PART_IDS.map((id) => (
          <label key={id} className={ui.visibleParts.includes(id) ? 'chip on' : 'chip'}>
            <input
              type="checkbox"
              checked={ui.visibleParts.includes(id)}
              onChange={(event) =>
                onUiChange({
                  visibleParts: event.target.checked
                    ? PART_IDS.filter((part) => part === id || ui.visibleParts.includes(part))
                    : ui.visibleParts.filter((part) => part !== id),
                })
              }
            />
            {PART_NAMES[id]}
          </label>
        ))}
      </div>

      <div className="control-group">
        <span className="label">Reading</span>
        <label className="chip">
          <input
            type="checkbox"
            checked={ui.showSolfege}
            onChange={(event) => onUiChange({ showSolfege: event.target.checked })}
          />
          Solfège
        </label>
        <select
          value={ui.solfegeSystem}
          onChange={(event) => onUiChange({ solfegeSystem: event.target.value as UiState['solfegeSystem'] })}
        >
          <option value="movable">Movable do</option>
          <option value="fixed">Fixed do</option>
        </select>
        <select
          value={ui.solfegeDisplay}
          onChange={(event) => onUiChange({ solfegeDisplay: event.target.value as UiState['solfegeDisplay'] })}
        >
          <option value="short">d r m f s l t</option>
          <option value="full">do re mi fa sol la ti</option>
        </select>
        <label className="chip">
          <input
            type="checkbox"
            checked={ui.showLetters}
            onChange={(event) => onUiChange({ showLetters: event.target.checked })}
          />
          Letter names
        </label>
      </div>

      <div className="control-group">
        <span className="label">Clef for {PART_NAMES[ui.focusPart]}</span>
        <select
          value={ui.clefs[ui.focusPart] ?? 'treble'}
          onChange={(event) => onUiChange({ clefs: { ...ui.clefs, [ui.focusPart]: event.target.value as ClefName } })}
        >
          {CLEF_OPTIONS.map((clef) => (
            <option key={clef} value={clef}>
              {clef}
            </option>
          ))}
        </select>
      </div>

      <div className="control-group">
        <span className="label">Key</span>
        <button type="button" className="ghost" onClick={() => onUiChange({ transpose: ui.transpose - 1 })}>
          −1
        </button>
        <span className="value">{keyName(score.key)}</span>
        <button type="button" className="ghost" onClick={() => onUiChange({ transpose: ui.transpose + 1 })}>
          +1
        </button>
        <button type="button" className="ghost" onClick={() => onUiChange({ transpose: ui.transpose + 2 })}>
          +2
        </button>
        <button type="button" className="ghost" onClick={() => onUiChange({ transpose: 0 })} disabled={ui.transpose === 0}>
          reset
        </button>
        <span className="muted small">
          {ui.transpose === 0
            ? 'original key'
            : `${ui.transpose > 0 ? '+' : ''}${ui.transpose} semitones · ${accidentalCount(score.key)} accidentals`}
        </span>
      </div>

      <div className="control-group">
        <span className="label">Focus</span>
        {PART_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={ui.focusPart === id ? 'chip on' : 'chip'}
            onClick={() => onUiChange({ focusPart: id })}
          >
            {PART_NAMES[id]} ({score.parts[id].notes.length})
          </button>
        ))}
      </div>
    </section>
  );
}
