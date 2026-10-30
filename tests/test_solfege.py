import pytest
from music21 import key, pitch

from satb_omr.solfege import detect_key, syllable


@pytest.mark.parametrize(
    "k,notes,expected",
    [
        ("C", "C5 D5 E5 G5", "Do Re Mi Sol"),
        ("C", "G4 A4 G4 E4", "Sol La Sol Mi"),
        ("C", "C3 G3 C3 F3", "Do Sol Do Fa"),
        ("G", "G4 A4 B4 C5 D5 E5 F#5", "Do Re Mi Fa Sol La Ti"),
        ("C", "C#4 D-4 D#4 E-4 F#4 G#4 A-4 B-4", "Di Ra Ri Me Fi Si Le Te"),
    ],
)
def test_major_solfege(k, notes, expected):
    assert " ".join(syllable(pitch.Pitch(n), key.Key(k)) for n in notes.split()) == expected


def test_minor_conventions():
    am = key.Key("a")
    assert syllable(pitch.Pitch("A4"), am, minor="la") == "La"
    assert syllable(pitch.Pitch("G#4"), am, minor="la") == "Si"
    assert syllable(pitch.Pitch("A4"), am, minor="do") == "Do"
    assert syllable(pitch.Pitch("C5"), am, minor="do") == "Me"


def test_tonic_solfa():
    g = key.Key("G")
    assert [syllable(pitch.Pitch(n), g, style="tonic-solfa") for n in ["G4", "A4", "B4", "C#5", "F5"]] == [
        "d",
        "r",
        "m",
        "fe",
        "ta",
    ]


def test_detect_key_uses_signature_and_analysis(tmp_path):
    from music21 import converter

    s = converter.parse("tinyNotation: 4/4 a4 c' e' a' g#' e' a2")
    s.insert(0, key.KeySignature(0))
    k = detect_key(s)
    assert (k.tonic.name, k.mode) == ("A", "minor")
    k = detect_key(s, "G major")
    assert (k.tonic.name, k.mode) == ("G", "major")
