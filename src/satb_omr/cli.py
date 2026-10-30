"""Command-line interface: ``satb-omr convert|evaluate|serve``."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .engines import EngineError


def _convert(args: argparse.Namespace) -> int:
    from .pipeline import ConvertOptions, convert

    opts = ConvertOptions(
        engine=args.engine,
        layout=args.layout,
        mapping=args.map,
        preprocess=not args.no_preprocess,
        dpi=args.dpi,
        key=args.key,
        minor=args.minor,
        syllables=args.syllables,
        solfege_lyrics=args.solfege_lyrics,
        midi=not args.no_midi,
        voice_files=not args.no_voice_files,
        preview=args.preview,
    )
    out = args.output or Path(args.input).with_suffix("").parent / f"{Path(args.input).stem}_satb"
    try:
        res = convert(Path(args.input), Path(out), opts)
    except (EngineError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"Key: {res.key.tonic.name} {res.key.mode}")
    for p in res.pages:
        print(f"Page {p.page} [{p.engine}]: {p.satb.plan.describe()}")
    print(f"Review flags: {len(res.flags)}")
    for name, path in res.outputs.items():
        print(f"  {name:18} {path}")
    return 0


def _evaluate(args: argparse.Namespace) -> int:
    from .evaluate import compare_files

    print(json.dumps(compare_files(Path(args.pred), Path(args.truth)), indent=2))
    return 0


def _serve(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run("satb_omr.web:app", host=args.host, port=args.port)
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="satb-omr", description="Sheet music (PDF/image) to SATB MusicXML")
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("convert", help="convert a PDF, image or MusicXML file")
    c.add_argument("input")
    c.add_argument("-o", "--output", type=Path, help="output folder (default: <input>_satb)")
    c.add_argument("--engine", default="auto", choices=["auto", "audiveris", "oemer"])
    c.add_argument(
        "--layout",
        default="auto",
        choices=["auto", "open", "closed"],
        help="open = 4 staves (S,A,T,B); closed = 2 combined staves (SA,TB)",
    )
    c.add_argument("--map", help='explicit staff mapping, top to bottom, e.g. "SA,TB" or "S,A,TB,-,-"')
    c.add_argument("--no-preprocess", action="store_true", help="skip deskew/clean-up/rescale")
    c.add_argument("--dpi", type=int, default=300, help="PDF rasterisation resolution")
    c.add_argument("--key", help='override key, e.g. "G major" or "E minor"')
    c.add_argument("--minor", default="la", choices=["la", "do"], help="minor-key solfège convention")
    c.add_argument("--syllables", default="solfege", choices=["solfege", "tonic-solfa"])
    c.add_argument("--solfege-lyrics", action="store_true", help="add solfège as a lyric line in the MusicXML")
    c.add_argument("--no-midi", action="store_true")
    c.add_argument("--no-voice-files", action="store_true", help="skip per-voice MusicXML/MIDI files")
    c.add_argument("--preview", action="store_true", help="render a PNG preview of the SATB result")
    c.set_defaults(func=_convert)

    e = sub.add_parser("evaluate", help="score a transcription against a ground-truth MusicXML")
    e.add_argument("pred")
    e.add_argument("truth")
    e.set_defaults(func=_evaluate)

    s = sub.add_parser("serve", help="start the web UI")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.set_defaults(func=_serve)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose else logging.WARNING, format="%(levelname)s %(message)s")
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
