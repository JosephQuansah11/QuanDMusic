"""Optical music recognition backends producing MusicXML from a page image."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


class EngineError(RuntimeError):
    pass


class OMREngine:
    name = "base"

    def available(self) -> bool:
        raise NotImplementedError

    def recognize(self, image: Path, workdir: Path) -> list[Path]:
        """Return MusicXML file(s) for ``image`` (one per detected movement)."""
        raise NotImplementedError


def _run(cmd: list[str], timeout: int, env: dict | None = None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env, check=False)
    except subprocess.TimeoutExpired as exc:
        raise EngineError(f"{cmd[0]} timed out after {timeout}s") from exc
    except OSError as exc:
        raise EngineError(f"cannot run {cmd[0]}: {exc}") from exc


def _clear_outputs(workdir: Path, stem: str) -> None:
    """Remove results of earlier runs so a failed run is never mistaken for success."""
    for old in [*workdir.glob(f"{stem}*.mxl"), *workdir.glob(f"{stem}*.musicxml")]:
        old.unlink()


class AudiverisEngine(OMREngine):
    """Audiveris (https://github.com/Audiveris/audiveris), run in batch mode."""

    name = "audiveris"
    CANDIDATES = ("audiveris", "Audiveris", "/opt/audiveris/bin/Audiveris")

    def __init__(self, binary: str | None = None, timeout: int = 900):
        self.binary = binary or os.environ.get("AUDIVERIS_BIN") or self._find()
        self.timeout = timeout

    def _find(self) -> str | None:
        for c in self.CANDIDATES:
            found = shutil.which(c) or (c if os.path.isfile(c) and os.access(c, os.X_OK) else None)
            if found:
                return found
        return None

    def available(self) -> bool:
        return self.binary is not None

    def recognize(self, image: Path, workdir: Path) -> list[Path]:
        if not self.binary:
            raise EngineError("Audiveris not found (set AUDIVERIS_BIN)")
        workdir.mkdir(parents=True, exist_ok=True)
        _clear_outputs(workdir, image.stem)
        env = dict(os.environ)
        if not env.get("DISPLAY"):
            env["JAVA_TOOL_OPTIONS"] = (env.get("JAVA_TOOL_OPTIONS", "") + " -Djava.awt.headless=true").strip()
        cmd = [self.binary, "-batch", "-export", "-output", str(workdir), "--", str(image)]
        proc = _run(cmd, self.timeout, env)
        outputs = sorted(workdir.glob(f"{image.stem}*.mxl")) + sorted(workdir.glob(f"{image.stem}*.musicxml"))
        if not outputs:
            tail = "\n".join((proc.stdout + proc.stderr).strip().splitlines()[-15:])
            raise EngineError(f"Audiveris produced no MusicXML for {image.name}:\n{tail}")
        return outputs


class OemerEngine(OMREngine):
    """oemer (https://github.com/BreezeWhite/oemer), deep-learning end-to-end OMR."""

    name = "oemer"

    def __init__(self, timeout: int = 1800):
        self.timeout = timeout

    def available(self) -> bool:
        try:
            import oemer  # noqa: F401
        except ImportError:
            return False
        return True

    def recognize(self, image: Path, workdir: Path) -> list[Path]:
        workdir.mkdir(parents=True, exist_ok=True)
        _clear_outputs(workdir, image.stem)
        cmd = [sys.executable, "-m", "oemer.ete", "-o", str(workdir), str(image)]
        proc = _run(cmd, self.timeout)
        out = workdir / f"{image.stem}.musicxml"
        if not out.exists():
            tail = "\n".join((proc.stdout + proc.stderr).strip().splitlines()[-15:])
            raise EngineError(f"oemer produced no MusicXML for {image.name}:\n{tail}")
        return [out]


ENGINES = {"audiveris": AudiverisEngine, "oemer": OemerEngine}


def engine_chain(name: str = "auto") -> list[OMREngine]:
    """Engines to try in order. ``auto`` = Audiveris first, oemer as fallback."""
    if name == "auto":
        chain = [e() for e in ENGINES.values()]
        chain = [e for e in chain if e.available()]
        if not chain:
            raise EngineError("No OMR engine available: install Audiveris or `pip install oemer`")
        return chain
    if name not in ENGINES:
        raise EngineError(f"Unknown engine {name!r}; choose from {', '.join(ENGINES)} or auto")
    eng = ENGINES[name]()
    if not eng.available():
        raise EngineError(f"Engine {name} is not installed")
    return [eng]
