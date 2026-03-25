# Extraction Comparison, Copy Summary & Claude Code Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three features to Show Me the Model: (1) multi-method PDF extraction comparison with inline preview, (2) clipboard copy of analysis summaries, (3) routing Anthropic LLM calls through the `claude` CLI to bypass API rate limits.

**Architecture:** Feature 1 adds a new backend endpoint + frontend component for side-by-side extraction comparison. Feature 2 adds a button to the existing ShareBox. Feature 3 adds a `_call_claude_code()` function alongside the existing `_call_claude()` in pipeline.py, toggled by `USE_CLAUDE_CODE` env var. All three features are independent.

**Tech Stack:** Python (FastAPI, pymupdf4llm), React 18, Claude Code CLI (`claude -p`)

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `backend/extract_compare.py` | Multi-method extraction: pymupdf (basic), pymupdf4llm, marker, docling. Graceful fallback when optional deps are missing. |
| `backend/claude_code_runner.py` | Async subprocess wrapper around `claude -p` CLI. Handles model mapping, system prompts, stdin piping, JSON retry. |
| `frontend/src/components/ExtractionPreview.jsx` | Tabbed comparison view showing extracted text from each method, with "Use this → Analyze" per tab. |
| `tests/test_extract_compare.py` | Tests for extraction methods + availability detection. |
| `tests/test_claude_code_runner.py` | Tests for CLI subprocess wrapper (mocked subprocess). |

### Modified Files
| File | Change |
|------|--------|
| `backend/main.py` | Add `POST /extract-preview` endpoint. |
| `backend/pipeline.py` | Import and route to `_call_claude_code()` when `USE_CLAUDE_CODE=1` and provider is anthropic. |
| `frontend/src/api.js` | Add `extractPreview()` function. |
| `frontend/src/components/InputForm.jsx` | Add extraction method checkboxes + preview button in file tab. Render ExtractionPreview inline. |
| `frontend/src/components/ResultsView.jsx` | Add "Copy summary" button to ShareBox component. |
| `requirements.txt` | Add `pymupdf4llm>=1.0.0`. |

---

## Task 1: Backend — Multi-Method Extraction Module

**Files:**
- Create: `backend/extract_compare.py`
- Create: `tests/test_extract_compare.py`
- Modify: `requirements.txt`

- [ ] **Step 1: Install pymupdf4llm and verify API**

```bash
cd ~/life/growth/show-me-the-model && source venv/bin/activate && pip install pymupdf4llm
# Verify the API signature — pymupdf4llm has changed across versions:
python3 -c "import pymupdf4llm; help(pymupdf4llm.to_markdown)"
# Check: does to_markdown() accept a pymupdf.Document, a file path, or both?
# If it only accepts a file path, the _extract_pymupdf4llm function must use a tempfile.
```

- [ ] **Step 2: Add pymupdf4llm to requirements.txt**

Add after the `pymupdf>=1.24.0` line:
```
pymupdf4llm>=1.0.0
```

- [ ] **Step 3: Write tests for extract_compare.py**

Create `tests/test_extract_compare.py`:

```python
"""Tests for multi-method PDF extraction."""

import pytest
from backend.extract_compare import get_available_methods, extract_with_method


def test_available_methods_always_includes_pymupdf():
    methods = get_available_methods()
    names = [m["id"] for m in methods]
    assert "pymupdf" in names
    assert "pymupdf4llm" in names  # installed in step 1


def test_available_methods_have_required_fields():
    for method in get_available_methods():
        assert "id" in method
        assert "name" in method
        assert "installed" in method
        assert isinstance(method["installed"], bool)


@pytest.mark.asyncio
async def test_extract_pymupdf_basic(tmp_path):
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
async def test_extract_pymupdf4llm(tmp_path):
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
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
pytest tests/test_extract_compare.py -v
```
Expected: FAIL (module not found)

- [ ] **Step 5: Implement extract_compare.py**

Create `backend/extract_compare.py`:

```python
"""Multi-method PDF text extraction for comparison."""

import logging
import time

logger = logging.getLogger(__name__)

# Registry of extraction methods. Each entry defines:
#   - id: unique key
#   - name: human-readable label
#   - import_check: module to try importing (None = always available)
#   - description: what makes this method different
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
            f"Install it with: pip install {method['import_check']}"
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
    import pymupdf4llm
    import pymupdf
    import tempfile
    import os

    # pymupdf4llm.to_markdown() may accept a Document or a file path depending
    # on the version. Try Document first, fall back to tempfile.
    doc = pymupdf.open(stream=file_bytes, filetype="pdf")
    try:
        text = pymupdf4llm.to_markdown(doc)
    except TypeError:
        doc.close()
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(file_bytes)
            tmp_path = f.name
        try:
            text = pymupdf4llm.to_markdown(tmp_path)
        finally:
            os.unlink(tmp_path)
    else:
        doc.close()
    if not text or not text.strip():
        raise ValueError("pymupdf4llm: could not extract text")
    return text.strip()


def _extract_marker(file_bytes: bytes) -> str:
    # NOTE: Marker's API has changed across versions. These imports are for
    # marker-pdf v1.x. If they fail, run: pip install marker-pdf
    # then check: python3 -c "import marker; print(dir(marker))"
    from marker.converters.pdf import PdfConverter
    from marker.config.parser import ConfigParser
    import tempfile
    import os

    # Marker requires a file path, not bytes
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
    from docling.document_converter import DocumentConverter
    import tempfile
    import os

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
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pytest tests/test_extract_compare.py -v
```
Expected: PASS (pymupdf and pymupdf4llm tests pass; marker/docling tests may skip if not installed)

- [ ] **Step 7: Commit**

```bash
git add backend/extract_compare.py tests/test_extract_compare.py requirements.txt
git commit -m "feat: add multi-method PDF extraction comparison module"
```

---

## Task 2: Backend — Extract Preview Endpoint

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: Add extract-preview endpoint to main.py**

Add imports at top of `main.py`:
```python
from backend.extract_compare import extract_with_method, get_available_methods
```

Add new routes after the existing `/models` route:

```python
@app.get("/extract-methods")
async def list_extract_methods():
    """Return available PDF extraction methods with install status."""
    return {"methods": get_available_methods()}


@app.post("/extract-preview")
@limiter.limit("10/minute")
async def extract_preview(
    request: Request,
    file: UploadFile = File(...),
):
    """Extract text from a PDF using multiple methods for comparison.

    Accepts multipart form with 'file' and 'methods' (comma-separated method IDs).
    Returns {method_id: {text, char_count, time_ms}} for each requested method.
    """
    form = await request.form()
    methods_raw = form.get("methods", "pymupdf,pymupdf4llm")
    method_ids = [m.strip() for m in methods_raw.split(",") if m.strip()]

    if not method_ids:
        raise HTTPException(status_code=400, detail="No extraction methods specified")
    if len(method_ids) > 4:
        raise HTTPException(status_code=400, detail="Maximum 4 methods per request")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_PDF_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large ({len(file_bytes)} bytes). Maximum is {MAX_PDF_SIZE}.",
        )

    results = {}
    for method_id in method_ids:
        try:
            results[method_id] = await extract_with_method(file_bytes, method_id)
        except ValueError as e:
            results[method_id] = {"error": str(e)}

    return {"results": results}
```

Also import `MAX_PDF_SIZE` from text_extract:
```python
from backend.text_extract import MAX_PDF_SIZE, extract_from_markdown, extract_from_pdf, extract_from_url, validate_text
```

- [ ] **Step 2: Verify endpoint works**

```bash
# With backend running, test with curl
curl -X POST http://localhost:8000/extract-preview \
  -F "file=@/path/to/any/test.pdf" \
  -F "methods=pymupdf,pymupdf4llm"
```

- [ ] **Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat: add /extract-preview and /extract-methods endpoints"
```

---

## Task 3: Frontend — Extraction Comparison UI

**Files:**
- Create: `frontend/src/components/ExtractionPreview.jsx`
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/components/InputForm.jsx`

- [ ] **Step 1: Add API function for extraction preview**

Add to `frontend/src/api.js`:

```javascript
/**
 * Fetch available PDF extraction methods.
 */
export async function fetchExtractMethods() {
  const res = await fetch("/api/extract-methods");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.methods || [];
}

/**
 * Preview PDF text extraction with multiple methods.
 * @param {File} file - The PDF file
 * @param {string[]} methodIds - Extraction method IDs to compare
 * @returns {Promise<Object>} - {results: {method_id: {text, char_count, time_ms}}}
 */
export async function extractPreview(file, methodIds) {
  const body = new FormData();
  body.append("file", file);
  body.append("methods", methodIds.join(","));

  const res = await fetch("/api/extract-preview", { method: "POST", body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 2: Create ExtractionPreview component**

Create `frontend/src/components/ExtractionPreview.jsx`:

```jsx
import { useState } from "react";

const METHOD_LABELS = {
  pymupdf: "PyMuPDF (basic)",
  pymupdf4llm: "PyMuPDF4LLM",
  marker: "Marker",
  docling: "Docling (IBM)",
};

export default function ExtractionPreview({ results, onUseExtraction }) {
  const methodIds = Object.keys(results);
  const [activeTab, setActiveTab] = useState(methodIds[0]);

  if (methodIds.length === 0) return null;

  const inputBase = {
    background: "var(--smtm-bg-input)",
    color: "var(--smtm-text-primary)",
    borderColor: "var(--smtm-border-input)",
  };

  return (
    <div className="mt-4 rounded-lg border" style={{ borderColor: "var(--smtm-border-default)" }}>
      {/* Tabs */}
      <div className="flex border-b" style={{ borderColor: "var(--smtm-border-default)" }}>
        {methodIds.map((id) => {
          const r = results[id];
          const hasError = !!r.error;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className="px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors font-body"
              style={{
                borderColor: activeTab === id ? "var(--smtm-tab-active-border)" : "transparent",
                color: hasError
                  ? "var(--smtm-sev-critical-text)"
                  : activeTab === id
                    ? "var(--smtm-tab-active-text)"
                    : "var(--smtm-tab-inactive-text)",
              }}
            >
              {METHOD_LABELS[id] || id}
              {!hasError && r.time_ms != null && (
                <span className="ml-1.5 text-xs" style={{ color: "var(--smtm-text-muted)" }}>
                  {r.time_ms < 1000 ? `${Math.round(r.time_ms)}ms` : `${(r.time_ms / 1000).toFixed(1)}s`}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active tab content */}
      {methodIds.map((id) => {
        if (id !== activeTab) return null;
        const r = results[id];
        if (r.error) {
          return (
            <div key={id} className="p-4 text-sm" style={{ color: "var(--smtm-sev-critical-text)" }}>
              Error: {r.error}
            </div>
          );
        }
        return (
          <div key={id} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-body" style={{ color: "var(--smtm-text-muted)" }}>
                {r.char_count.toLocaleString()} characters
              </span>
              <button
                type="button"
                onClick={() => onUseExtraction(r.text)}
                className="px-3 py-1.5 rounded-md text-xs font-bold font-body transition-colors cursor-pointer"
                style={{
                  background: "var(--smtm-btn-primary-bg)",
                  color: "var(--smtm-btn-primary-text)",
                }}
              >
                Use this → Analyze
              </button>
            </div>
            <pre
              className="text-xs leading-relaxed overflow-auto max-h-[400px] rounded-md p-3 whitespace-pre-wrap"
              style={inputBase}
            >
              {r.text}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Integrate into InputForm.jsx**

This is the most complex frontend change. The file tab needs:
1. Extraction method checkboxes (fetched from `/extract-methods`)
2. A "Preview Extraction" button
3. Inline ExtractionPreview rendering
4. An `onUseExtraction` callback that switches to the text tab with the chosen extraction pre-filled

**Imports to add at top of InputForm.jsx:**
```javascript
import { fetchExtractMethods, extractPreview } from "../api";
import ExtractionPreview from "./ExtractionPreview";
```

**New state variables** (add after existing `useState` calls):
```javascript
const [extractMethods, setExtractMethods] = useState([]);
const [selectedMethods, setSelectedMethods] = useState(["pymupdf", "pymupdf4llm"]);
const [extracting, setExtracting] = useState(false);
const [extractResults, setExtractResults] = useState(null);
```

**New useEffect** (add after the `fetchModels` effect):
```javascript
useEffect(() => {
  fetchExtractMethods()
    .then((methods) => setExtractMethods(methods))
    .catch(() => {});
}, []);
```

**New handler functions:**
```javascript
const toggleMethod = (id) => {
  setSelectedMethods((prev) =>
    prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
  );
};

const handlePreviewExtraction = async () => {
  if (!file || selectedMethods.length === 0) return;
  setExtracting(true);
  setExtractResults(null);
  try {
    const data = await extractPreview(file, selectedMethods);
    setExtractResults(data.results);
  } catch (err) {
    setExtractResults({ _error: err.message });
  } finally {
    setExtracting(false);
  }
};

const handleUseExtraction = (extractedText) => {
  setText(extractedText);
  setTab("text");
  setFile(null);
  setExtractResults(null);
};
```

**Replace the file tab JSX** (the `{tab === "file" && (...)}` block) with:
```jsx
{tab === "file" && (
  <div>
    <div className="flex items-center gap-3">
      <label
        className="cursor-pointer rounded-md border px-4 py-2 text-sm font-medium font-body"
        style={{
          background: "var(--smtm-btn-secondary-bg)",
          borderColor: "var(--smtm-btn-secondary-border)",
          color: "var(--smtm-btn-secondary-text)",
        }}
      >
        Choose File
        <input
          type="file"
          accept=".pdf,.md,.markdown"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files[0] || null);
            setExtractResults(null);
          }}
        />
      </label>
      <span className="text-sm" style={{ color: "var(--smtm-text-muted)" }}>
        {file ? file.name : "No file selected"}
      </span>
    </div>

    {/* Extraction method checkboxes — only for PDFs */}
    {file && file.name.toLowerCase().endsWith(".pdf") && extractMethods.length > 0 && (
      <div className="mt-3">
        <p className="text-xs font-medium mb-2 font-body" style={{ color: "var(--smtm-text-secondary)" }}>
          Compare extraction methods:
        </p>
        <div className="flex flex-wrap gap-3">
          {extractMethods.map((m) => (
            <label
              key={m.id}
              className="flex items-center gap-1.5 text-xs font-body cursor-pointer"
              style={{ color: m.installed ? "var(--smtm-text-secondary)" : "var(--smtm-text-muted)" }}
              title={m.installed ? m.description : `Not installed: pip install ${m.id}`}
            >
              <input
                type="checkbox"
                checked={selectedMethods.includes(m.id)}
                onChange={() => toggleMethod(m.id)}
                disabled={!m.installed}
              />
              {m.name}
              {!m.installed && <span className="text-[10px]">(not installed)</span>}
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={handlePreviewExtraction}
          disabled={extracting || selectedMethods.length === 0}
          className="mt-2 px-3 py-1.5 rounded-md text-xs font-medium font-body transition-colors cursor-pointer border"
          style={{
            background: "var(--smtm-btn-secondary-bg)",
            borderColor: "var(--smtm-btn-secondary-border)",
            color: "var(--smtm-btn-secondary-text)",
          }}
        >
          {extracting ? "Extracting..." : "Preview Extraction"}
        </button>
      </div>
    )}

    {/* Extraction results */}
    {extractResults && !extractResults._error && (
      <ExtractionPreview results={extractResults} onUseExtraction={handleUseExtraction} />
    )}
    {extractResults?._error && (
      <p className="mt-3 text-sm" style={{ color: "var(--smtm-sev-critical-text)" }}>
        Extraction failed: {extractResults._error}
      </p>
    )}
  </div>
)}
```

- [ ] **Step 4: Verify in browser**

Open http://localhost:5173, upload a PDF, check the extraction method checkboxes appear, click "Preview Extraction", verify tabbed comparison renders, and "Use this → Analyze" switches to text tab with the extraction pre-filled.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ExtractionPreview.jsx frontend/src/api.js frontend/src/components/InputForm.jsx
git commit -m "feat: add extraction comparison UI with multi-method preview"
```

---

## Task 4: Frontend — Copy Summary Button

**Files:**
- Modify: `frontend/src/components/ResultsView.jsx`

- [ ] **Step 1: Add formatSummaryMarkdown utility function**

Add this function above the `ShareBox` component in `ResultsView.jsx` (around line 33):

```javascript
function formatSummaryMarkdown(result, shareUrl) {
  const { synthesis, merged_annotations, metadata } = result;
  const annotations = merged_annotations?.annotations || [];
  const strengths = merged_annotations?.strengths || [];
  const assumptions = synthesis?.key_assumptions || [];

  const lines = [];

  // Title
  const title = metadata?.essay_title || "Untitled";
  const author = metadata?.essay_author ? ` by ${metadata.essay_author}` : "";
  lines.push(`## ${title}${author} — SMTM Analysis\n`);

  // Bottom line
  if (synthesis?.bottom_line) {
    lines.push(`**Bottom Line:** ${synthesis.bottom_line}\n`);
  }

  // Critical issues
  const critical = annotations.filter((a) => a.severity === "Critical");
  if (critical.length > 0) {
    lines.push("**Critical Issues:**");
    critical.forEach((a) => {
      const detail = a.dominant_issue || (a.explanation ? a.explanation.slice(0, 120) + "..." : "");
      lines.push(`- **${a.title}**${detail ? ` — ${detail}` : ""}`);
    });
    lines.push("");
  }

  // Key assumptions (unstated/weak only)
  const flagged = assumptions.filter(
    (a) => a.stated_or_unstated === "Unstated" || a.strength === "Weak"
  );
  if (flagged.length > 0) {
    lines.push("**Key Assumptions Challenged:**");
    flagged.slice(0, 5).forEach((a) => {
      const tag = [a.stated_or_unstated, a.strength].filter(Boolean).join(", ");
      lines.push(`- ${a.assumption} (${tag})`);
    });
    lines.push("");
  }

  // Strengths
  if (strengths.length > 0) {
    lines.push("**What It Gets Right:**");
    strengths.forEach((s) => lines.push(`- ${s.title}`));
    lines.push("");
  }

  // Link
  if (shareUrl) {
    lines.push(`[Full analysis](${shareUrl})`);
  }

  return lines.join("\n");
}
```

- [ ] **Step 2: Add "Copy summary" button to ShareBox**

Modify the `ShareBox` component to accept `result` as a prop and add a third button. Change the component signature and add the button after "Copy link":

```jsx
function ShareBox({ analysisId, result }) {
  const [copied, setCopied] = useState(null);
  const shareUrl = `${window.location.origin}/#/results/${analysisId}`;

  const copy = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  return (
    <div
      className="rounded-lg px-4 py-3 flex flex-wrap items-center gap-3 text-sm"
      style={{ background: "var(--smtm-share-bg)" }}
    >
      <span className="text-xs font-medium shrink-0" style={{ color: "var(--smtm-share-label)" }}>
        Share this analysis
      </span>
      <button
        onClick={() => copy(analysisId, "id")}
        className="px-2.5 py-1 rounded font-mono text-xs transition-colors cursor-pointer"
        style={{
          background: "var(--smtm-share-id-bg)",
          color: "var(--smtm-share-id-text)",
        }}
        title="Copy analysis ID"
      >
        {copied === "id" ? "Copied!" : analysisId}
      </button>
      <button
        onClick={() => copy(shareUrl, "link")}
        className="px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
        style={{
          background: "var(--smtm-btn-primary-bg)",
          color: "var(--smtm-btn-primary-text)",
        }}
      >
        {copied === "link" ? "Copied!" : "Copy link"}
      </button>
      {result && (
        <button
          onClick={() => copy(formatSummaryMarkdown(result, shareUrl), "summary")}
          className="px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
          style={{
            background: "var(--smtm-btn-secondary-bg)",
            color: "var(--smtm-btn-secondary-text)",
            border: "1px solid var(--smtm-btn-secondary-border)",
          }}
        >
          {copied === "summary" ? "Copied!" : "Copy summary"}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Pass result prop to ShareBox**

Find the ShareBox usage in the ResultsView component (around line 197) and add the `result` prop:

```jsx
<ShareBox analysisId={analysisId} result={result} />
```

- [ ] **Step 4: Verify in browser**

Navigate to an existing analysis result, click "Copy summary", paste into a text editor, verify the markdown includes title, bottom line, critical issues, assumptions, and strengths.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ResultsView.jsx
git commit -m "feat: add 'Copy summary' button to ShareBox for markdown export"
```

---

## Task 5: Backend — Claude Code CLI Runner

**Files:**
- Create: `backend/claude_code_runner.py`
- Create: `tests/test_claude_code_runner.py`

- [ ] **Step 1: Write tests for claude_code_runner.py**

Create `tests/test_claude_code_runner.py`:

```python
"""Tests for Claude Code CLI subprocess wrapper."""

import json
from unittest.mock import AsyncMock, patch

import pytest

from backend.claude_code_runner import (
    CLAUDE_CODE_MODELS,
    _get_cli_model_name,
    _call_claude_code,
    is_claude_code_enabled,
)


def test_model_mapping():
    assert _get_cli_model_name("claude-sonnet-4-6") == "sonnet"
    assert _get_cli_model_name("claude-opus-4-6") == "opus"


def test_model_mapping_unknown_raises():
    with pytest.raises(ValueError, match="No Claude Code mapping"):
        _get_cli_model_name("gpt-5-mini")


def test_is_enabled_default():
    """Claude Code mode is off by default."""
    with patch.dict("os.environ", {}, clear=True):
        assert not is_claude_code_enabled()


def test_is_enabled_with_env():
    with patch.dict("os.environ", {"USE_CLAUDE_CODE": "1"}):
        assert is_claude_code_enabled()


@pytest.mark.asyncio
async def test_call_claude_code_success():
    """Test successful CLI call returns text and synthetic usage."""
    mock_result = AsyncMock()
    mock_result.returncode = 0
    mock_result.stdout = b'{"thesis": "test"}'
    mock_result.stderr = b""

    with patch("asyncio.create_subprocess_exec", return_value=mock_result) as mock_exec:
        mock_result.communicate = AsyncMock(return_value=(mock_result.stdout, mock_result.stderr))

        text, usage = await _call_claude_code(
            model="claude-sonnet-4-6",
            system_prompt="You are an economist.",
            user_prompt="Analyze this.",
            temperature=0.2,
            max_tokens=4096,
        )

        assert text == '{"thesis": "test"}'
        assert usage["model"] == "claude-sonnet-4-6"
        # Verify claude was called with correct args
        call_args = mock_exec.call_args
        assert "claude" in call_args[0]
        assert "--model" in call_args[0]
        assert "sonnet" in call_args[0]


@pytest.mark.asyncio
async def test_call_claude_code_failure():
    """Test CLI failure raises RuntimeError."""
    mock_result = AsyncMock()
    mock_result.returncode = 1
    mock_result.stdout = b""
    mock_result.stderr = b"Error: model not available"
    mock_result.communicate = AsyncMock(return_value=(mock_result.stdout, mock_result.stderr))

    with patch("asyncio.create_subprocess_exec", return_value=mock_result):
        with pytest.raises(RuntimeError, match="Claude Code CLI failed"):
            await _call_claude_code(
                model="claude-sonnet-4-6",
                system_prompt="test",
                user_prompt="test",
                temperature=0.2,
                max_tokens=4096,
            )
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest tests/test_claude_code_runner.py -v
```
Expected: FAIL (module not found)

- [ ] **Step 3: Implement claude_code_runner.py**

Create `backend/claude_code_runner.py`:

```python
"""Route Anthropic LLM calls through the Claude Code CLI.

When USE_CLAUDE_CODE=1, Anthropic model calls use `claude -p` instead of the
Anthropic SDK. This avoids API rate limits by going through Claude Code's
own authentication and billing.

Usage in pipeline.py:
    if is_claude_code_enabled() and provider == "anthropic":
        return await _call_claude_code(model, system, user, temp, max_tok)
"""

import asyncio
import json
import logging
import os

logger = logging.getLogger(__name__)

# Map full model IDs to claude CLI short names
CLAUDE_CODE_MODELS = {
    "claude-sonnet-4-6": "sonnet",
    "claude-opus-4-6": "opus",
    "claude-haiku-4-5-20251001": "haiku",
}

_DEFAULT_RETRIES = 2


def is_claude_code_enabled() -> bool:
    return os.getenv("USE_CLAUDE_CODE", "").strip() in ("1", "true", "yes")


def _get_cli_model_name(model: str) -> str:
    if model not in CLAUDE_CODE_MODELS:
        raise ValueError(
            f"No Claude Code mapping for model '{model}'. "
            f"Available: {list(CLAUDE_CODE_MODELS.keys())}"
        )
    return CLAUDE_CODE_MODELS[model]


async def _call_claude_code(
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
    retries: int = _DEFAULT_RETRIES,
) -> tuple[str, dict]:
    """Make an LLM call via the claude CLI subprocess.

    Returns (text, usage_record). Usage is estimated since the CLI
    doesn't report token counts directly.

    NOTE: The `temperature` and `max_tokens` params are accepted for API
    compatibility but the claude CLI does not expose these flags. All calls
    use the CLI's defaults. This means results may differ slightly from
    direct API calls, especially for stages with temperature=0.
    """
    cli_model = _get_cli_model_name(model)

    previous_text = ""
    for attempt in range(retries + 1):
        if attempt > 0:
            # CLI has no conversation memory, so include the failed output
            # for context so the model can fix its own JSON
            prompt = (
                f"{user_prompt}\n\n"
                f"Your previous response was:\n{previous_text}\n\n"
                "IMPORTANT: The above contained invalid JSON. "
                "Return the complete response as valid JSON. Ensure all strings "
                "are properly escaped. Return only JSON, no other text."
            )
        else:
            prompt = user_prompt

        logger.info(
            "Claude Code CLI call: model=%s (attempt %d/%d)",
            cli_model, attempt + 1, retries + 1,
        )

        proc = await asyncio.create_subprocess_exec(
            "claude", "-p",
            "--model", cli_model,
            "--system-prompt", system_prompt,
            "--output-format", "text",
            "--bare",
            "--tools", "",
            "--permission-mode", "bypassPermissions",
            "--no-session-persistence",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate(input=prompt.encode("utf-8"))

        if proc.returncode != 0:
            err_msg = stderr.decode("utf-8", errors="replace").strip()
            logger.error("Claude Code CLI failed (rc=%d): %s", proc.returncode, err_msg)
            raise RuntimeError(f"Claude Code CLI failed (rc={proc.returncode}): {err_msg}")

        text = stdout.decode("utf-8").strip()
        previous_text = text  # Save for retry context

        if not text:
            if attempt < retries:
                logger.warning("Empty response from CLI, retrying...")
                continue
            raise RuntimeError("Claude Code CLI returned empty response")

        # Try parsing JSON — if it works, return immediately
        try:
            json.loads(text.strip().removeprefix("```json").removeprefix("```").removesuffix("```"))
            break  # Valid JSON, exit retry loop
        except (json.JSONDecodeError, ValueError):
            if attempt < retries:
                logger.warning("JSON parse failed (attempt %d/%d), retrying...", attempt + 1, retries + 1)
            else:
                break  # Return as-is on last attempt, let pipeline's _extract_json handle it

    # Estimate token usage (rough: 1 token ≈ 4 chars, actual ~3.5 for English).
    # Cost estimates will be ~15-30% off. For exact counts, could parse
    # --output-format json which includes usage info.
    est_input = len(system_prompt + user_prompt) // 4
    est_output = len(text) // 4
    usage = {
        "model": model,
        "input_tokens": est_input,
        "output_tokens": est_output,
    }

    return text, usage
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_claude_code_runner.py -v
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/claude_code_runner.py tests/test_claude_code_runner.py
git commit -m "feat: add Claude Code CLI subprocess wrapper for rate-limit-free Anthropic calls"
```

---

## Task 6: Backend — Route Anthropic Calls Through Claude Code

**Files:**
- Modify: `backend/pipeline.py`

- [ ] **Step 1: Add Claude Code routing to _call_model()**

Add import at top of `pipeline.py`:
```python
from backend.claude_code_runner import _call_claude_code, is_claude_code_enabled
```

Replace the `_call_model` function (lines 186–204) with:

```python
async def _call_model(
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
    retries: int = _DEFAULT_RETRIES,
) -> tuple[str, dict]:
    """Route model calls to the right provider. Returns (text, usage_record)."""
    provider = MODEL_REGISTRY[model]["provider"]
    if provider == "anthropic" and is_claude_code_enabled():
        logger.info("Routing %s through Claude Code CLI", model)
        return await _call_claude_code(
            model, system_prompt, user_prompt, temperature, max_tokens, retries
        )
    elif provider == "anthropic":
        return await _call_claude(
            model, system_prompt, user_prompt, temperature, max_tokens, retries
        )
    else:
        return await _call_openai(
            model, system_prompt, user_prompt, temperature, max_tokens, retries
        )
```

- [ ] **Step 2: Test with USE_CLAUDE_CODE=1**

```bash
# Stop the running backend, restart with the flag
USE_CLAUDE_CODE=1 uvicorn backend.main:app --reload --port 8000
```

Submit a short test text through the web UI with Sonnet selected. Check backend logs for "Routing claude-sonnet-4-6 through Claude Code CLI".

- [ ] **Step 3: Commit**

```bash
git add backend/pipeline.py
git commit -m "feat: route Anthropic calls through Claude Code CLI when USE_CLAUDE_CODE=1"
```

---

## Task 7: Integration Verification

- [ ] **Step 1: Run full test suite**

```bash
cd ~/life/growth/show-me-the-model && source venv/bin/activate
pytest tests/ -v
```

- [ ] **Step 2: Verify all three features end-to-end**

1. **Extraction comparison:** Upload a PDF → check extraction method checkboxes → "Preview Extraction" → compare tabs → "Use this → Analyze"
2. **Copy summary:** View a completed analysis → click "Copy summary" → paste to verify markdown
3. **Claude Code routing:** Restart backend with `USE_CLAUDE_CODE=1` → submit a short analysis with Anthropic models → verify it completes without API rate limit errors

- [ ] **Step 3: Final push**

```bash
git status  # verify all changes are committed
git push
```
