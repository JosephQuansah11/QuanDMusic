# QuanDMusic — SATB OMR

Turns sheet music (PDF, photo or scan) into MusicXML with four independent voices — **Soprano, Alto, Tenor, Bass** — plus MIDI, movable-Do solfège and a review report.

It handles both choral layouts:

| Layout | What it looks like | What happens |
|---|---|---|
| **Open score** | S, A, T, B on four separate staves | each staff becomes one voice |
| **Closed / combined score** | two staves: S+A share the treble staff, T+B share the bass staff | each staff is split into its two voices (by OMR voice, stem direction and chord top/bottom notes; unisons go to both voices), then processed like an open score |

Layout is detected automatically; it can be forced with `--layout` or an explicit `--map`.

## Pipeline

```
PDF / image ──► page images (PyMuPDF) ──► clean-up: deskew, background flattening, rescale to ~20px staff spacing (OpenCV)
            ──► optical music recognition (Audiveris; oemer optional) ──► raw MusicXML per page
            ──► SATB layout detection + combined-staff splitting (music21) ──► 4 voice parts, pages joined
            ──► key detection, solfège, range / leap / voice-crossing checks
            ──► SATB MusicXML + MIDI, per-voice files, JSON / CSV / Markdown report, PNG preview
```

MusicXML files can also be given as input to skip recognition and only do SATB separation + solfège.

## Install

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
./scripts/install_audiveris.sh      # Audiveris 5.11 + Java 17 (Ubuntu/Debian)
```

Audiveris is found via `$AUDIVERIS_BIN`, `PATH` or `/opt/audiveris/bin/Audiveris`.
`pip install -e ".[oemer]"` adds the experimental oemer fallback engine.

## Use

```bash
satb-omr convert hymn.pdf -o out/ --preview          # auto layout
satb-omr convert photo.jpg --layout closed            # force combined-staff splitting
satb-omr convert score.pdf --map "S,A,T,B,-,-"        # 4 voices + ignore 2 piano staves
satb-omr convert score.pdf --key "E minor" --minor do --solfege-lyrics
satb-omr evaluate out/hymn.satb.musicxml truth.musicxml   # accuracy against a checked transcription
satb-omr serve --port 8000                            # web UI: upload, preview, download
```

`--map` lists staves top to bottom, one entry per staff per system: `SA,TB`, `S,A,T,B`, `S,A,TB`, `-` = ignore.

### Outputs (`out/`)

- `<name>.satb.musicxml`, `<name>.satb.mid` — four-part score; every voice keeps its source staff's clef (a split Tenor stays in bass clef), so notes sit exactly where they were printed
- `voices/<name>.<voice>.musicxml|.mid` — each voice on its own
- `<name>.notes.csv` / `.report.json` — every note: voice, measure, beat, duration, pitch, MIDI, solfège
- `<name>.report.md` — readable summary + **review flags**
- `<name>.satb.png` — preview (with `--preview`)

### Review flags

Nothing is silently "corrected". Suspicious results are flagged for a human: notes outside the usual voice range, leaps over an octave, adjacent voices crossing, gaps filled with rests, incomplete/overfull measures, extra voices on a combined staff, unassigned staves.

## Accuracy (current)

Measured with `satb-omr evaluate` on synthetic scores rendered from known music (`scripts/make_fixtures.py`):

| Input | Overall note recall |
|---|---|
| closed (combined) hymn, PNG | 100% |
| closed score, PDF | 99% |
| open score, PDF | 97% |

Public-domain hymns from Mutopia (Old 100th, Leoni, Easter Hymn) convert with 2–4 review flags each. OMR errors (misread accidentals, ties, rhythm) come from the recognition engine and are what the flags are for — check flagged measures before using the output.

## Known limitations

- Accuracy depends on Audiveris; handwritten music and poor phone photos are much weaker than clean prints.
- Combined-staff chords with more than two notes keep only the top and bottom notes (flagged).
- Per-symbol OMR confidence is not yet propagated to the report.
- oemer currently crashes on some pages with recent OpenCV versions; Audiveris is the supported engine.

## Development

```bash
pytest                 # unit + end-to-end tests (OMR tests skip if Audiveris is missing)
pytest -m "not omr"    # fast tests only
ruff check . && ruff format --check .
python scripts/make_fixtures.py   # regenerate synthetic test scores
```
