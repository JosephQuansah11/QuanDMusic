import type { Fingering } from '../core/fingerings';
import { isBlackKey, midiToName, pitchClass } from '../core/pitch';
import type { Instrument } from '../core/instruments';

export interface InstrumentDiagramProps {
  instrument: Instrument;
  fingering: Fingering | null;
}

/** A small SVG that shows where the note lives on the instrument. */
export function InstrumentDiagram({ instrument, fingering }: InstrumentDiagramProps) {
  if (!fingering) {
    return <p className="muted small">Choose a note to see its position.</p>;
  }

  if (instrument.system === 'valve') {
    const pressed = fingering.options[0]?.label ?? 'open';
    const valves = ['1', '2', '3'];
    const active = pressed === 'open' ? [] : pressed.split('·');
    return (
      <svg viewBox="0 0 220 110" className="diagram" role="img" aria-label={`valves ${pressed}`}>
        <text x="8" y="16" className="diagram-title">
          valves: {pressed === 'open' ? 'open' : pressed}
        </text>
        {valves.map((valve, index) => {
          const cx = 40 + index * 46;
          const on = active.includes(valve);
          return (
            <g key={valve}>
              <rect x={cx - 13} y={34} width={26} height={52} rx={12} className={on ? 'valve on' : 'valve'} />
              <circle cx={cx} cy={30} r={9} className={on ? 'valve-cap on' : 'valve-cap'} />
              <text x={cx} y={102} className="diagram-label" textAnchor="middle">
                {valve}
              </text>
            </g>
          );
        })}
        <text x="158" y="16" className="diagram-label">
          {fingering.options[0]?.detail ?? ''}
        </text>
      </svg>
    );
  }

  if (instrument.system === 'slide') {
    const position = Number(fingering.options[0]?.label ?? '1') || 1;
    return (
      <svg viewBox="0 0 260 110" className="diagram" role="img" aria-label={`slide position ${position}`}>
        <text x="8" y="16" className="diagram-title">
          slide position {position} of 7
        </text>
        <line x1="20" y1="58" x2="240" y2="58" className="slide-rail" />
        {[1, 2, 3, 4, 5, 6, 7].map((index) => {
          const x = 20 + ((index - 1) / 6) * 220;
          const on = index === position;
          return (
            <g key={index}>
              <rect x={x - 5} y={44} width={10} height={28} rx={3} className={on ? 'slide-marker on' : 'slide-marker'} />
              <text x={x} y={92} className="diagram-label" textAnchor="middle">
                {index}
              </text>
            </g>
          );
        })}
        <text x={20} y={28} className="diagram-label">
          1st = all the way in
        </text>
      </svg>
    );
  }

  if (instrument.system === 'fretboard' && instrument.tuning) {
    const strings = instrument.tuning;
    const fret = fingering.options[0]?.offset ?? -1;
    const stringIndex = fingering.options[0]?.label.includes('high E')
      ? 0
      : fingering.options[0]?.label.includes('B')
        ? 1
        : fingering.options[0]?.label.includes('G')
          ? 2
          : fingering.options[0]?.label.includes('D')
            ? 3
            : fingering.options[0]?.label.includes('low E')
              ? 5
              : 4;
    return (
      <svg viewBox="0 0 300 140" className="diagram" role="img" aria-label="guitar fretboard">
        <text x="6" y="14" className="diagram-title">
          {fingering.primary}
        </text>
        {strings.map((open, index) => {
          const y = 30 + index * 17;
          return (
            <g key={open}>
              <line x1="28" y1={y} x2="292" y2={y} className="fret-string" />
              <text x="8" y={y + 4} className="diagram-label">
                {midiToName(open).replace(/\d/, '')}
              </text>
            </g>
          );
        })}
        {Array.from({ length: 14 }, (_, fretIndex) => (
          <line
            key={fretIndex}
            x1={28 + fretIndex * 19}
            y1={28}
            x2={28 + fretIndex * 19}
            y2={30 + (strings.length - 1) * 17 + 6}
            className="fret-wire"
          />
        ))}
        {fret >= 0 && (
          <circle
            cx={28 + fret * 19 + (fret === 0 ? 4 : -9)}
            cy={30 + stringIndex * 17}
            r={5}
            className="fret-dot"
          />
        )}
      </svg>
    );
  }

  if (instrument.system === 'keyboard') {
    const centre = fingering.writtenMidi;
    const from = centre - 7;
    const keys = Array.from({ length: 15 }, (_, index) => from + index);
    return (
      <svg viewBox="0 0 320 90" className="diagram" role="img" aria-label="piano keys">
        <text x="6" y="14" className="diagram-title">
          {fingering.primary} ({fingering.options[0]?.detail})
        </text>
        {keys.map((midi, index) => {
          const black = isBlackKey(midi);
          const x = 10 + index * 20;
          return (
            <rect
              key={midi}
              x={x}
              y={black ? 24 : 30}
              width={black ? 12 : 18}
              height={black ? 34 : 50}
              rx={2}
              className={
                midi === centre ? 'key on' : black ? 'key black' : 'key white'
              }
            />
          );
        })}
        <text x="10" y="90" className="diagram-label">
          {pitchClass(centre) >= 0 ? fingering.primary : ''}
        </text>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 260 80" className="diagram" role="img" aria-label="note position">
      <text x="8" y="20" className="diagram-title">
        {midiToName(fingering.writtenMidi)}
      </text>
      <text x="8" y="46" className="diagram-label">
        {fingering.explanation}
      </text>
    </svg>
  );
}
