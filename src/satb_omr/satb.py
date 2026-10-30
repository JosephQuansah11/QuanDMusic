"""SATB layout detection and voice separation.

Takes a recognised score (any number of staves, possibly with two voices or
chords per staff) and returns a normalised four-part Soprano/Alto/Tenor/Bass
score. Combined ("closed") staves are split into an upper and lower voice:

* two or more notated voices: the highest-sounding voice becomes the upper
  part, the lowest the lower part;
* a single voice with chords: top note -> upper part, bottom note -> lower part;
* a single note shared by both voices (unison / one stem): copied to both;
* gaps in one voice (hidden rests, voice temporarily missing) are filled with
  the other voice's notes, since that is how shared passages are engraved.
"""

from __future__ import annotations

import copy
from dataclasses import asdict, dataclass, field
from statistics import mean

from music21 import (
    chord,
    clef,
    dynamics,
    expressions,
    instrument,
    key,
    meter,
    note,
    stream,
    tempo,
)

VOICES = ("Soprano", "Alto", "Tenor", "Bass")
ABBREV = {"S": "Soprano", "A": "Alto", "T": "Tenor", "B": "Bass"}
# Only used when the source staff has no clef; otherwise each voice keeps its staff's clefs
# so every note stays on the same line/space as in the original.
VOICE_CLEFS = {
    "Soprano": clef.TrebleClef,
    "Alto": clef.TrebleClef,
    "Tenor": clef.Treble8vbClef,
    "Bass": clef.BassClef,
}
POLYPHONY_THRESHOLD = 0.3
SHARED_MEASURE_ELEMENTS = (
    key.KeySignature,
    meter.TimeSignature,
    tempo.TempoIndication,
    dynamics.Dynamic,
    dynamics.DynamicWedge,
    expressions.TextExpression,
)


@dataclass
class Flag:
    voice: str
    measure: int | None
    offset: float | None
    kind: str
    message: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class StaffInfo:
    index: int
    name: str
    clef: str
    measures: int
    polyphonic_ratio: float
    mean_midi: float | None

    @property
    def is_polyphonic(self) -> bool:
        return self.polyphonic_ratio >= POLYPHONY_THRESHOLD

    @property
    def register(self) -> str:
        """``upper`` (Soprano/Alto staff) or ``lower`` (Tenor/Bass staff), from clef, else pitch."""
        if self.clef in ("bass", "treble8vb", "tenor", "baritone", "subbass"):
            return "lower"
        if self.clef in ("treble", "soprano", "mezzosoprano", "alto"):
            return "upper"
        return "lower" if self.mean_midi is not None and self.mean_midi < 60 else "upper"


@dataclass
class LayoutPlan:
    kind: str
    assignment: list[tuple[int, list[str]]]
    ignored_staves: list[int] = field(default_factory=list)

    def describe(self) -> str:
        parts = [f"staff {i + 1} -> {'+'.join(v[0] for v in voices)}" for i, voices in self.assignment]
        if self.ignored_staves:
            parts.append("ignored: " + ", ".join(f"staff {i + 1}" for i in self.ignored_staves))
        return f"{self.kind}: " + "; ".join(parts)


@dataclass
class SatbResult:
    score: stream.Score
    plan: LayoutPlan
    staves: list[StaffInfo]
    flags: list[Flag]


# --------------------------------------------------------------------------- analysis


def _event_voices(measure: stream.Measure) -> list[stream.Stream]:
    voices = [v for v in measure.voices if v.notes]
    loose = [n for n in measure.notesAndRests if n.activeSite is measure]
    if loose and any(isinstance(n, note.NotRest) for n in loose):
        voices.append(measure)
    return voices or [measure]


def analyse_staff(index: int, part: stream.Part) -> StaffInfo:
    measures = list(part.getElementsByClass(stream.Measure))
    poly = 0
    for m in measures:
        voices = _event_voices(m)
        has_chord = any(isinstance(n, chord.Chord) and len(n.pitches) > 1 for n in m.recurse().notes)
        if len(voices) > 1 or has_chord:
            poly += 1
    pitches = [p.midi for n in part.recurse().notes for p in n.pitches]
    clefs = list(part.recurse().getElementsByClass(clef.Clef))
    return StaffInfo(
        index=index,
        name=part.partName or "",
        clef=clefs[0].name if clefs else "",
        measures=len(measures),
        polyphonic_ratio=poly / len(measures) if measures else 0.0,
        mean_midi=mean(pitches) if pitches else None,
    )


def parse_mapping(mapping: str) -> list[list[str]]:
    """Parse a staff mapping such as ``"SA,TB"`` or ``"S,A,T,B,-,-"`` (``-`` = ignore)."""
    staves = []
    for token in mapping.replace(" ", "").split(","):
        if token in ("", "-", "x", "X"):
            staves.append([])
            continue
        try:
            staves.append([ABBREV[c.upper()] for c in token])
        except KeyError as exc:
            raise ValueError(f"Invalid voice letter in mapping {mapping!r}") from exc
    return staves


def plan_layout(staves: list[StaffInfo], layout: str = "auto", mapping: str | None = None) -> LayoutPlan:
    """Decide which staff carries which SATB voice(s)."""
    n = len(staves)
    if mapping:
        voices = parse_mapping(mapping)
        if len(voices) > n:
            raise ValueError(f"Mapping lists {len(voices)} staves but the score has {n}")
        assignment = [(i, v) for i, v in enumerate(voices) if v]
        ignored = [i for i in range(n) if i >= len(voices) or not voices[i]]
        return LayoutPlan("custom", assignment, ignored)

    if layout == "open" or (layout == "auto" and n == 4 and not any(s.is_polyphonic for s in staves)):
        if n < 4:
            raise ValueError(f"Open SATB layout needs 4 staves, found {n}")
        return LayoutPlan("open", [(i, [VOICES[i]]) for i in range(4)], list(range(4, n)))
    if layout == "closed" or (layout == "auto" and n == 2):
        if n < 2:
            raise ValueError(f"Closed SATB layout needs 2 staves, found {n}")
        return LayoutPlan("closed", [(0, ["Soprano", "Alto"]), (1, ["Tenor", "Bass"])], list(range(2, n)))
    if layout != "auto":
        raise ValueError(f"Unknown layout {layout!r}")
    if n == 1:
        return LayoutPlan("melody", [(0, ["Soprano"])], [])

    # Walk staves top-down. Treble staves take Soprano/Alto, bass staves Tenor/Bass. A staff
    # carries two voices when it is polyphonic, or when it is the only staff for its register
    # (e.g. an SA staff whose voices mostly share stems directly above a TB staff).
    groups = {"upper": ["Soprano", "Alto"], "lower": ["Tenor", "Bass"]}
    assignment: list[tuple[int, list[str]]] = []
    ignored: list[int] = []
    for i, s in enumerate(staves):
        pool = groups[s.register]
        borrowed = not pool
        if borrowed:
            # e.g. a tenor printed in plain treble clef; piano staves after a complete choir end here
            other = groups["lower" if s.register == "upper" else "upper"]
            pool = other if (other and not s.is_polyphonic and other is groups["lower"]) else []
        if not pool:
            ignored.append(i)
            continue
        next_same = i + 1 < n and staves[i + 1].register == s.register
        take = 2 if len(pool) >= 2 and not borrowed and (s.is_polyphonic or not next_same) else 1
        assignment.append((i, pool[:take]))
        del pool[:take]
    assigned = [v for _, vs in assignment for v in vs]
    if assignment[:2] == [(0, ["Soprano", "Alto"]), (1, ["Tenor", "Bass"])]:
        kind = "closed"
    elif all(len(vs) == 1 for _, vs in assignment) and len(assigned) == 4:
        kind = "open"
    else:
        kind = "mixed" if len(assigned) == 4 else "partial"
    return LayoutPlan(kind, assignment, ignored)


# --------------------------------------------------------------------------- splitting


@dataclass
class _Event:
    offset: float
    element: note.GeneralNote

    @property
    def end(self) -> float:
        return self.offset + self.element.quarterLength

    @property
    def is_gap(self) -> bool:
        return isinstance(self.element, note.Rest) and self.element.style.hideObjectOnPrint


def _voice_events(v: stream.Stream) -> list[_Event]:
    return [_Event(float(n.offset), n) for n in v.notesAndRests if not isinstance(n, note.Unpitched)]


def _mean_midi(events: list[_Event]) -> float:
    ps = [p.midi for e in events if isinstance(e.element, note.NotRest) for p in e.element.pitches]
    return mean(ps) if ps else float("-inf")


def _pick(el: note.GeneralNote, which: str) -> note.GeneralNote:
    """Return a single-pitch copy of ``el`` (top or bottom note of a chord)."""
    if isinstance(el, chord.Chord):
        members = sorted(el.notes, key=lambda n: n.pitch.midi)
        chosen = members[-1] if which == "top" else members[0]
        n = note.Note(chosen.pitch)
        n.duration = copy.deepcopy(el.duration)
        n.tie = copy.deepcopy(chosen.tie or el.tie)
        n.lyrics = copy.deepcopy(el.lyrics)
        n.articulations = copy.deepcopy(el.articulations)
        n.expressions = copy.deepcopy(el.expressions)
        return n
    out = copy.deepcopy(el)
    if isinstance(out, note.Note):
        out.stemDirection = "unspecified"
        out.beams = type(out.beams)()
    return out


def _fill_gaps(primary: list[_Event], fallbacks: list[list[_Event]], bar_len: float) -> list[_Event]:
    """Fill spans where ``primary`` has no visible content from the fallback voices, in order."""
    result = [e for e in primary if not e.is_gap]
    for fallback in fallbacks:
        result = _fill_from(result, fallback, bar_len)
    return result


def _fill_from(primary: list[_Event], fallback: list[_Event], bar_len: float) -> list[_Event]:
    start = 0.0
    covered = sorted((e.offset, e.end) for e in primary if not e.is_gap)
    gaps, cursor = [], start
    for s, e in covered:
        if s > cursor + 1e-6:
            gaps.append((cursor, s))
        cursor = max(cursor, e)
    if bar_len > cursor + 1e-6:
        gaps.append((cursor, bar_len))
    result = [e for e in primary if not e.is_gap]
    for gs, ge in gaps:
        for e in fallback:
            if e.is_gap or e.offset < gs - 1e-6 or e.offset >= ge - 1e-6:
                continue
            if e.end > ge + 1e-6:
                el = copy.deepcopy(e.element)
                el.quarterLength = ge - e.offset
                result.append(_Event(e.offset, el))
            else:
                result.append(e)
    return sorted(result, key=lambda e: e.offset)


def _measure_len(m: stream.Measure, ts: meter.TimeSignature | None) -> float:
    if ts is not None:
        return float(ts.barDuration.quarterLength) - float(m.paddingLeft or 0)
    return float(m.highestTime)


def _split_measure(
    m: stream.Measure, n_out: int, bar_len: float, voice_names: list[str], flags: list[Flag]
) -> list[list[_Event]]:
    voices = [_voice_events(v) for v in _event_voices(m)]
    voices = [v for v in voices if v]
    if not voices:
        return [[] for _ in range(n_out)]
    voices.sort(key=_mean_midi, reverse=True)

    if len(voices) > 2:
        flags.append(
            Flag(
                "/".join(voice_names),
                m.number,
                None,
                "extra-voices",
                f"{len(voices)} voices on one staff; middle voice(s) only used to fill gaps",
            )
        )
    upper_src = voices[0]
    lower_src = voices[-1] if len(voices) > 1 else voices[0]

    if n_out == 1:
        if len(voices) > 1:
            flags.append(
                Flag(voice_names[0], m.number, None, "divisi", "multiple voices on single-voice staff; kept top")
            )
        evs = _fill_gaps(upper_src, voices[1:], bar_len)
        out = []
        for e in evs:
            if isinstance(e.element, chord.Chord) and len(e.element.pitches) > 1:
                flags.append(
                    Flag(voice_names[0], m.number, e.offset, "divisi", "chord on single-voice staff; kept top note")
                )
            out.append(_Event(e.offset, _pick(e.element, "top")))
        return [out]

    if len(voices) > 1:
        upper = _fill_gaps(upper_src, voices[1:], bar_len)
        lower = _fill_gaps(lower_src, voices[-2::-1], bar_len)
    else:
        upper = lower = upper_src

    for e in upper + lower:
        if isinstance(e.element, chord.Chord) and len(e.element.pitches) > 2:
            flags.append(
                Flag(
                    "/".join(voice_names),
                    m.number,
                    e.offset,
                    "dense-chord",
                    f"{len(e.element.pitches)}-note chord on a two-voice staff; inner notes dropped",
                )
            )
    return [
        [_Event(e.offset, _pick(e.element, "top")) for e in upper],
        [_Event(e.offset, _pick(e.element, "bottom")) for e in lower],
    ]


def _new_part(name: str) -> stream.Part:
    p = stream.Part(id=name)
    p.partName = name
    p.partAbbreviation = name[0] + "."
    inst = instrument.Vocalist()
    inst.partName = name
    inst.instrumentName = name
    p.insert(0, inst)
    return p


def _populate(
    m_out: stream.Measure, events: list[_Event], bar_len: float, voice: str, check: bool, flags: list[Flag]
) -> None:
    cursor = 0.0
    for e in sorted(events, key=lambda e: e.offset):
        if e.offset > cursor + 1e-6:
            m_out.insert(cursor, note.Rest(quarterLength=e.offset - cursor))
            if check:
                flags.append(
                    Flag(voice, m_out.number, cursor, "gap", f"no notes for {e.offset - cursor:g} beats; rest inserted")
                )
        if e.offset < cursor - 1e-6:
            flags.append(Flag(voice, m_out.number, e.offset, "overlap", "overlapping note dropped"))
            continue
        m_out.insert(e.offset, e.element)
        cursor = e.end
    if bar_len > cursor + 1e-6:
        m_out.insert(cursor, note.Rest(quarterLength=bar_len - cursor))
        if check and events:
            flags.append(
                Flag(
                    voice,
                    m_out.number,
                    cursor,
                    "incomplete-measure",
                    f"measure content is {bar_len - cursor:g} beats short; possible missed note",
                )
            )
    elif cursor > bar_len + 1e-6 and check:
        flags.append(Flag(voice, m_out.number, None, "overfull-measure", f"measure content exceeds {bar_len:g} beats"))


def _content_length(m: stream.Measure) -> float:
    ends = [float(n.offset) + float(n.quarterLength) for v in _event_voices(m) for n in v.notesAndRests]
    return max(ends, default=0.0)


def content_lengths(parts: list[stream.Part]) -> list[float]:
    """Longest content per measure index across staves (detects pickups / split measures)."""
    lengths: list[float] = []
    for p in parts:
        for i, m in enumerate(p.getElementsByClass(stream.Measure)):
            c = _content_length(m)
            if i < len(lengths):
                lengths[i] = max(lengths[i], c)
            else:
                lengths.append(c)
    return lengths


def _measure_clefs(m: stream.Measure) -> list[tuple[float, clef.Clef]]:
    """Clefs in ``m`` (including mid-measure changes inside voices), one per offset."""
    found: dict[float, clef.Clef] = {}
    for c in m.recurse().getElementsByClass(clef.Clef):
        found.setdefault(float(c.getOffsetInHierarchy(m)), c)
    return sorted(found.items(), key=lambda t: t[0])


def split_staff(
    part: stream.Part, voice_names: list[str], flags: list[Flag], measure_lengths: list[float] | None = None
) -> list[stream.Part]:
    outs = [_new_part(v) for v in voice_names]
    ts: meter.TimeSignature | None = None
    measures = list(part.getElementsByClass(stream.Measure))
    for i, m in enumerate(measures):
        found = m.getElementsByClass(meter.TimeSignature)
        if found:
            ts = found[0]
        bar_len = _measure_len(m, ts)
        if measure_lengths and i < len(measure_lengths) and 0 < measure_lengths[i] < bar_len - 1e-6:
            bar_len = measure_lengths[i]  # pickup or intentionally partial measure in every staff
        events = _split_measure(m, len(outs), bar_len, voice_names, flags)
        for out, voice_name, evs in zip(outs, voice_names, events):
            mo = stream.Measure(number=m.number)
            mo.numberSuffix = m.numberSuffix
            mo.paddingLeft = m.paddingLeft
            mo.paddingRight = m.paddingRight
            clefs = _measure_clefs(m)
            if i == 0 and not any(off == 0 for off, _ in clefs):
                mo.insert(0, VOICE_CLEFS[voice_name]())
            for off, c in clefs:
                mo.insert(off, copy.deepcopy(c))
            for el in m.getElementsByClass(SHARED_MEASURE_ELEMENTS):
                mo.insert(el.offset, copy.deepcopy(el))
            if m.leftBarline is not None:
                mo.leftBarline = copy.deepcopy(m.leftBarline)
            if m.rightBarline is not None:
                mo.rightBarline = copy.deepcopy(m.rightBarline)
            _populate(mo, evs, bar_len, voice_name, check=True, flags=flags)
            out.append(mo)
    return outs


def to_satb(score: stream.Score, layout: str = "auto", mapping: str | None = None) -> SatbResult:
    staves_src = list(score.parts)
    staves = [analyse_staff(i, p) for i, p in enumerate(staves_src)]
    plan = plan_layout(staves, layout, mapping)
    flags: list[Flag] = []
    produced: dict[str, stream.Part] = {}
    lengths = content_lengths([staves_src[i] for i, _ in plan.assignment])
    for staff_idx, voice_names in plan.assignment:
        for v, part in zip(voice_names, split_staff(staves_src[staff_idx], voice_names, flags, lengths)):
            produced[v] = part
    for i in plan.ignored_staves:
        flags.append(Flag("-", None, None, "ignored-staff", f"staff {i + 1} ({staves[i].name or 'unnamed'}) not used"))

    out = stream.Score()
    if score.metadata is not None:
        out.metadata = copy.deepcopy(score.metadata)
    for v in VOICES:
        if v in produced:
            out.insert(0, produced[v])
        else:
            flags.append(Flag(v, None, None, "missing-voice", f"no staff assigned to {v}"))
    return SatbResult(out, plan, staves, flags)


__all__ = [
    "VOICES",
    "Flag",
    "LayoutPlan",
    "SatbResult",
    "StaffInfo",
    "analyse_staff",
    "parse_mapping",
    "plan_layout",
    "split_staff",
    "to_satb",
]
