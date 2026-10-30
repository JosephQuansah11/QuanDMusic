"""Turn an input file (PDF, image, MusicXML) into page images or a parsed score."""

from __future__ import annotations

from pathlib import Path

import cv2

PDF_EXT = {".pdf"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}
MUSICXML_EXT = {".musicxml", ".mxl", ".xml"}


def input_kind(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in PDF_EXT:
        return "pdf"
    if ext in IMAGE_EXT:
        return "image"
    if ext in MUSICXML_EXT:
        return "musicxml"
    raise ValueError(f"Unsupported input type: {path.suffix}")


def pdf_to_images(pdf: Path, out_dir: Path, dpi: int = 300) -> list[Path]:
    import pymupdf as fitz

    out_dir.mkdir(parents=True, exist_ok=True)
    pages = []
    with fitz.open(pdf) as doc:
        for i, page in enumerate(doc, start=1):
            pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY, alpha=False)
            dst = out_dir / f"page-{i:03d}.png"
            pix.save(dst)
            pages.append(dst)
    return pages


def image_pages(img: Path, out_dir: Path) -> list[Path]:
    """Split multi-page TIFFs; other images are a single page."""
    out_dir.mkdir(parents=True, exist_ok=True)
    if img.suffix.lower() in (".tif", ".tiff"):
        ok, frames = cv2.imreadmulti(str(img), flags=cv2.IMREAD_GRAYSCALE)
        if ok and len(frames) > 1:
            pages = []
            for i, frame in enumerate(frames, start=1):
                dst = out_dir / f"page-{i:03d}.png"
                cv2.imwrite(str(dst), frame)
                pages.append(dst)
            return pages
    gray = cv2.imread(str(img), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise ValueError(f"Cannot read image {img}")
    dst = out_dir / "page-001.png"
    cv2.imwrite(str(dst), gray)
    return [dst]


def load_pages(path: Path, out_dir: Path, dpi: int = 300) -> list[Path]:
    kind = input_kind(path)
    if kind == "pdf":
        return pdf_to_images(path, out_dir, dpi)
    if kind == "image":
        return image_pages(path, out_dir)
    raise ValueError("MusicXML input has no pages")
