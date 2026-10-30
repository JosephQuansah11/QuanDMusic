"""Generate synthetic SATB test scores (open and closed layouts) from a Bach chorale.

Writes ground-truth MusicXML plus rendered PNG/PDF pages into tests/fixtures/.
"""

from __future__ import annotations

import argparse
import copy
from pathlib import Path

from music21 import clef, corpus, layout, note, stream

from satb_omr.render import render_musicxml

VOICES = ["Soprano", "Alto", "Tenor", "Bass"]


def load_truth(chorale: str, measures: int) -> stream.Score:
    score = corpus.parse(chorale)
    out = stream.Score()
    for part, name in zip(score.parts, VOICES):
        p = part.measures(0, measures)
        for n in p.recurse().notes:
            n.lyrics = []
            n.expressions = []
        p.partName = name
        p.id = name
        out.insert(0, p)
    return out


def open_score(truth: stream.Score) -> stream.Score:
    s = copy.deepcopy(truth)
    tenor = s.parts[2]
    for c in tenor.recurse().getElementsByClass(clef.Clef):
        c.activeSite.replace(c, clef.Treble8vbClef())
    return s


def closed_score(truth: stream.Score) -> stream.Score:
    """Two staves: S+A on treble staff (stems up/down), T+B on bass staff."""
    s = stream.Score()
    staves = []
    for upper_idx, lower_idx, clf in ((0, 1, clef.TrebleClef()), (2, 3, clef.BassClef())):
        upper, lower = truth.parts[upper_idx], truth.parts[lower_idx]
        staff = stream.PartStaff()
        for mu, ml in zip(upper.getElementsByClass(stream.Measure), lower.getElementsByClass(stream.Measure)):
            m = stream.Measure(number=mu.number)
            if mu.paddingLeft:
                m.paddingLeft = mu.paddingLeft
            for el in mu.getElementsByClass(("TimeSignature", "KeySignature")):
                m.insert(el.offset, copy.deepcopy(el))
            if mu.number == upper.getElementsByClass(stream.Measure)[0].number:
                m.insert(0, copy.deepcopy(clf))
            for vnum, (src, stem) in enumerate(((mu, "up"), (ml, "down")), start=1):
                v = stream.Voice(id=str(vnum))
                for n in src.notesAndRests:
                    nn = copy.deepcopy(n)
                    if isinstance(nn, note.Note):
                        nn.stemDirection = stem
                    v.insert(n.offset, nn)
                m.insert(0, v)
            staff.append(m)
        staves.append(staff)
    for st in staves:
        s.insert(0, st)
    s.insert(0, layout.StaffGroup(staves, symbol="brace", barTogether=True, name="Choir"))
    return s


HYMN = {
    # G major hymn, homorhythmic, with S/A and T/B unisons (notes shared on one stem).
    "rhythm": [[1, 1, 1, 1], [1, 1, 2], [1, 1, 1, 1], [1, 1, 2], [1, 1, 1, 1], [1, 1, 2], [1, 1, 1, 1], [4]],
    "Soprano": "B4 B4 A4 G4 | A4 B4 A4 | B4 C5 D5 B4 | A4 A4 G4 | D5 D5 C5 B4 | A4 B4 C5 | B4 A4 G4 F#4 | G4",
    "Alto": "G4 G4 F#4 D4 | F#4 G4 F#4 | G4 A4 B4 G4 | G4 F#4 G4 | G4 G4 A4 G4 | F#4 G4 A4 | G4 E4 G4 D4 | D4",
    "Tenor": "D4 D4 D4 B3 | D4 D4 D4 | D4 E4 D4 B3 | E4 D4 B3 | B3 B3 E4 D4 | D4 D4 E4 | D4 C4 B3 C4 | B3",
    "Bass": "G3 G3 D3 G3 | D3 G3 D3 | G3 A3 B3 B3 | C3 D3 G2 | G3 G3 A3 B3 | D3 G3 A3 | G3 C3 D3 D3 | G2",
}


def hymn_truth() -> stream.Score:
    from music21 import key, meter

    s = stream.Score()
    for v in VOICES:
        p = stream.Part(id=v)
        p.partName = v
        bars = [b.split() for b in HYMN[v].split("|")]
        for i, (pitches, rhythm) in enumerate(zip(bars, HYMN["rhythm"]), start=1):
            m = stream.Measure(number=i)
            if i == 1:
                m.insert(0, {"Tenor": clef.Treble8vbClef, "Bass": clef.BassClef}.get(v, clef.TrebleClef)())
                m.insert(0, key.KeySignature(1))
                m.insert(0, meter.TimeSignature("4/4"))
            for ps, ql in zip(pitches, rhythm):
                m.append(note.Note(ps, quarterLength=ql))
            p.append(m)
        s.insert(0, p)
    return s


def chord_closed_score(truth: stream.Score) -> stream.Score:
    """Two staves, one voice each: S+A and T+B written as chords; unisons as one notehead."""
    from music21 import chord

    s = stream.Score()
    staves = []
    for upper_idx, lower_idx, clf in ((0, 1, clef.TrebleClef()), (2, 3, clef.BassClef())):
        upper, lower = truth.parts[upper_idx], truth.parts[lower_idx]
        staff = stream.PartStaff()
        for mu, ml in zip(upper.getElementsByClass(stream.Measure), lower.getElementsByClass(stream.Measure)):
            m = stream.Measure(number=mu.number)
            for el in mu.getElementsByClass(("TimeSignature", "KeySignature")):
                m.insert(el.offset, copy.deepcopy(el))
            if mu.number == 1:
                m.insert(0, copy.deepcopy(clf))
            for nu, nl in zip(mu.notes, ml.notes):
                if nu.pitch.midi == nl.pitch.midi:
                    el = note.Note(nu.pitch, quarterLength=nu.quarterLength)
                else:
                    el = chord.Chord([nl.pitch, nu.pitch], quarterLength=nu.quarterLength)
                m.insert(nu.offset, el)
            staff.append(m)
        staves.append(staff)
    for st in staves:
        s.insert(0, st)
    s.insert(0, layout.StaffGroup(staves, symbol="brace", barTogether=True, name="Choir"))
    return s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chorale", default="bach/bwv66.6")
    ap.add_argument("--measures", type=int, default=6)
    ap.add_argument("--out", type=Path, default=Path("tests/fixtures"))
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    truth = load_truth(args.chorale, args.measures)
    truth.write("musicxml", fp=args.out / "truth.musicxml")
    for name, sc in (("open", open_score(truth)), ("closed", closed_score(truth))):
        xml = args.out / f"{name}.musicxml"
        sc.write("musicxml", fp=xml)
        render_musicxml(xml, args.out / f"{name}.png", pdf_path=args.out / f"{name}.pdf")
        print("wrote", name)

    hymn = hymn_truth()
    hymn.write("musicxml", fp=args.out / "hymn_truth.musicxml")
    xml = args.out / "hymn_closed.musicxml"
    chord_closed_score(hymn).write("musicxml", fp=xml)
    render_musicxml(xml, args.out / "hymn_closed.png", pdf_path=args.out / "hymn_closed.pdf")
    print("wrote hymn_closed")


if __name__ == "__main__":
    main()
