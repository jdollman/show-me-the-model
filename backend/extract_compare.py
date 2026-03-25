"""Multi-method PDF text extraction for comparison."""

import logging
import time

logger = logging.getLogger(__name__)

METHODS = [
    {
        "id": "pymupdf",
        "name": "PyMuPDF (basic)",
        "import_check": "pymupdf",
        "description": "Fast, basic text extraction. No structure preservation.",
    },
    {
        "id": "pymupdf4llm",
        "name": "PyMuPDF4LLM",
        "import_check": "pymupdf4llm",
        "description": "Markdown output with headings, tables, bold/italic. Fast, CPU-only.",
    },
    {
        "id": "marker",
        "name": "Marker",
        "import_check": "marker",
        "description": "High-quality conversion with OCR. Handles equations, complex layouts. Slower.",
    },
    {
        "id": "docling",
        "name": "Docling (IBM)",
        "import_check": "docling.document_converter",
        "description": "Best-in-class table extraction (97.9%). Handles charts, forms, code.",
    },
]


def _is_installed(import_check: str | None) -> bool:
    if import_check is None:
        return True
    try:
        __import__(import_check)
        return True
    except ImportError:
        return False


def get_available_methods() -> list[dict]:
    """Return list of extraction methods with installation status."""
    return [
        {
            "id": m["id"],
            "name": m["name"],
            "description": m["description"],
            "installed": _is_installed(m["import_check"]),
        }
        for m in METHODS
    ]


async def extract_with_method(file_bytes: bytes, method_id: str) -> dict:
    """Extract text from PDF bytes using the specified method.

    Returns: {"text": str, "char_count": int, "time_ms": float}
    """
    method = next((m for m in METHODS if m["id"] == method_id), None)
    if not method:
        raise ValueError(f"Unknown extraction method: {method_id}")
    if not _is_installed(method["import_check"]):
        raise ValueError(
            f"Extraction method '{method_id}' is not installed. "
            f"Install it with: pip install {method['id']}"
        )

    start = time.monotonic()

    if method_id == "pymupdf":
        text = _extract_pymupdf(file_bytes)
    elif method_id == "pymupdf4llm":
        text = _extract_pymupdf4llm(file_bytes)
    elif method_id == "marker":
        text = _extract_marker(file_bytes)
    elif method_id == "docling":
        text = _extract_docling(file_bytes)
    else:
        raise ValueError(f"No extractor implemented for: {method_id}")

    elapsed_ms = (time.monotonic() - start) * 1000
    return {"text": text, "char_count": len(text), "time_ms": round(elapsed_ms, 1)}


def _extract_pymupdf(file_bytes: bytes) -> str:
    import pymupdf

    doc = pymupdf.open(stream=file_bytes, filetype="pdf")
    pages = [page.get_text() for page in doc]
    doc.close()
    text = "\n".join(pages).strip()
    if not text:
        raise ValueError("Could not extract text from PDF (empty or image-only)")
    return text


def _extract_pymupdf4llm(file_bytes: bytes) -> str:
    import pymupdf
    import pymupdf4llm

    doc = pymupdf.open(stream=file_bytes, filetype="pdf")
    try:
        text = pymupdf4llm.to_markdown(doc)
    finally:
        doc.close()
    if not text or not text.strip():
        raise ValueError("pymupdf4llm: could not extract text")
    return text.strip()


def _extract_marker(file_bytes: bytes) -> str:
    # NOTE: Marker's API has changed across versions. These imports are for
    # marker-pdf v1.x. If they fail, check: python3 -c "import marker; print(dir(marker))"
    import os
    import tempfile

    from marker.config.parser import ConfigParser
    from marker.converters.pdf import PdfConverter

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(file_bytes)
        tmp_path = f.name
    try:
        config = ConfigParser({})
        converter = PdfConverter(config=config)
        result = converter(tmp_path)
        text = result.markdown
    finally:
        os.unlink(tmp_path)
    if not text or not text.strip():
        raise ValueError("marker: could not extract text")
    return text.strip()


def _extract_docling(file_bytes: bytes) -> str:
    import os
    import tempfile

    from docling.document_converter import DocumentConverter

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(file_bytes)
        tmp_path = f.name
    try:
        converter = DocumentConverter()
        result = converter.convert(tmp_path)
        text = result.document.export_to_markdown()
    finally:
        os.unlink(tmp_path)
    if not text or not text.strip():
        raise ValueError("docling: could not extract text")
    return text.strip()
