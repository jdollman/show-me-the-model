"""Tests for multi-method PDF extraction."""

import pytest
from backend.extract_compare import get_available_methods, extract_with_method


def test_available_methods_always_includes_pymupdf():
    methods = get_available_methods()
    names = [m["id"] for m in methods]
    assert "pymupdf" in names
    assert "pymupdf4llm" in names


def test_available_methods_have_required_fields():
    for method in get_available_methods():
        assert "id" in method
        assert "name" in method
        assert "installed" in method
        assert isinstance(method["installed"], bool)


@pytest.mark.asyncio
async def test_extract_pymupdf_basic():
    """Test basic pymupdf extraction with a minimal PDF."""
    import pymupdf
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Hello extraction test")
    pdf_bytes = doc.tobytes()
    doc.close()

    result = await extract_with_method(pdf_bytes, "pymupdf")
    assert "Hello extraction test" in result["text"]
    assert result["char_count"] > 0
    assert result["time_ms"] >= 0


@pytest.mark.asyncio
async def test_extract_pymupdf4llm():
    """Test pymupdf4llm markdown extraction."""
    import pymupdf
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Markdown extraction test")
    pdf_bytes = doc.tobytes()
    doc.close()

    result = await extract_with_method(pdf_bytes, "pymupdf4llm")
    assert "Markdown extraction test" in result["text"]


@pytest.mark.asyncio
async def test_extract_unknown_method():
    with pytest.raises(ValueError, match="Unknown extraction method"):
        await extract_with_method(b"fake", "nonexistent")


@pytest.mark.asyncio
async def test_extract_uninstalled_method():
    """Attempting to use an uninstalled method raises ValueError."""
    methods = get_available_methods()
    uninstalled = [m for m in methods if not m["installed"]]
    if not uninstalled:
        pytest.skip("All methods are installed")
    with pytest.raises(ValueError, match="not installed"):
        await extract_with_method(b"fake", uninstalled[0]["id"])
