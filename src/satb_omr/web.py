"""Minimal web UI / HTTP API around the conversion pipeline."""

from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse

from .engines import EngineError
from .ingest import input_kind
from .pipeline import ConvertOptions, convert

DATA_DIR = Path(os.environ.get("SATB_OMR_DATA", Path.home() / ".satb_omr" / "jobs"))
STATIC = Path(__file__).parent / "static"

app = FastAPI(title="SATB OMR", version="0.1.0")


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return (STATIC / "index.html").read_text()


@app.post("/api/convert")
def api_convert(
    file: UploadFile = File(...),
    engine: str = Form("auto"),
    layout: str = Form("auto"),
    mapping: str = Form(""),
    key: str = Form(""),
    minor: str = Form("la"),
    syllables: str = Form("solfege"),
    solfege_lyrics: bool = Form(False),
) -> dict:
    name = re.sub(r"[^A-Za-z0-9._-]", "_", Path(file.filename or "score").name)
    try:
        input_kind(Path(name))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    job = uuid.uuid4().hex[:12]
    job_dir = DATA_DIR / job
    job_dir.mkdir(parents=True)
    src = job_dir / name
    src.write_bytes(file.file.read())
    opts = ConvertOptions(
        engine=engine,
        layout=layout,
        mapping=mapping or None,
        key=key or None,
        minor=minor,
        syllables=syllables,
        solfege_lyrics=solfege_lyrics,
        preview=True,
    )
    try:
        res = convert(src, job_dir / "out", opts)
    except (EngineError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    out_root = job_dir / "out"
    report = json.loads(res.outputs["report_json"].read_text())
    return {
        "job": job,
        "key": report["meta"]["key"],
        "do": report["meta"]["do"],
        "layouts": report["meta"]["layouts"],
        "engines": report["meta"]["engines"],
        "flags": report["flags"],
        "notes": report["notes"],
        "files": {k: f"/files/{job}/{p.relative_to(out_root)}" for k, p in res.outputs.items()},
    }


@app.get("/files/{job}/{path:path}")
def files(job: str, path: str) -> FileResponse:
    if not re.fullmatch(r"[0-9a-f]{12}", job):
        raise HTTPException(404)
    root = (DATA_DIR / job / "out").resolve()
    target = (root / path).resolve()
    if root not in target.parents or not target.is_file():
        raise HTTPException(404)
    return FileResponse(target, filename=target.name)
