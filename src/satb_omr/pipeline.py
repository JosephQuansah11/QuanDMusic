"""End-to-end conversion: PDF / image / MusicXML -> SATB MusicXML + MIDI + reports."""

from __future__ import annotations

import copy
import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path

from music21 import clef, converter, key, meter, stream

from . import report
from .engines import EngineError, engine_chain
from .ingest import input_kind, load_pages
from .preprocess import preprocess_image
from .satb import VOICES, Flag, SatbResult, to_satb
from .solfege import annotate_lyrics, detect_key, do_pitch
from .validate import validate

log = logging.getLogger(__name__)


@dataclass
class ConvertOptions:
    engine: str = "auto"
    layout: str = "auto"
    mapping: str | None = None
    preprocess: bool = True
    dpi: int = 300
    key: str | None = None
    minor: str = "la"
    syllables: str = "solfege"
    solfege_lyrics: bool = False
    midi: bool = True
    voice_files: bool = True
    preview: bool = False


@dataclass
class PageResult:
    page: int
    engine: str
    satb: SatbResult
    raw: Path


@dataclass
class ConvertResult:
    score: stream.Score
    key: key.Key
    pages: list[PageResult]
    flags: list[Flag]
    outputs: dict[str, Path] = field(default_factory=dict)


def recognise_page(image: Path, workdir: Path, engine: str) -> tuple[str, list[Path]]:
    errors = []
    for eng in engine_chain(engine):
        try:
            return eng.name, eng.recognize(image, workdir / eng.name)
        except EngineError as exc:
            log.warning("%s failed on %s: %s", eng.name, image.name, exc)
            errors.append(f"{eng.name}: {exc}")
    raise EngineError("All OMR engines failed:\n" + "\n".join(errors))


def concat_scores(scores: list[stream.Score]) -> stream.Score:
    """Join per-page SATB scores into one, renumbering measures continuously."""
    if len(scores) == 1:
        return scores[0]
    out = stream.Score()
    out.metadata = copy.deepcopy(scores[0].metadata)
    for v in VOICES:
        pages = [p for s in scores for p in s.parts if p.partName == v]
        if not pages:
            continue
        joined = stream.Part(id=v)
        joined.partName = v
        joined.partAbbreviation = pages[0].partAbbreviation
        for inst in pages[0].getElementsByClass("Instrument"):
            joined.insert(0, copy.deepcopy(inst))
        last_number = None
        cur_key = cur_ts = None
        for page_i, page in enumerate(pages):
            measures = list(page.getElementsByClass(stream.Measure))
            shift = 0
            if last_number is not None and measures and measures[0].number <= last_number:
                shift = last_number - measures[0].number + 1
            for j, m in enumerate(measures):
                m = copy.deepcopy(m)
                m.number += shift
                if page_i > 0 and j == 0:
                    for c in list(m.getElementsByClass(clef.Clef)):
                        m.remove(c)
                for ks in list(m.getElementsByClass(key.KeySignature)):
                    if cur_key is not None and ks.sharps == cur_key.sharps:
                        m.remove(ks)
                    else:
                        cur_key = ks
                for ts in list(m.getElementsByClass(meter.TimeSignature)):
                    if cur_ts is not None and ts.ratioString == cur_ts.ratioString:
                        m.remove(ts)
                    else:
                        cur_ts = ts
                joined.append(m)
                last_number = m.number
        out.insert(0, joined)
    return out


def convert(source: Path, out_dir: Path, opts: ConvertOptions | None = None) -> ConvertResult:
    opts = opts or ConvertOptions()
    source = Path(source)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    work = out_dir / "work"
    stem = source.stem
    pages: list[PageResult] = []

    if input_kind(source) == "musicxml":
        satb = to_satb(converter.parse(str(source)), opts.layout, opts.mapping)
        pages.append(PageResult(1, "musicxml-input", satb, source))
    else:
        images = load_pages(source, work / "pages", opts.dpi)
        raw_dir = out_dir / "raw"
        raw_dir.mkdir(exist_ok=True)
        for i, img in enumerate(images, start=1):
            target = img
            if opts.preprocess:
                target = work / "clean" / f"{stem}-p{i:03d}.png"
                info = preprocess_image(img, target)
                log.info("page %d preprocess: %s", i, info)
            engine_name, xmls = recognise_page(target, work / "omr", opts.engine)
            for j, xml in enumerate(xmls, start=1):
                raw_copy = raw_dir / f"page-{i:03d}{'' if len(xmls) == 1 else f'-mvt{j}'}{xml.suffix}"
                shutil.copy(xml, raw_copy)
                satb = to_satb(converter.parse(str(xml)), opts.layout, opts.mapping)
                pages.append(PageResult(i, engine_name, satb, raw_copy))

    score = concat_scores([p.satb.score for p in pages])
    k = detect_key(score, opts.key)
    flags = [f for p in pages for f in p.satb.flags] + validate(score)
    result = ConvertResult(score, k, pages, flags)

    meta = {
        "source": source.name,
        "key": f"{k.tonic.name} {k.mode}",
        "do": do_pitch(k, opts.minor).name,
        "minor_convention": opts.minor,
        "syllables": opts.syllables,
        "layouts": [p.satb.plan.describe() for p in pages],
        "engines": sorted({p.engine for p in pages}),
        "staves": [[s.__dict__ for s in p.satb.staves] for p in pages],
    }
    records = report.note_records(score, k, opts.minor, opts.syllables)

    export = copy.deepcopy(score) if opts.solfege_lyrics else score
    if opts.solfege_lyrics:
        annotate_lyrics(export, k, opts.minor, opts.syllables)
    o = result.outputs
    o["musicxml"] = Path(export.write("musicxml", fp=out_dir / f"{stem}.satb.musicxml"))
    if opts.midi:
        o["midi"] = Path(score.write("midi", fp=out_dir / f"{stem}.satb.mid"))
    if opts.voice_files:
        vdir = out_dir / "voices"
        vdir.mkdir(exist_ok=True)
        for part in score.parts:
            single = stream.Score([copy.deepcopy(part)])
            name = part.partName.lower()
            o[f"{name}_musicxml"] = Path(single.write("musicxml", fp=vdir / f"{stem}.{name}.musicxml"))
            if opts.midi:
                o[f"{name}_midi"] = Path(single.write("midi", fp=vdir / f"{stem}.{name}.mid"))
    o["report_json"] = out_dir / f"{stem}.report.json"
    report.write_json(o["report_json"], meta, records, flags)
    o["report_csv"] = out_dir / f"{stem}.notes.csv"
    report.write_csv(o["report_csv"], records)
    o["report_md"] = out_dir / f"{stem}.report.md"
    o["report_md"].write_text(report.markdown(meta, records, flags))
    if opts.preview:
        from .render import render_musicxml

        try:
            o["preview"] = render_musicxml(o["musicxml"], out_dir / f"{stem}.satb.png")
        except Exception as exc:  # noqa: BLE001 - preview is best-effort
            log.warning("preview rendering failed: %s", exc)
    return result
