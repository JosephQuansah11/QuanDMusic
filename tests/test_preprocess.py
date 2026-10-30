from pathlib import Path

import cv2
import pytest

from satb_omr.preprocess import estimate_skew, estimate_staff_metrics, preprocess_image, rotate

FIX = Path(__file__).parent / "fixtures"


def test_staff_metrics_on_rendered_score():
    gray = cv2.imread(str(FIX / "open.png"), cv2.IMREAD_GRAYSCALE)
    interline, thickness = estimate_staff_metrics(gray)
    assert interline is not None and 20 <= interline <= 40
    assert thickness is not None and thickness < interline / 3


@pytest.mark.parametrize("angle", [-2.0, 1.5])
def test_deskew_recovers_rotation(angle, tmp_path):
    gray = cv2.imread(str(FIX / "open.png"), cv2.IMREAD_GRAYSCALE)
    skewed = rotate(gray, angle)
    assert abs(estimate_skew(skewed) + angle) < 0.3
    src = tmp_path / "skewed.png"
    cv2.imwrite(str(src), skewed)
    info = preprocess_image(src, tmp_path / "clean.png")
    assert abs(info.skew_degrees + angle) < 0.3
    assert abs(estimate_skew(cv2.imread(str(tmp_path / "clean.png"), cv2.IMREAD_GRAYSCALE))) < 0.3


def test_small_scan_is_upscaled(tmp_path):
    gray = cv2.imread(str(FIX / "open.png"), cv2.IMREAD_GRAYSCALE)
    small = cv2.resize(gray, None, fx=0.35, fy=0.35, interpolation=cv2.INTER_AREA)
    src = tmp_path / "small.png"
    cv2.imwrite(str(src), small)
    info = preprocess_image(src, tmp_path / "clean.png")
    assert info.scale > 1.5
