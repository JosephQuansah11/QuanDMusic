"""Movable-Do solfège and tonic sol-fa syllables."""

from __future__ import annotations

from music21 import key, note, pitch, stream

LETTERS = "CDEFGAB"
MAJOR_STEPS = (0, 2, 4, 5, 7, 9, 11)

# (lowered, natural, raised) syllable per scale degree; enharmonic fallbacks for
# rarely-named alterations (raised Mi -> Fa, lowered Do -> Ti, ...).
SYLLABLES = {
    "solfege": (
        ("Ti", "Do", "Di"),
        ("Ra", "Re", "Ri"),
        ("Me", "Mi", "Fa"),
        ("Mi", "Fa", "Fi"),
        ("Se", "Sol", "Si"),
        ("Le", "La", "Li"),
        ("Te", "Ti", "Do"),
    ),
    "tonic-solfa": (
        ("t", "d", "de"),
        ("ra", "r", "re"),
        ("ma", "m", "f"),
        ("m", "f", "fe"),
        ("ba", "s", "se"),
        ("lo", "l", "le"),
        ("ta", "t", "d"),
    ),
}


def do_pitch(k: key.Key, minor: str = "la") -> pitch.Pitch:
    """Pitch class acting as Do. ``minor='la'`` uses the relative major's tonic."""
    if k.mode == "minor" and minor == "la":
        return k.relative.tonic
    return k.tonic


def syllable(p: pitch.Pitch, k: key.Key, minor: str = "la", style: str = "solfege") -> str:
    if style not in SYLLABLES:
        raise ValueError(f"Unknown syllable style {style!r}")
    do = do_pitch(k, minor)
    degree = (LETTERS.index(p.step) - LETTERS.index(do.step)) % 7
    expected = (do.pitchClass + MAJOR_STEPS[degree]) % 12
    diff = (p.pitchClass - expected + 6) % 12 - 6
    table = SYLLABLES[style][degree]
    if diff == 0:
        return table[1]
    if diff == 1:
        return table[2]
    if diff == -1:
        return table[0]
    # Double alterations: fall back to the chromatic position.
    semis = (p.pitchClass - do.pitchClass) % 12
    for deg, step in enumerate(MAJOR_STEPS):
        if step == semis:
            return SYLLABLES[style][deg][1]
        if step == semis - 1:
            return SYLLABLES[style][deg][2]
    return "?"


def detect_key(score: stream.Score, override: str | None = None) -> key.Key:
    """Key from the first key signature, with the mode chosen by pitch analysis."""
    if override:
        tonic, _, mode = override.strip().partition(" ")
        return key.Key(tonic.replace("b", "-") if len(tonic) > 1 else tonic, mode or "major")
    sigs = list(score.recurse().getElementsByClass(key.KeySignature))
    ks = sigs[0] if sigs else key.KeySignature(0)
    if isinstance(ks, key.Key):
        return ks
    try:
        analysed = score.analyze("key")
    except Exception:  # noqa: BLE001 - analysis fails on empty scores
        analysed = None
    if analysed is not None and analysed.sharps == ks.sharps:
        return analysed
    return ks.asKey("major")


def key_for(n: note.GeneralNote, global_key: key.Key) -> key.Key:
    """Key in effect for ``n``; follows key-signature changes, keeping the global mode."""
    ks = n.getContextByClass(key.KeySignature)
    if ks is None or ks.sharps == global_key.sharps:
        return global_key
    if isinstance(ks, key.Key):
        return ks
    return ks.asKey(global_key.mode)


def annotate_lyrics(score: stream.Score, k: key.Key, minor: str = "la", style: str = "solfege") -> None:
    """Add the syllable of every note as an extra lyric line."""
    for n in score.recurse().notes:
        if isinstance(n, note.Note) and not (n.tie and n.tie.type in ("stop", "continue")):
            n.addLyric(syllable(n.pitch, key_for(n, k), minor, style))
