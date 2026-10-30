import dataclasses
import json
import shutil
from pathlib import Path

import pytest

from satb_omr.engines import AudiverisEngine
from satb_omr.evaluate import compare_files
from satb_omr.pipeline import ConvertOptions, convert

FIX = Path(__file__).parent / "fixtures"
needs_audiveris = pytest.mark.skipif(not AudiverisEngine().available(), reason="Audiveris not installed")


@pytest.mark.parametrize(
    "src,truth",
    [
        ("closed.musicxml", "truth.musicxml"),
        ("open.musicxml", "truth.musicxml"),
        ("hymn_closed.musicxml", "hymn_truth.musicxml"),
    ],
)
def test_musicxml_input_is_separated_exactly(src, truth, tmp_path):
    res = convert(FIX / src, tmp_path, ConvertOptions())
    metrics = compare_files(res.outputs["musicxml"], FIX / truth)
    assert metrics["overall"]["note_recall"] == 1.0
    assert metrics["overall"]["note_precision"] == 1.0


def test_outputs_and_report(tmp_path):
    res = convert(FIX / "hymn_closed.musicxml", tmp_path, ConvertOptions(syllables="tonic-solfa", solfege_lyrics=True))
    for name in ("musicxml", "midi", "report_json", "report_csv", "report_md", "soprano_midi", "bass_musicxml"):
        assert res.outputs[name].exists(), name
    data = json.loads(res.outputs["report_json"].read_text())
    assert data["meta"]["key"] == "G major"
    first_soprano = next(n for n in data["notes"] if n["voice"] == "Soprano")
    assert (first_soprano["pitch"], first_soprano["solfege"]) == ("B4", "m")
    assert "<text>m</text>" in res.outputs["musicxml"].read_text()


@needs_audiveris
@pytest.mark.omr
@pytest.mark.parametrize(
    "src,truth,min_recall",
    [
        ("hymn_closed.png", "hymn_truth.musicxml", 0.95),
        ("closed.pdf", "truth.musicxml", 0.9),
        ("open.png", "truth.musicxml", 0.9),
    ],
)
def test_end_to_end_omr(src, truth, min_recall, tmp_path):
    res = convert(FIX / src, tmp_path, ConvertOptions(engine="audiveris", voice_files=False))
    metrics = compare_files(res.outputs["musicxml"], FIX / truth)
    assert metrics["overall"]["note_recall"] >= min_recall, metrics


def test_web_api_convert(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from satb_omr import web

    monkeypatch.setattr(web, "DATA_DIR", tmp_path)
    monkeypatch.setattr(
        web, "convert", lambda src, out, opts: convert(src, out, dataclasses.replace(opts, preview=False))
    )
    client = TestClient(web.app)
    assert "SATB OMR" in client.get("/").text
    with (FIX / "hymn_closed.musicxml").open("rb") as fh:
        resp = client.post("/api/convert", files={"file": ("hymn.musicxml", fh)}, data={"layout": "auto"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["key"] == "G major"
    assert client.get(body["files"]["musicxml"]).status_code == 200
    assert client.get(f"/files/{body['job']}/../../etc/passwd").status_code == 404
    first_b4 = next(n for n in body["notes"] if n["voice"] == "Soprano" and n["pitch"] == "B4")
    assert first_b4["solfege"] == "Mi"

    with (FIX / "hymn_closed.musicxml").open("rb") as fh:
        resp = client.post("/api/convert", files={"file": ("hymn.musicxml", fh)}, data={"key": "D major"})
    body = resp.json()
    assert body["key"] == "D major"
    first_b4 = next(n for n in body["notes"] if n["voice"] == "Soprano" and n["pitch"] == "B4")
    assert first_b4["solfege"] == "La"

    resp = client.post("/api/convert", files={"file": ("bad.pdf", b"not a pdf")})
    assert resp.status_code == 422
    assert "Cannot read PDF" in resp.json()["detail"]


def test_preview_renders_from_worker_threads(tmp_path):
    import threading

    from satb_omr.render import render_musicxml

    errors = []

    def work(i):
        try:
            render_musicxml(FIX / "hymn_closed.musicxml", tmp_path / f"p{i}.png")
        except Exception as exc:  # noqa: BLE001
            errors.append(exc)

    for i in range(3):
        t = threading.Thread(target=work, args=(i,))
        t.start()
        t.join()
    assert not errors
    assert all((tmp_path / f"p{i}.png").stat().st_size > 0 for i in range(3))


def test_rejects_unknown_file_type(tmp_path):
    bad = tmp_path / "score.docx"
    shutil.copy(FIX / "truth.musicxml", bad)
    with pytest.raises(ValueError):
        convert(bad, tmp_path / "out")
