"""Image clean-up before OMR: background flattening, deskew and rescaling."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

TARGET_INTERLINE = 20.0


@dataclass
class PreprocessInfo:
    interline: float | None
    line_thickness: float | None
    skew_degrees: float
    scale: float
    flattened: bool


def _binary(gray: np.ndarray) -> np.ndarray:
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return bw


def estimate_staff_metrics(gray: np.ndarray) -> tuple[float | None, float | None]:
    """Return (interline, line thickness) in pixels from vertical run lengths."""
    bw = _binary(gray) > 0
    _, w = bw.shape
    black_runs: list[int] = []
    combo_runs: list[int] = []
    for x in range(0, w, max(1, w // 200)):
        col = bw[:, x].astype(np.int8)
        edges = np.flatnonzero(np.diff(np.concatenate(([0], col, [0]))))
        starts, ends = edges[0::2], edges[1::2]
        if len(starts) < 2:
            continue
        lengths = ends - starts
        black_runs.extend(lengths.tolist())
        combo_runs.extend((starts[1:] - starts[:-1]).tolist())
    if not black_runs or not combo_runs:
        return None, None
    thickness = float(np.bincount(black_runs).argmax())
    combo = np.bincount(combo_runs)
    combo[: int(thickness) + 3] = 0
    interline = float(combo.argmax()) if combo.any() else None
    return interline, thickness


def estimate_skew(gray: np.ndarray) -> float:
    """Skew angle in degrees, from long near-horizontal lines (staff lines)."""
    bw = _binary(gray)
    _, w = bw.shape
    lines = cv2.HoughLinesP(bw, 1, np.pi / 1800, threshold=200, minLineLength=w // 4, maxLineGap=10)
    if lines is None:
        return 0.0
    angles = []
    for x1, y1, x2, y2 in lines.reshape(-1, 4):
        a = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        if abs(a) < 10:
            angles.append(a)
    return float(np.median(angles)) if angles else 0.0


def rotate(gray: np.ndarray, degrees: float) -> np.ndarray:
    h, w = gray.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), degrees, 1.0)
    return cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_CUBIC, borderValue=255)


def flatten_background(gray: np.ndarray) -> tuple[np.ndarray, bool]:
    """Remove uneven lighting (phone photos). No-op for clean scans."""
    k = max(15, (min(gray.shape) // 40) | 1)
    bg = cv2.medianBlur(cv2.dilate(gray, np.ones((7, 7), np.uint8)), k)
    if float(bg.std()) < 8.0:
        return gray, False
    diff = 255 - cv2.absdiff(gray, bg)
    norm = cv2.normalize(diff, None, 0, 255, cv2.NORM_MINMAX)
    return norm, True


def preprocess_image(src: Path, dst: Path, target_interline: float = TARGET_INTERLINE) -> PreprocessInfo:
    gray = cv2.imread(str(src), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise ValueError(f"Cannot read image {src}")
    gray, flattened = flatten_background(gray)
    skew = estimate_skew(gray)
    if abs(skew) > 0.1:
        gray = rotate(gray, skew)
    interline, thickness = estimate_staff_metrics(gray)
    scale = 1.0
    if interline and (interline < 0.75 * target_interline or interline > 2.0 * target_interline):
        scale = target_interline / interline
        interp = cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=interp)
    dst.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dst), gray)
    return PreprocessInfo(interline, thickness, skew, scale, flattened)
