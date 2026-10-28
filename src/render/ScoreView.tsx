import { useEffect, useMemo, useRef } from 'react';
import { Renderer, Stave } from 'vexflow';
import { beatsPerMeasure, measureCount, PART_NAMES, type PartId, type Score } from '../core/score';
import { vexKeySpec } from '../core/keys';
import type { ClefName } from '../core/instruments';
import { chunkMeasures, pointToBeat, systemsForMeasureCount } from './layout';
import { CLEF_FOR_VEX, drawMeasure, drawTies, type LabelOptions } from './vexHelpers';

export interface ScoreViewOptions extends LabelOptions {
  parts: PartId[];
  clefs: Partial<Record<PartId, ClefName>>;
  focusPart: PartId | null;
}

export interface ScoreViewProps {
  score: Score;
  options: ScoreViewOptions;
  cursorBeat: number | null;
  onSeek?: (beat: number) => void;
}

const DEFAULT_CLEFS: Record<PartId, ClefName> = { S: 'treble', A: 'treble', T: 'treble', B: 'bass' };

interface LayoutInfo {
  systems: number[][];
  measureWidth: number;
  leftMargin: number;
  rowTop: (systemIndex: number) => number;
  rowHeight: number;
  bpm: number;
  measuresPerSystem: number;
}

/** A clickable, cursor-aware engraved score. */
export function ScoreView({ score, options, cursorBeat, onSeek }: ScoreViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<LayoutInfo | null>(null);
  const cursorRef = useRef<SVGRectElement | null>(null);
  const bpm = beatsPerMeasure(score.timeSignature);
  const measures = useMemo(() => measureCount(score), [score]);

  // Engraving is expensive: it must only run when the *content* changes, never
  // on every animation frame while the cursor moves.
  const optionsKey = useMemo(
    () =>
      JSON.stringify({
        parts: options.parts,
        clefs: options.clefs,
        focusPart: options.focusPart,
        solfege: options.solfege,
        letters: options.letters,
      }),
    [options.parts, options.clefs, options.focusPart, options.solfege, options.letters],
  );
  const onSeekRef = useRef(onSeek);
  useEffect(() => {
    onSeekRef.current = onSeek;
  }, [onSeek]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.innerHTML = '';
    cursorRef.current = null;

    const width = Math.max(640, container.clientWidth || 940);
    const leftMargin = 82;
    const rightMargin = 14;
    const topMargin = 20;
    const staffHeight = 96;
    const systemGap = 30;
    const visibleParts: PartId[] = options.parts.length ? options.parts : ['S'];
    const measuresPerSystem = Math.max(1, Math.min(4, Math.floor((width - leftMargin - rightMargin) / 205)));
    const measureWidth = (width - leftMargin - rightMargin) / measuresPerSystem;
    const systems = systemsForMeasureCount(measures, measuresPerSystem);
    const rowHeight = visibleParts.length * staffHeight + systemGap;
    const totalHeight = topMargin + systems.length * rowHeight + 12;
    const rowTop = (systemIndex: number) => topMargin + systemIndex * rowHeight;

    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(width, totalHeight);
    const context = renderer.getContext();
    context.setFont('Arial', 10);
    const svg = container.querySelector('svg');

    const chunksByPart = new Map<PartId, ReturnType<typeof chunkMeasures>>();
    visibleParts.forEach((partId) => {
      chunksByPart.set(partId, chunkMeasures(score.parts[partId], score.timeSignature, measures));
    });

    systems.forEach((line, systemIndex) => {
      line.forEach((measureIndex, column) => {
        visibleParts.forEach((partId, partIndex) => {
          const clef = options.clefs[partId] ?? DEFAULT_CLEFS[partId];
          const x = leftMargin + column * measureWidth;
          const y = rowTop(systemIndex) + partIndex * staffHeight;
          const stave = new Stave(x, y, measureWidth);
          if (column === 0) {
            stave.addClef(CLEF_FOR_VEX[clef]);
            stave.addKeySignature(vexKeySpec(score.key));
          }
          if (measureIndex === 0 && systemIndex === 0) {
            stave.addTimeSignature(`${score.timeSignature.beats}/${score.timeSignature.beatUnit}`);
          }
          stave.setContext(context).draw();

          const chunk = chunksByPart.get(partId)?.[measureIndex];
          if (!chunk) return;
          const drawn = drawMeasure(context, stave, chunk, score.key, options, score.timeSignature, clef);
          if (drawn.length > 1) drawTies(context, drawn);
        });

        if (column === 0) {
          context.setFont('Arial', 9, 'normal');
          context.fillText(`${measureIndex + 1}`, leftMargin + 3, rowTop(systemIndex) + 12);
        }
      });

      visibleParts.forEach((partId, partIndex) => {
        const y = rowTop(systemIndex) + partIndex * staffHeight + 44;
        context.setFont('Arial', 11, 'bold');
        context.fillText(PART_NAMES[partId], 6, y);
        if (options.focusPart === partId) {
          context.setFont('Arial', 8, 'normal');
          context.setFillStyle('#7c5cff');
          context.fillText('practising', 6, y + 12);
          context.setFillStyle('#000000');
        }
      });
    });

    layoutRef.current = { systems, measureWidth, leftMargin, rowTop, rowHeight, bpm, measuresPerSystem };

    if (svg) {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('width', '2');
      rect.setAttribute('height', '0');
      rect.setAttribute('fill', '#7c5cff');
      rect.setAttribute('opacity', '0.9');
      rect.setAttribute('pointer-events', 'none');
      svg.appendChild(rect);
      cursorRef.current = rect;

      svg.addEventListener('click', (event) => {
        const seek = onSeekRef.current;
        if (!seek) return;
        const layout = layoutRef.current;
        if (!layout) return;
        const bounds = svg.getBoundingClientRect();
        const x = ((event as MouseEvent).clientX - bounds.left) * (width / bounds.width);
        const y = ((event as MouseEvent).clientY - bounds.top) * (totalHeight / bounds.height);
        const beat = pointToBeat(
          x,
          y,
          layout.systems,
          layout.measureWidth,
          layout.leftMargin,
          layout.rowTop,
          layout.rowHeight,
          layout.bpm,
        );
        if (beat !== null) seek(beat);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, optionsKey, measures, bpm]);

  useEffect(() => {
    const layout = layoutRef.current;
    const rect = cursorRef.current;
    if (!layout || !rect) return;
    if (cursorBeat === null) {
      rect.setAttribute('height', '0');
      return;
    }
    const clamped = Math.max(0, Math.min(cursorBeat, measures * layout.bpm - 1e-3));
    const measureIndex = Math.floor(clamped / layout.bpm);
    const systemIndex = Math.min(layout.systems.length - 1, Math.floor(measureIndex / layout.measuresPerSystem));
    const column = measureIndex - layout.systems[systemIndex][0];
    const x =
      layout.leftMargin + column * layout.measureWidth + ((clamped % layout.bpm) / layout.bpm) * layout.measureWidth;
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(layout.rowTop(systemIndex)));
    rect.setAttribute('width', '2');
    rect.setAttribute('height', String(layout.rowHeight - 30));
  }, [cursorBeat, measures]);

  return <div className="score-canvas" ref={containerRef} />;
}
