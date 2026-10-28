import { useMemo, useState } from 'react';
import {
  INSTRUMENTS,
  instrumentFamilies,
  getInstrument,
} from '../core/instruments';
import {
  arpeggioPractice,
  describeKeyOnInstrument,
  fingeringFor,
  flatsDrill,
  scalePractice,
  songPractice,
  writtenKeyFor,
  type PracticeNote,
} from '../core/fingerings';
import { ALL_KEYS, keyName, keysEqual, type Key } from '../core/keys';
import { midiToName } from '../core/pitch';
import { PART_NAMES, beatsPerMeasure, type Score } from '../core/score';
import { playReferencePitch } from '../audio/mic';
import type { Transport, UiState } from '../state/ui';
import { InstrumentDiagram } from './InstrumentDiagram';

export interface InstrumentPanelProps {
  score: Score;
  ui: UiState;
  onUiChange: (patch: Partial<UiState>) => void;
  transport: Transport;
}

function keyLabel(key: Key): string {
  return keyName(key);
}

export function InstrumentPanel({ score, ui, onUiChange }: InstrumentPanelProps) {
  const instrument = getInstrument(ui.instrumentId);
  const key = ui.practiceKey ?? score.key;
  const [selected, setSelected] = useState<PracticeNote | null>(null);

  const scale = useMemo(() => scalePractice(instrument, key), [instrument, key]);
  const arpeggio = useMemo(() => arpeggioPractice(instrument, key), [instrument, key]);
  const flats = useMemo(() => flatsDrill(instrument, key), [instrument, key]);
  const keyInfo = useMemo(() => describeKeyOnInstrument(instrument, key), [instrument, key]);
  const writtenKey = writtenKeyFor(instrument, key);
  const songNotes = useMemo(
    () => songPractice(instrument, key, score.parts[ui.focusPart].notes).slice(0, 40),
    [instrument, key, score.parts, ui.focusPart],
  );

  const active = selected ?? scale[0];
  const fingering = active ? fingeringFor(instrument, active.concertMidi) : null;

  const playSequence = (notes: PracticeNote[]) => {
    notes.forEach((note, index) => {
      window.setTimeout(() => playReferencePitch(note.concertMidi, 0.5), index * 550);
    });
  };

  return (
    <div className="stack">
      <section className="panel">
        <h1 className="title">Play it on your instrument</h1>
        <p className="muted">
          Learn the scale first, then the flats in that scale, then the song itself. Fingerings below are worked out from
          the instrument itself, not copied from a chart.
        </p>
        <div className="row wrap gap">
          <label className="field">
            Instrument
            <select value={ui.instrumentId} onChange={(event) => onUiChange({ instrumentId: event.target.value })}>
              {instrumentFamilies().map((family) => (
                <optgroup key={family.id} label={family.label}>
                  {INSTRUMENTS.filter((item) => item.family === family.id).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="field">
            Key
            <select
              value={`${key.tonic}-${key.mode}`}
              onChange={(event) => {
                const [tonic, mode] = event.target.value.split('-');
                onUiChange({ practiceKey: { tonic: Number(tonic), mode: mode as Key['mode'] } });
              }}
            >
              {ALL_KEYS.map((option) => (
                <option key={`${option.tonic}-${option.mode}`} value={`${option.tonic}-${option.mode}`}>
                  {keyLabel(option)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ghost"
            onClick={() => onUiChange({ practiceKey: null })}
            disabled={!ui.practiceKey || keysEqual(key, score.key)}
          >
            Use the song key ({keyName(score.key)})
          </button>
          <button type="button" className="ghost" onClick={() => playSequence(scale)}>
            Hear the scale
          </button>
        </div>

        <div className="instrument-summary">
          <p>
            <strong>{instrument.name}</strong> · {instrument.transposition}
          </p>
          <p className="muted small">{instrument.description}</p>
          <p className="muted small">
            Written range {midiToName(instrument.range.low)}–{midiToName(instrument.range.high)} · written key for this
            song: {keyInfo.writtenKeyName} · concert key: {keyInfo.concertKeyName}
          </p>
        </div>
      </section>

      <section className="panel">
        <h2>
          {keyLabel(writtenKey)} scale on the {instrument.name}
        </h2>
        <p className="muted small">
          Written pitches first (that is what you read), with the sounding note in brackets and the fingering you need.
        </p>
        <div className="scale-table">
          {scale.map((note) => (
            <button
              key={`${note.writtenMidi}-${note.solfege}`}
              type="button"
              className={active && active.writtenMidi === note.writtenMidi ? 'scale-cell active' : 'scale-cell'}
              onClick={() => {
                setSelected(note);
                playReferencePitch(note.concertMidi, 0.7);
              }}
            >
              <span className="degree">{note.degree ?? '·'}</span>
              <span className="written">{note.writtenName}</span>
              <span className="solfege">{note.solfege}</span>
              <span className={note.playable ? 'fingering' : 'fingering bad'}>{note.fingering}</span>
            </button>
          ))}
        </div>
        <div className="row between wrap gap">
          <div className="diagram-wrap">
            <InstrumentDiagram instrument={instrument} fingering={fingering} />
          </div>
          <div className="stack small-gap">
            <p className="muted small">{fingering?.explanation}</p>
            {fingering && fingering.options.length > 1 && (
              <p className="muted small">
                Alternatives: {fingering.options.slice(1, 4).map((option) => option.detail).join(' · ')}
              </p>
            )}
            <p className="muted small">
              Arpeggio:{' '}
              {arpeggio.map((note) => `${note.writtenName} (${note.fingering})`).join(' → ')}
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Playing flats in this key</h2>
        <ul className="lines">
          {keyInfo.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="muted small">
          Drill these five flat notes slowly, then play them inside the scale. On brass, the same pitch often has two
          fingerings - use the first one now and the alternative when the line moves faster.
        </p>
        <div className="scale-table">
          {flats.map((note) => (
            <button
              key={`flat-${note.writtenMidi}`}
              type="button"
              className={active && active.writtenMidi === note.writtenMidi ? 'scale-cell active' : 'scale-cell'}
              onClick={() => {
                setSelected(note);
                playReferencePitch(note.concertMidi, 0.7);
              }}
            >
              <span className="degree">♭</span>
              <span className="written">{note.writtenName}</span>
              <span className="solfege">{note.solfege}</span>
              <span className={note.playable ? 'fingering' : 'fingering bad'}>{note.fingering}</span>
            </button>
          ))}
        </div>
        {keyInfo.flats.length > 0 && (
          <p className="muted small">
            Actually printed in this key: {keyInfo.flats.map((note) => note.writtenName).join(', ')}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Your part on the instrument</h2>
        <p className="muted small">
          {PART_NAMES[ui.focusPart]} from {score.title}, written for the {instrument.name}. The score is in{' '}
          {keyLabel(key)} with {Math.round(score.tempo)} BPM and {score.timeSignature.beats}/
          {score.timeSignature.beatUnit} time.
        </p>
        {songNotes.length === 0 ? (
          <p className="muted">This part is empty in the current score.</p>
        ) : (
          <div className="song-grid">
            {songNotes.map((note, index) => (
              <div key={`${note.writtenMidi}-${index}`} className={note.playable ? 'song-cell' : 'song-cell bad'}>
                <span className="bar">{Math.floor(note.start / beatsPerMeasure(score.timeSignature)) + 1}</span>
                <span className="written">{note.writtenName}</span>
                <span className="solfege">{note.shortSolfege}</span>
                <span className="fingering">{note.fingering}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Practice plan</h2>
        <ol className="tips">
          <li>Play the scale slowly with the fingering shown, saying the solfege out loud.</li>
          <li>Play the arpeggio (1-3-5-8) to anchor the key in your ear.</li>
          <li>Work the five flat notes in this register until they are as easy as the naturals.</li>
          <li>Only then start on the song, one bar at a time, with the practice loop on the Practice tab.</li>
          <li>Finish by playing the part with the guide track at the original tempo.</li>
        </ol>
      </section>
    </div>
  );
}
