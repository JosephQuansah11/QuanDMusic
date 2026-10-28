import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScoreView } from '../render/ScoreView';
import { PART_IDS, PART_NAMES, beatsPerMeasure, measureCount, type PartId, type Score } from '../core/score';
import { keyName } from '../core/keys';
import { midiToName } from '../core/pitch';
import { solfegeText } from '../core/solfege';
import { MicPitchTracker, playReferencePitch } from '../audio/mic';
import type { PitchResult } from '../dsp/pitchdetect';
import type { Transport, UiState } from '../state/ui';

export interface PracticePanelProps {
  score: Score;
  ui: UiState;
  onUiChange: (patch: Partial<UiState>) => void;
  transport: Transport;
  onDownloadWav: (part: PartId) => void;
  originalName: string | null;
}

export function PracticePanel({ score, ui, onUiChange, transport, onDownloadWav, originalName }: PracticePanelProps) {
  const bpm = beatsPerMeasure(score.timeSignature);
  const bars = measureCount(score);
  const [micOn, setMicOn] = useState(false);
  const [pitch, setPitch] = useState<PitchResult | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const trackerRef = useRef<MicPitchTracker | null>(null);

  const part = score.parts[ui.focusPart];
  const currentNote = useMemo(
    () => part.notes.find((note) => transport.beat >= note.start && transport.beat < note.start + note.duration) ?? null,
    [part.notes, transport.beat],
  );
  const nextNote = useMemo(() => part.notes.find((note) => note.start > transport.beat) ?? null, [part.notes, transport.beat]);

  const stopMic = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    setMicOn(false);
    setPitch(null);
  }, []);

  useEffect(() => () => trackerRef.current?.stop(), []);

  const toggleMic = useCallback(async () => {
    if (micOn) {
      stopMic();
      return;
    }
    setMicError(null);
    const tracker = new MicPitchTracker();
    trackerRef.current = tracker;
    await tracker.start({
      onPitch: (result) => setPitch(result),
      onError: (message) => {
        setMicError(message);
        stopMic();
      },
    });
    setMicOn(true);
  }, [micOn, stopMic]);

  const setFocus = (id: PartId) => {
    onUiChange({ focusPart: id, solo: id, muted: { ...ui.muted, [id]: false } });
  };

  const loopStart = ui.loopMeasures?.start ?? 1;
  const loopEnd = ui.loopMeasures?.end ?? Math.min(bars, loopStart + 3);
  const sungNote = pitch?.midi;
  const inTune = Boolean(
    sungNote !== null &&
      sungNote !== undefined &&
      currentNote &&
      sungNote === currentNote.midi &&
      Math.abs(pitch?.cents ?? 0) <= 35,
  );

  return (
    <div className="stack">
      <section className="panel">
        <h1 className="title">Practice room</h1>
        <p className="muted">
          Pick your part, loop the hard bars, slow the tempo down and sing or play against the other three voices.
        </p>
        <div className="row wrap gap">
          {PART_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={ui.focusPart === id ? 'part-button active' : 'part-button'}
              onClick={() => setFocus(id)}
            >
              <strong>{PART_NAMES[id]}</strong>
              <span>{score.parts[id].notes.length} notes</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel controls">
        <div className="control-group">
          <span className="label">Transport</span>
          <button type="button" className="primary" onClick={() => transport.play(transport.beat, ui.countIn ? bpm : 0)}>
            {ui.countIn ? 'Play with count-in' : 'Play'}
          </button>
          <button type="button" className="ghost" onClick={() => transport.pause()}>
            Pause
          </button>
          <button type="button" className="ghost" onClick={() => transport.stop()}>
            Back to start
          </button>
        </div>

        <div className="control-group">
          <span className="label">Tempo</span>
          <input
            type="range"
            min={0.4}
            max={1.4}
            step={0.05}
            value={ui.tempoScale}
            onChange={(event) => onUiChange({ tempoScale: Number(event.target.value) })}
          />
          <span className="value">{Math.round(score.tempo * ui.tempoScale)} BPM</span>
          <button type="button" className="ghost" onClick={() => onUiChange({ tempoScale: 1 })}>
            100%
          </button>
        </div>

        <div className="control-group">
          <span className="label">Loop bars</span>
          <label className="inline">
            <input
              type="number"
              min={1}
              max={bars}
              value={loopStart}
              onChange={(event) =>
                onUiChange({
                  loopMeasures: {
                    start: Number(event.target.value),
                    end: Math.max(Number(event.target.value), loopEnd),
                  },
                })
              }
            />
            to
            <input
              type="number"
              min={1}
              max={bars}
              value={loopEnd}
              onChange={(event) => onUiChange({ loopMeasures: { start: loopStart, end: Number(event.target.value) } })}
            />
          </label>
          <button
            type="button"
            className={ui.loopMeasures ? 'chip on' : 'chip'}
            onClick={() => onUiChange({ loopMeasures: ui.loopMeasures ? null : { start: 1, end: Math.min(bars, 2) } })}
          >
            {ui.loopMeasures ? 'loop on' : 'loop off'}
          </button>
        </div>

        <div className="control-group">
          <span className="label">Support</span>
          <label className="chip">
            <input
              type="checkbox"
              checked={ui.metronome}
              onChange={(event) => onUiChange({ metronome: event.target.checked })}
            />
            Metronome
          </label>
          <label className="chip">
            <input type="checkbox" checked={ui.countIn} onChange={(event) => onUiChange({ countIn: event.target.checked })} />
            Count-in
          </label>
          <label className="chip">
            <input type="checkbox" checked={ui.drone} onChange={(event) => onUiChange({ drone: event.target.checked })} />
            Tonic drone
          </label>
          <label className="chip">
            <input
              type="checkbox"
              checked={ui.muted[ui.focusPart]}
              onChange={(event) => onUiChange({ muted: { ...ui.muted, [ui.focusPart]: event.target.checked } })}
            />
            Mute my part
          </label>
        </div>

        <div className="control-group">
          <span className="label">Key</span>
          <span className="value">{keyName(score.key)}</span>
          <span className="muted small">
            {ui.transpose === 0
              ? 'If the part sits too high or low, change the key on the Score tab.'
              : `${ui.transpose > 0 ? '+' : ''}${ui.transpose} semitones from the original.`}
          </span>
        </div>
      </section>

      <section className="panel">
        <div className="row between wrap">
          <div>
            <h2>{PART_NAMES[ui.focusPart]} guide</h2>
            <p className="muted small">
              Now:{' '}
              {currentNote
                ? `${midiToName(currentNote.midi)} (${solfegeText(currentNote.midi, score.key, {
                    display: ui.solfegeDisplay,
                    system: ui.solfegeSystem,
                  })})`
                : 'rest'}
              {nextNote ? ` · next: ${midiToName(nextNote.midi)}` : ''}
            </p>
          </div>
          <div className="row gap wrap">
            <button
              type="button"
              className="ghost"
              onClick={() => currentNote && playReferencePitch(currentNote.midi)}
              disabled={!currentNote}
            >
              Hear this note
            </button>
            <button type="button" className="ghost" onClick={() => onDownloadWav(ui.focusPart)}>
              Download WAV
            </button>
            <button type="button" className={micOn ? 'chip on' : 'chip'} onClick={() => void toggleMic()}>
              {micOn ? 'Listening' : 'Check my pitch'}
            </button>
          </div>
        </div>

        <div className={inTune ? 'tuner in-tune' : 'tuner'}>
          <span className="tuner-note">{sungNote !== null && sungNote !== undefined ? midiToName(sungNote) : '—'}</span>
          <span className="tuner-detail">
            {pitch && pitch.frequency > 0
              ? `${pitch.frequency.toFixed(1)} Hz · ${pitch.cents > 0 ? '+' : ''}${pitch.cents} cents`
              : 'no voice detected'}
          </span>
          <span className="tuner-target">
            target {currentNote ? midiToName(currentNote.midi) : 'rest'} {inTune ? '· in tune' : ''}
          </span>
        </div>
        {micError && <p className="banner error small">{micError}</p>}
      </section>

      <section className="panel score-panel">
        <ScoreView
          score={score}
          cursorBeat={transport.beat}
          onSeek={(value) => transport.seek(value)}
          options={{
            parts: [ui.focusPart],
            clefs: ui.clefs,
            focusPart: ui.focusPart,
            solfege: { enabled: ui.showSolfege, system: ui.solfegeSystem, display: ui.solfegeDisplay },
            letters: ui.showLetters,
          }}
        />
      </section>

      <section className="panel">
        <h2>How to work on this part</h2>
        <ol className="tips">
          <li>Listen once with your part soloed, then mute it and sing against the other three voices.</li>
          <li>Loop two bars at 70% speed until the rhythm is automatic, then raise the tempo.</li>
          <li>Sing the solfege syllables before the words: they show the scale degrees you are hearing.</li>
          <li>Use the tonic drone to check intonation on long notes.</li>
          <li>
            {originalName
              ? `The original recording (${originalName}) is in the mix too - mute it once you are confident.`
              : 'Upload the original recording to practise against the real performance.'}
          </li>
        </ol>
      </section>
    </div>
  );
}
