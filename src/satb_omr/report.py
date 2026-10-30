"""Note-level reports (JSON / CSV / Markdown) with solfège."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from music21 import key, note, stream

from .satb import Flag
from .solfege import initial_sharps, key_for, syllable


def note_records(score: stream.Score, k: key.Key, minor: str, style: str) -> list[dict]:
    records = []
    base = initial_sharps(score)
    for part in score.parts:
        for m in part.getElementsByClass(stream.Measure):
            for n in m.notesAndRests:
                rec = {
                    "voice": part.partName,
                    "measure": m.number,
                    "offset": float(n.offset),
                    "beat": float(n.offset) + 1.0,
                    "duration": float(n.quarterLength),
                    "type": n.duration.type,
                    "dots": n.duration.dots,
                    "pitch": None,
                    "midi": None,
                    "solfege": None,
                    "tie": n.tie.type if getattr(n, "tie", None) else None,
                    "lyric": n.lyric,
                }
                if isinstance(n, note.Note):
                    rec.update(
                        pitch=n.nameWithOctave,
                        midi=n.pitch.midi,
                        solfege=syllable(n.pitch, key_for(n, k, base), minor, style),
                    )
                else:
                    rec["pitch"] = "rest"
                records.append(rec)
    return records


def write_json(path: Path, meta: dict, records: list[dict], flags: list[Flag]) -> None:
    payload = {"meta": meta, "flags": [f.to_dict() for f in flags], "notes": records}
    path.write_text(json.dumps(payload, indent=2))


def write_csv(path: Path, records: list[dict]) -> None:
    if not records:
        path.write_text("")
        return
    with path.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(records[0]))
        w.writeheader()
        w.writerows({k: _csv_safe(v) for k, v in r.items()} for r in records)


def _csv_safe(v):
    """Stop spreadsheets from evaluating lyric text such as ``=HYPERLINK(...)``."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


def markdown(meta: dict, records: list[dict], flags: list[Flag]) -> str:
    lines = [f"# SATB transcription: {meta.get('source', '')}", ""]
    lines += [f"- **Key:** {meta.get('key')}  (Do = {meta.get('do')})"]
    for i, layout in enumerate(meta.get("layouts", []), start=1):
        lines.append(f"- **Page {i} layout:** {layout}")
    lines += ["", "| Measure | Voice | Notes | Solfège |", "|---|---|---|---|"]
    by_measure: dict[tuple, list[dict]] = {}
    order: list[tuple] = []
    for r in records:
        k = (r["measure"], r["voice"])
        if k not in by_measure:
            by_measure[k] = []
            order.append(k)
        by_measure[k].append(r)
    voices = ["Soprano", "Alto", "Tenor", "Bass"]
    for k in sorted(
        order, key=lambda t: (t[0] if t[0] is not None else -1, voices.index(t[1]) if t[1] in voices else 9)
    ):
        recs = by_measure[k]
        notes_ = " ".join(r["pitch"] if r["pitch"] != "rest" else "-" for r in recs)
        sol = " ".join(r["solfege"] or "-" for r in recs)
        lines.append(f"| {k[0]} | {k[1]} | {notes_} | {sol} |")
    lines += ["", f"## Review flags ({len(flags)})", ""]
    if not flags:
        lines.append("None.")
    for f in flags:
        where = f"m.{f.measure}" if f.measure is not None else ""
        lines.append(f"- [{f.kind}] {f.voice} {where}: {f.message}")
    return "\n".join(lines) + "\n"
