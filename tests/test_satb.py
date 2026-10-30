import copy

import pytest
from music21 import chord, clef, key, meter, note, stream

from satb_omr.satb import parse_mapping, plan_layout, to_satb


def _measure(number, items, voices=None):
    m = stream.Measure(number=number)
    if number == 1:
        m.insert(0, key.KeySignature(0))
        m.insert(0, meter.TimeSignature("4/4"))
    if voices:
        for vid, elements in voices.items():
            v = stream.Voice(id=str(vid))
            for el in elements:
                v.append(el)
            m.insert(0, v)
    else:
        for el in items:
            m.append(el)
    return m


def _staff(measures, clf):
    p = stream.PartStaff()
    measures[0].insert(0, clf)
    for m in measures:
        p.append(m)
    return p


def _pitches(part):
    return [n.nameWithOctave if isinstance(n, note.Note) else "r" for n in part.recurse().notesAndRests]


def _closed_with_chords():
    upper = _staff(
        [
            _measure(
                1, [chord.Chord(["E4", "C5"]), chord.Chord(["F4", "D5"]), note.Note("E4"), chord.Chord(["G4", "C5"])]
            ),
        ],
        clef.TrebleClef(),
    )
    lower = _staff(
        [
            _measure(
                1, [chord.Chord(["C3", "G3"]), chord.Chord(["B2", "G3"]), chord.Chord(["C3", "G3"]), note.Note("E3")]
            )
        ],
        clef.BassClef(),
    )
    s = stream.Score()
    s.insert(0, upper)
    s.insert(0, lower)
    return s


def test_closed_score_chords_are_split_top_and_bottom():
    res = to_satb(_closed_with_chords())
    assert res.plan.kind == "closed"
    parts = {p.partName: _pitches(p) for p in res.score.parts}
    assert parts["Soprano"] == ["C5", "D5", "E4", "C5"]
    assert parts["Alto"] == ["E4", "F4", "E4", "G4"]  # unison E4 shared
    assert parts["Tenor"] == ["G3", "G3", "G3", "E3"]
    assert parts["Bass"] == ["C3", "B2", "C3", "E3"]


def test_split_voices_keep_source_clef_and_positions():
    res = to_satb(_closed_with_chords())
    assert [p.partName for p in res.score.parts] == ["Soprano", "Alto", "Tenor", "Bass"]
    first = [p.recurse().getElementsByClass(clef.Clef)[0] for p in res.score.parts]
    assert [type(c) for c in first] == [clef.TrebleClef, clef.TrebleClef, clef.BassClef, clef.BassClef]
    for p in res.score.parts:
        assert all(n.stemDirection == "unspecified" for n in p.recurse().notes)


def test_mid_measure_clef_change_is_copied_to_both_voices():
    m = _measure(
        1, [chord.Chord(["C3", "G3"]), chord.Chord(["D3", "B3"]), chord.Chord(["C4", "E4"]), chord.Chord(["C4", "G4"])]
    )
    m.insert(3, clef.TrebleClef())
    upper = _staff([_measure(1, [chord.Chord(["E4", "C5"]) for _ in range(4)])], clef.TrebleClef())
    res = to_satb(stream.Score([upper, _staff([m], clef.BassClef())]))
    for p in res.score.parts[2:]:
        cs = [(float(c.offset), type(c)) for c in p.recurse().getElementsByClass(clef.Clef)]
        assert cs == [(0.0, clef.BassClef), (3.0, clef.TrebleClef)]


def test_two_voices_with_different_rhythms():
    upper = _staff(
        [
            _measure(
                1,
                None,
                voices={
                    1: [note.Note("C5", quarterLength=2), note.Note("D5", quarterLength=2)],
                    2: [note.Note("E4"), note.Note("F4"), note.Note("G4", quarterLength=2)],
                },
            )
        ],
        clef.TrebleClef(),
    )
    lower = _staff([_measure(1, [note.Note("C3", quarterLength=4)])], clef.BassClef())
    s = stream.Score([upper, lower])
    res = to_satb(s)
    parts = {p.partName: p for p in res.score.parts}
    assert _pitches(parts["Soprano"]) == ["C5", "D5"]
    assert _pitches(parts["Alto"]) == ["E4", "F4", "G4"]
    assert [n.quarterLength for n in parts["Alto"].recurse().notes] == [1.0, 1.0, 2.0]
    assert _pitches(parts["Tenor"]) == ["C3"] and _pitches(parts["Bass"]) == ["C3"]


def test_hidden_rest_gap_is_filled_from_other_voice():
    hidden = note.Rest(quarterLength=2)
    hidden.style.hideObjectOnPrint = True
    upper = _staff(
        [
            _measure(
                1,
                None,
                voices={
                    1: [note.Note("C5", quarterLength=2), note.Note("D5"), note.Note("E5")],
                    2: [hidden, note.Note("G4"), note.Note("A4")],
                },
            )
        ],
        clef.TrebleClef(),
    )
    lower = _staff([_measure(1, [note.Note("C3", quarterLength=4)])], clef.BassClef())
    res = to_satb(stream.Score([upper, lower]))
    alto = next(p for p in res.score.parts if p.partName == "Alto")
    assert _pitches(alto) == ["C5", "G4", "A4"]


def test_explicit_rest_in_lower_voice_is_kept():
    upper = _staff(
        [
            _measure(
                1,
                None,
                voices={
                    1: [note.Note("C5", quarterLength=2), note.Note("D5", quarterLength=2)],
                    2: [note.Rest(quarterLength=2), note.Note("G4", quarterLength=2)],
                },
            )
        ],
        clef.TrebleClef(),
    )
    lower = _staff([_measure(1, [note.Note("C3", quarterLength=4)])], clef.BassClef())
    res = to_satb(stream.Score([upper, lower]))
    alto = next(p for p in res.score.parts if p.partName == "Alto")
    assert _pitches(alto) == ["r", "G4"]


def _mono_staff(pitch, clf):
    return _staff([_measure(1, [note.Note(pitch, quarterLength=4)])], clf)


def test_open_score_four_staves():
    s = stream.Score(
        [
            _mono_staff("C5", clef.TrebleClef()),
            _mono_staff("E4", clef.TrebleClef()),
            _mono_staff("G3", clef.Treble8vbClef()),
            _mono_staff("C3", clef.BassClef()),
        ]
    )
    res = to_satb(s)
    assert res.plan.kind == "open"
    assert [_pitches(p) for p in res.score.parts] == [["C5"], ["E4"], ["G3"], ["C3"]]


def test_mixed_layout_combined_upper_and_separate_lower():
    upper = _staff([_measure(1, [chord.Chord(["E4", "C5"], quarterLength=4)])], clef.TrebleClef())
    s = stream.Score([upper, _mono_staff("G3", clef.Treble8vbClef()), _mono_staff("C3", clef.BassClef())])
    res = to_satb(s)
    assert res.plan.assignment == [(0, ["Soprano", "Alto"]), (1, ["Tenor"]), (2, ["Bass"])]
    assert [_pitches(p) for p in res.score.parts] == [["C5"], ["E4"], ["G3"], ["C3"]]


def test_accompaniment_staves_are_ignored():
    choir = [
        _staff([_measure(1, [chord.Chord(["E4", "C5"], quarterLength=4)])], clef.TrebleClef()),
        _staff([_measure(1, [chord.Chord(["C3", "G3"], quarterLength=4)])], clef.BassClef()),
    ]
    piano = [
        _staff([_measure(1, [chord.Chord(["C4", "E4", "G4"], quarterLength=4)])], clef.TrebleClef()),
        _staff([_measure(1, [chord.Chord(["C2", "C3"], quarterLength=4)])], clef.BassClef()),
    ]
    res = to_satb(stream.Score(choir + piano))
    assert res.plan.kind == "closed"
    assert res.plan.ignored_staves == [2, 3]
    assert [_pitches(p) for p in res.score.parts] == [["C5"], ["E4"], ["G3"], ["C3"]]


def test_custom_mapping():
    assert parse_mapping("SA,TB") == [["Soprano", "Alto"], ["Tenor", "Bass"]]
    assert parse_mapping("S,A,-,TB") == [["Soprano"], ["Alto"], [], ["Tenor", "Bass"]]
    with pytest.raises(ValueError):
        parse_mapping("SX")
    plan = plan_layout([], mapping=None) if False else None  # noqa: F841
    s = stream.Score(
        [
            _mono_staff("C5", clef.TrebleClef()),
            _staff([_measure(1, [chord.Chord(["C3", "G3"], quarterLength=4)])], clef.BassClef()),
        ]
    )
    res = to_satb(s, mapping="S,TB")
    assert {p.partName for p in res.score.parts} == {"Soprano", "Tenor", "Bass"}
    assert any(f.kind == "missing-voice" for f in res.flags)


def test_dense_chord_is_flagged():
    upper = _staff([_measure(1, [chord.Chord(["C4", "E4", "G4", "C5"], quarterLength=4)])], clef.TrebleClef())
    lower = _staff([_measure(1, [chord.Chord(["C3", "G3"], quarterLength=4)])], clef.BassClef())
    res = to_satb(stream.Score([upper, lower]))
    assert any(f.kind == "dense-chord" for f in res.flags)
    assert [_pitches(p) for p in res.score.parts][:2] == [["C5"], ["C4"]]


def test_measures_are_filled_to_bar_length():
    upper = _staff([_measure(1, [note.Note("C5", quarterLength=2)])], clef.TrebleClef())
    lower = _staff([_measure(1, [note.Note("C3", quarterLength=4)])], clef.BassClef())
    res = to_satb(stream.Score([upper, lower]))
    for p in res.score.parts:
        m = p.getElementsByClass(stream.Measure)[0]
        assert sum(n.quarterLength for n in m.notesAndRests) == 4


def test_closed_staff_with_mostly_shared_stems_still_carries_two_voices():
    upper = _staff(
        [
            _measure(1, [note.Note("E5", quarterLength=4)]),
            _measure(2, [note.Note("D5", quarterLength=4)]),
            _measure(3, [chord.Chord(["G4", "C5"], quarterLength=4)]),
            _measure(4, [note.Note("C5", quarterLength=4)]),
        ],
        clef.TrebleClef(),
    )
    lower = _staff([_measure(i, [chord.Chord(["C3", "G3"], quarterLength=4)]) for i in range(1, 5)], clef.BassClef())
    res = to_satb(stream.Score([copy.deepcopy(upper), copy.deepcopy(lower)]))
    assert res.plan.kind == "closed"
    s3 = stream.Score([copy.deepcopy(upper), copy.deepcopy(lower), _mono_staff("C4", clef.TrebleClef())])
    res = to_satb(s3)
    assert res.plan.assignment[:2] == [(0, ["Soprano", "Alto"]), (1, ["Tenor", "Bass"])]
    assert [_pitches(p)[2] for p in res.score.parts[:2]] == ["C5", "G4"]


def test_open_score_with_treble_tenor_and_piano():
    piano = [
        _staff([_measure(1, [chord.Chord(["C4", "E4", "G4"], quarterLength=4)])], clef.TrebleClef()),
        _staff([_measure(1, [chord.Chord(["C2", "C3"], quarterLength=4)])], clef.BassClef()),
    ]
    choir = [
        _mono_staff("C5", clef.TrebleClef()),
        _mono_staff("E4", clef.TrebleClef()),
        _mono_staff("G4", clef.TrebleClef()),
        _mono_staff("C3", clef.BassClef()),
    ]
    res = to_satb(stream.Score(choir + piano))
    assert res.plan.kind == "open"
    assert res.plan.assignment == [(0, ["Soprano"]), (1, ["Alto"]), (2, ["Tenor"]), (3, ["Bass"])]
    assert res.plan.ignored_staves == [4, 5]
