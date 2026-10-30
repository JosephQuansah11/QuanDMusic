"""Render MusicXML to PNG/PDF with Verovio (used for previews and synthetic test data)."""

from __future__ import annotations

from pathlib import Path


def render_musicxml(
    xml_path: Path,
    png_path: Path,
    pdf_path: Path | None = None,
    dpi: int = 300,
    page: int = 1,
) -> Path:
    import cairosvg
    import verovio

    tk = verovio.toolkit()
    tk.setOptions(
        {
            "pageWidth": 2100,
            "pageHeight": 2970,
            "scale": 50,
            "adjustPageHeight": True,
            "breaks": "auto",
            "footer": "none",
            "header": "none",
            "minLastJustification": 0.0,
        }
    )
    if not tk.loadFile(str(xml_path)):
        raise ValueError(f"Verovio could not load {xml_path}")
    svg = tk.renderToSVG(page)
    cairosvg.svg2png(bytestring=svg.encode(), write_to=str(png_path), scale=dpi / 100, background_color="white")
    if pdf_path is not None:
        cairosvg.svg2pdf(bytestring=svg.encode(), write_to=str(pdf_path), dpi=dpi)
    return png_path
