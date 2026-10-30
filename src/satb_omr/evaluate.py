"""Compare a transcribed SATB score with a verified ground-truth score."""

from __future__ import annotations

from pathlib import Path

from music21 import converter, note, stream

from .satb import VOICES


def _events(part: stream.Part) -> dict[tuple[int, float], tuple[int, float]]:
    out = {}
    for idx, m in enumerate(part.getElementsByClass(stream.Measure)):
        for n in m.recurse().notes:
            if isinstance(n, note.Note):
                out[(idx, round(float(n.offset), 3))] = (n.pitch.midi, float(n.quarterLength))
    return out


def _by_voice(score: stream.Score) -> dict[str, stream.Part]:
    parts = list(score.parts)
    named = {p.partName: p for p in parts if p.partName in VOICES}
    if len(named) == len(parts):
        return named
    return dict(zip(VOICES, parts))


def compare(pred: stream.Score, truth: stream.Score) -> dict:
    pv, tv = _by_voice(pred), _by_voice(truth)
    result: dict = {}
    tot = {"truth": 0, "pred": 0, "onset": 0, "pitch": 0, "full": 0}
    for v in VOICES:
        t = _events(tv[v]) if v in tv else {}
        p = _events(pv[v]) if v in pv else {}
        onset = [k for k in t if k in p]
        pitch_ok = [k for k in onset if t[k][0] == p[k][0]]
        full_ok = [k for k in pitch_ok if abs(t[k][1] - p[k][1]) < 1e-3]
        stats = {"truth": len(t), "pred": len(p), "onset": len(onset), "pitch": len(pitch_ok), "full": len(full_ok)}
        for key_, val in stats.items():
            tot[key_] += val
        result[v] = _metrics(stats)
    result["overall"] = _metrics(tot)
    return result


def _metrics(s: dict) -> dict:
    def ratio(a, b):
        return round(a / b, 4) if b else 0.0

    return {
        **s,
        "pitch_recall": ratio(s["pitch"], s["truth"]),
        "pitch_precision": ratio(s["pitch"], s["pred"]),
        "note_recall": ratio(s["full"], s["truth"]),
        "note_precision": ratio(s["full"], s["pred"]),
    }


def compare_files(pred: Path, truth: Path) -> dict:
    return compare(converter.parse(str(pred)), converter.parse(str(truth)))
