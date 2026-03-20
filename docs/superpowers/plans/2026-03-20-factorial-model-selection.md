# Factorial Model Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-provider dropdown with factorial model selection (workhorse + synthesis), parallel runs, trajectory saving, and re-synthesis from checkpoints.

**Architecture:** Model name becomes the primitive instead of provider. A model registry maps names to providers/SDKs. The pipeline creates clients lazily from env vars. Trajectories save per-stage outputs for reuse. The frontend gets two model dropdowns, multi-job progress tracking, and a version navigator for comparing parallel runs.

**Tech Stack:** FastAPI (Python), React 18, Vite, AsyncAnthropic/AsyncOpenAI SDKs, SSE streaming, pytest

**Spec:** `docs/superpowers/specs/2026-03-20-factorial-model-selection-design.md`

---

## File Map

### Backend — Modified
| File | Responsibility |
|------|---------------|
| `backend/pipeline.py` (621 lines) | Model registry, client cache, dispatch refactor, pipeline signature change |
| `backend/main.py` (346 lines) | API endpoints refactor, trajectory save/load, parallel job spawning |
| `backend/jobs.py` (102 lines) | Job dataclass extensions, group support |

### Backend — Created
| File | Responsibility |
|------|---------------|
| `backend/models.py` | `MODEL_REGISTRY` dict, `_get_client()` cache, `get_model_label()` helper, `_PROVIDER_ENV_KEYS` and `_PROVIDER_DEFAULTS` |
| `backend/trajectories.py` | Trajectory save/load/list functions, directory management |
| `tests/test_models.py` | Tests for model registry, client dispatch, label generation |
| `tests/test_trajectories.py` | Tests for trajectory save/load/list, error cases |

### Frontend — Modified
| File | Responsibility |
|------|---------------|
| `frontend/src/api.js` (104 lines) | New API functions, remove API key header |
| `frontend/src/hooks/useApiSettings.js` (21 lines) | Manage configurations array |
| `frontend/src/hooks/useJobStream.js` (89 lines) | Multi-job SSE streaming |
| `frontend/src/hooks/useResultRouting.js` (78 lines) | Group/version loading |
| `frontend/src/components/InputForm.jsx` (221 lines) | Two model dropdowns, add/remove config rows |
| `frontend/src/components/ProgressTracker.jsx` (155 lines) | Multi-pipeline progress |
| `frontend/src/components/ResultsView.jsx` (556 lines) | Version navigator, re-synthesize button |
| `frontend/src/App.jsx` (56 lines) | Pass group data through state machine |

### Config — Modified
| File | Change |
|------|--------|
| `.gitignore` | Add `trajectories/` |

### Design Decision: Extract `backend/models.py`

The spec says all changes go in `pipeline.py`, but the model registry + client cache + label helpers are a self-contained unit (~80 lines) that both `pipeline.py` and `main.py` need. Extracting to `backend/models.py` keeps `pipeline.py` focused on the analysis pipeline and avoids circular imports.

---

## Task 1: Model Registry + Client Cache

**Files:**
- Create: `backend/models.py`
- Create: `tests/test_models.py`
- Modify: `.gitignore`

This is the foundation everything else builds on. No existing code changes yet — just the new module.

- [ ] **Step 1: Create `backend/models.py` with the registry and client cache**

```python
"""Model registry and client cache for multi-provider LLM dispatch."""

import os
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI

MODEL_REGISTRY = {
    # Anthropic
    "claude-sonnet-4-6":       {"provider": "anthropic", "tier": "workhorse", "short_name": "Sonnet",        "pricing": {"input": 3.00e-6,  "output": 15.00e-6}},
    "claude-opus-4-6":         {"provider": "anthropic", "tier": "synthesis", "short_name": "Opus",          "pricing": {"input": 15.00e-6, "output": 75.00e-6}},
    # OpenAI
    "gpt-5-mini":              {"provider": "openai",    "tier": "workhorse", "short_name": "GPT-5 mini",    "pricing": {"input": 1.50e-6,  "output": 6.00e-6},  "no_temperature": True},
    "gpt-5.4":                 {"provider": "openai",    "tier": "synthesis", "short_name": "GPT-5.4",       "pricing": {"input": 10.00e-6, "output": 30.00e-6}},
    # xAI — reasoning variants (chain-of-thought is internal; content field is the final answer)
    "grok-4-1-fast-reasoning": {"provider": "xai",       "tier": "workhorse", "short_name": "Grok 4.1 Fast", "pricing": {"input": 0.20e-6,  "output": 0.50e-6}},
    "grok-4.20-0309-reasoning":{"provider": "xai",       "tier": "synthesis", "short_name": "Grok 4.20",     "pricing": {"input": 2.00e-6,  "output": 6.00e-6}},
}

_PROVIDER_ENV_KEYS = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "xai": "XAI_API_KEY",
}

_PROVIDER_DEFAULTS = {
    "anthropic": {"workhorse": "claude-sonnet-4-6",       "synthesis": "claude-opus-4-6"},
    "openai":    {"workhorse": "gpt-5-mini",              "synthesis": "gpt-5.4"},
    "xai":       {"workhorse": "grok-4-1-fast-reasoning", "synthesis": "grok-4.20-0309-reasoning"},
}

# Lazy client cache — one client per provider, created on first use
_clients: dict[str, AsyncAnthropic | AsyncOpenAI] = {}


def _get_client(provider: str) -> AsyncAnthropic | AsyncOpenAI:
    """Get or create a cached async client for the given provider."""
    if provider not in _clients:
        env_key = _PROVIDER_ENV_KEYS[provider]
        api_key = os.getenv(env_key)
        if not api_key:
            raise ValueError(f"No API key for provider '{provider}' (set {env_key})")
        if provider == "anthropic":
            _clients[provider] = AsyncAnthropic(api_key=api_key)
        elif provider == "openai":
            _clients[provider] = AsyncOpenAI(api_key=api_key)
        elif provider == "xai":
            _clients[provider] = AsyncOpenAI(api_key=api_key, base_url="https://api.x.ai/v1")
        else:
            raise ValueError(f"Unknown provider: {provider}")
    return _clients[provider]


def get_client_for_model(model: str) -> tuple[AsyncAnthropic | AsyncOpenAI, str]:
    """Look up a model in the registry and return (client, provider)."""
    if model not in MODEL_REGISTRY:
        raise ValueError(f"Unknown model: {model}. Available: {list(MODEL_REGISTRY.keys())}")
    provider = MODEL_REGISTRY[model]["provider"]
    return _get_client(provider), provider


def get_model_label(workhorse: str, synthesis: str) -> str:
    """Generate a human-readable label like 'Sonnet → Opus'."""
    w = MODEL_REGISTRY[workhorse]["short_name"]
    s = MODEL_REGISTRY[synthesis]["short_name"]
    return f"{w} → {s}"


def estimate_cost(usage_records: list[dict]) -> float:
    """Sum estimated cost from a list of {model, input_tokens, output_tokens}."""
    total = 0.0
    for rec in usage_records:
        info = MODEL_REGISTRY.get(rec["model"])
        if info:
            total += rec["input_tokens"] * info["pricing"]["input"]
            total += rec["output_tokens"] * info["pricing"]["output"]
    return round(total, 4)


def get_available_models() -> list[dict]:
    """Return model list with availability based on env vars."""
    result = []
    for model_id, info in MODEL_REGISTRY.items():
        env_key = _PROVIDER_ENV_KEYS[info["provider"]]
        result.append({
            "id": model_id,
            "provider": info["provider"],
            "tier": info["tier"],
            "short_name": info["short_name"],
            "available": bool(os.getenv(env_key)),
        })
    return result


def reset_clients() -> None:
    """Clear the client cache. Used in tests."""
    _clients.clear()
```

- [ ] **Step 2: Create `tests/test_models.py`**

```python
"""Tests for backend.models — registry, client dispatch, labels, cost."""

import os
from unittest.mock import patch

import pytest

from backend.models import (
    MODEL_REGISTRY,
    _PROVIDER_DEFAULTS,
    _PROVIDER_ENV_KEYS,
    estimate_cost,
    get_available_models,
    get_client_for_model,
    get_model_label,
    reset_clients,
)


class TestModelRegistry:
    def test_all_models_have_required_fields(self):
        required = {"provider", "tier", "short_name", "pricing"}
        for model_id, info in MODEL_REGISTRY.items():
            assert required.issubset(info.keys()), f"{model_id} missing fields"
            assert info["provider"] in _PROVIDER_ENV_KEYS
            assert info["tier"] in {"workhorse", "synthesis"}
            assert "input" in info["pricing"] and "output" in info["pricing"]

    def test_provider_defaults_reference_valid_models(self):
        for provider, defaults in _PROVIDER_DEFAULTS.items():
            assert defaults["workhorse"] in MODEL_REGISTRY
            assert defaults["synthesis"] in MODEL_REGISTRY


class TestGetClientForModel:
    def setup_method(self):
        reset_clients()

    def teardown_method(self):
        reset_clients()

    def test_unknown_model_raises(self):
        with pytest.raises(ValueError, match="Unknown model"):
            get_client_for_model("nonexistent-model")

    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"})
    def test_anthropic_model_returns_client(self):
        client, provider = get_client_for_model("claude-sonnet-4-6")
        assert provider == "anthropic"

    def test_missing_env_var_raises(self):
        reset_clients()
        with patch.dict(os.environ, {}, clear=True):
            with pytest.raises(ValueError, match="No API key"):
                get_client_for_model("claude-sonnet-4-6")


class TestLabels:
    def test_label_format(self):
        label = get_model_label("claude-sonnet-4-6", "claude-opus-4-6")
        assert label == "Sonnet → Opus"

    def test_cross_provider_label(self):
        label = get_model_label("claude-sonnet-4-6", "grok-4.20-0309-reasoning")
        assert label == "Sonnet → Grok 4.20"


class TestEstimateCost:
    def test_basic_cost(self):
        usage = [{"model": "claude-sonnet-4-6", "input_tokens": 1000, "output_tokens": 500}]
        cost = estimate_cost(usage)
        expected = 1000 * 3.00e-6 + 500 * 15.00e-6
        assert cost == round(expected, 4)

    def test_unknown_model_zero_cost(self):
        usage = [{"model": "unknown", "input_tokens": 1000, "output_tokens": 500}]
        assert estimate_cost(usage) == 0.0


class TestAvailableModels:
    @patch.dict(os.environ, {"ANTHROPIC_API_KEY": "x", "OPENAI_API_KEY": "", "XAI_API_KEY": "y"})
    def test_availability_reflects_env(self):
        models = get_available_models()
        by_id = {m["id"]: m for m in models}
        assert by_id["claude-sonnet-4-6"]["available"] is True
        assert by_id["gpt-5-mini"]["available"] is False  # empty string
        assert by_id["grok-4-1-fast-reasoning"]["available"] is True
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/jdollman/life/growth/show-me-the-model && source venv/bin/activate && pip install pytest && python -m pytest tests/test_models.py -v`
Expected: All tests pass.

- [ ] **Step 4: Add `trajectories/` to `.gitignore`**

Add `trajectories/` to the `.gitignore` file (after the existing `results/` line).

- [ ] **Step 5: Commit**

```bash
git add backend/models.py tests/test_models.py .gitignore
git commit -m "feat: add model registry, client cache, and label helpers"
```

---

## Task 2: Trajectory Save/Load Module

**Files:**
- Create: `backend/trajectories.py`
- Create: `tests/test_trajectories.py`

Standalone module for trajectory persistence. No pipeline changes yet.

- [ ] **Step 1: Create `backend/trajectories.py`**

```python
"""Trajectory save/load for per-stage pipeline outputs."""

import hashlib
import json
import logging
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

TRAJECTORIES_DIR = Path(__file__).resolve().parent.parent / "trajectories"


def _ensure_dir() -> Path:
    TRAJECTORIES_DIR.mkdir(exist_ok=True)
    return TRAJECTORIES_DIR


def generate_trajectory_id() -> str:
    return "t_" + secrets.token_urlsafe(6)


def generate_group_id() -> str:
    return "g_" + secrets.token_urlsafe(6)


def hash_source_text(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def save_trajectory(
    trajectory_id: str,
    analysis_id: str,
    source_text: str,
    input_mode: str,
    source_url: str | None,
    workhorse_model: str,
    synthesis_model: str,
    stages: dict[str, Any],
    estimated_cost: float,
    group_id: str,
    reused_from: str | None = None,
) -> Path:
    """Save a trajectory to disk. Returns the file path.

    source_text is stored in the trajectory so re-synthesis can pass it
    to stage 3 (synthesis needs the original essay text).
    """
    trajectory = {
        "trajectory_id": trajectory_id,
        "analysis_id": analysis_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_text_hash": hash_source_text(source_text),
        "source_text": source_text,  # needed for re-synthesis (stage 3 reads the essay)
        "input_mode": input_mode,
        "source_url": source_url,
        "workhorse_model": workhorse_model,
        "synthesis_model": synthesis_model,
        "stages": stages,
        "estimated_cost": estimated_cost,
        "reused_from": reused_from,
        "group_id": group_id,
    }
    path = _ensure_dir() / f"{trajectory_id}.json"
    path.write_text(json.dumps(trajectory, indent=2))
    logger.info("Saved trajectory %s to %s", trajectory_id, path)
    return path


def load_trajectory(trajectory_id: str) -> dict:
    """Load a trajectory by ID. Raises FileNotFoundError or ValueError on problems."""
    path = TRAJECTORIES_DIR / f"{trajectory_id}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Trajectory not found: {trajectory_id}")
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        raise ValueError(f"Corrupt trajectory file {trajectory_id}: {e}")
    # Validate required workhorse stages are present
    stages = data.get("stages", {})
    for required in ("decomposition", "stage2", "dedup"):
        if required not in stages or "result" not in stages[required]:
            raise ValueError(
                f"Trajectory {trajectory_id} is missing completed stage '{required}'. "
                "Cannot reuse incomplete workhorse runs."
            )
    return data


def list_trajectories() -> list[dict]:
    """Return a lightweight index of all saved trajectories."""
    if not TRAJECTORIES_DIR.is_dir():
        return []
    result = []
    for path in sorted(TRAJECTORIES_DIR.glob("t_*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(path.read_text())
            result.append({
                "trajectory_id": data["trajectory_id"],
                "analysis_id": data.get("analysis_id"),
                "created_at": data.get("created_at"),
                "workhorse_model": data.get("workhorse_model"),
                "synthesis_model": data.get("synthesis_model"),
                "source_text_hash": data.get("source_text_hash"),
                "group_id": data.get("group_id"),
                "estimated_cost": data.get("estimated_cost"),
            })
        except (json.JSONDecodeError, KeyError):
            logger.warning("Skipping corrupt trajectory file: %s", path)
    return result


def get_reuse_stages(trajectory_id: str) -> tuple[dict, dict]:
    """Load a trajectory and return (workhorse_stages, trajectory_metadata).

    workhorse_stages is the dict of stages 1-2.5 ready to pass to run_pipeline(reuse_stages=...).
    trajectory_metadata has workhorse_model, source_text_hash, group_id, etc.
    """
    data = load_trajectory(trajectory_id)
    workhorse_stages = {
        "decomposition": data["stages"]["decomposition"]["result"],
        "stage2": data["stages"]["stage2"]["result"],
        "dedup": data["stages"]["dedup"]["result"],
    }
    metadata = {
        "workhorse_model": data["workhorse_model"],
        "source_text_hash": data["source_text_hash"],
        "source_text": data["source_text"],  # needed for stage 3 synthesis
        "group_id": data["group_id"],
        "source_url": data.get("source_url"),
        "input_mode": data.get("input_mode", "text"),
        # Carry forward the workhorse stage data (with usage/timestamps) for the new trajectory
        "workhorse_stage_data": {
            k: data["stages"][k] for k in ("decomposition", "stage2", "dedup")
        },
    }
    return workhorse_stages, metadata
```

- [ ] **Step 2: Create `tests/test_trajectories.py`**

```python
"""Tests for backend.trajectories — save, load, list, reuse."""

import json
import pytest
from pathlib import Path
from unittest.mock import patch

from backend.trajectories import (
    TRAJECTORIES_DIR,
    generate_group_id,
    generate_trajectory_id,
    get_reuse_stages,
    hash_source_text,
    list_trajectories,
    load_trajectory,
    save_trajectory,
)


@pytest.fixture(autouse=True)
def use_tmp_dir(tmp_path, monkeypatch):
    """Point TRAJECTORIES_DIR to a temp directory for all tests."""
    monkeypatch.setattr("backend.trajectories.TRAJECTORIES_DIR", tmp_path)
    return tmp_path


def _make_stages():
    return {
        "decomposition": {"model": "claude-sonnet-4-6", "result": {"thesis": "test"}, "usage": {"input_tokens": 100, "output_tokens": 200}, "timestamp": "2026-03-20T14:30:05Z"},
        "stage2": {"model": "claude-sonnet-4-6", "result": {"identities": {}, "general_eq": {}, "exog_endog": {}, "quantitative": {}, "consistency": {}, "steelman": {}}, "usage": {"input_tokens": 600, "output_tokens": 1200}, "timestamp": "2026-03-20T14:31:00Z"},
        "dedup": {"model": "claude-sonnet-4-6", "result": {"merged": []}, "usage": {"input_tokens": 100, "output_tokens": 200}, "timestamp": "2026-03-20T14:32:00Z"},
        "synthesis": {"model": "claude-opus-4-6", "result": {"report": "test"}, "usage": {"input_tokens": 200, "output_tokens": 400}, "timestamp": "2026-03-20T14:33:00Z"},
    }


class TestSaveAndLoad:
    def test_round_trip(self, use_tmp_dir):
        tid = "t_test123"
        save_trajectory(
            trajectory_id=tid, analysis_id="abc", source_text="hello",
            input_mode="text", source_url=None, workhorse_model="claude-sonnet-4-6",
            synthesis_model="claude-opus-4-6", stages=_make_stages(),
            estimated_cost=0.05, group_id="g_test",
        )
        data = load_trajectory(tid)
        assert data["trajectory_id"] == tid
        assert data["synthesis_model"] == "claude-opus-4-6"
        assert "decomposition" in data["stages"]

    def test_load_missing_raises(self):
        with pytest.raises(FileNotFoundError, match="not found"):
            load_trajectory("t_nonexistent")

    def test_load_corrupt_raises(self, use_tmp_dir):
        path = use_tmp_dir / "t_bad.json"
        path.write_text("not json{{{")
        with pytest.raises(ValueError, match="Corrupt"):
            load_trajectory("t_bad")

    def test_load_incomplete_stages_raises(self, use_tmp_dir):
        stages = _make_stages()
        del stages["dedup"]  # missing required stage
        save_trajectory(
            trajectory_id="t_inc", analysis_id="x", source_text="hi",
            input_mode="text", source_url=None, workhorse_model="claude-sonnet-4-6",
            synthesis_model="claude-opus-4-6", stages=stages,
            estimated_cost=0.0, group_id="g_x",
        )
        with pytest.raises(ValueError, match="missing completed stage"):
            load_trajectory("t_inc")


class TestListTrajectories:
    def test_lists_saved(self, use_tmp_dir):
        save_trajectory(
            trajectory_id="t_a", analysis_id="a1", source_text="x",
            input_mode="text", source_url=None, workhorse_model="claude-sonnet-4-6",
            synthesis_model="claude-opus-4-6", stages=_make_stages(),
            estimated_cost=0.01, group_id="g_1",
        )
        result = list_trajectories()
        assert len(result) == 1
        assert result[0]["trajectory_id"] == "t_a"
        assert "stages" not in result[0]  # lightweight, no full data

    def test_empty_dir(self, use_tmp_dir):
        assert list_trajectories() == []


class TestGetReuseStages:
    def test_extracts_workhorse_stages(self, use_tmp_dir):
        save_trajectory(
            trajectory_id="t_r", analysis_id="r1", source_text="essay",
            input_mode="text", source_url=None, workhorse_model="claude-sonnet-4-6",
            synthesis_model="claude-opus-4-6", stages=_make_stages(),
            estimated_cost=0.05, group_id="g_r",
        )
        stages, meta = get_reuse_stages("t_r")
        assert set(stages.keys()) == {"decomposition", "stage2", "dedup"}
        assert "synthesis" not in stages
        assert meta["workhorse_model"] == "claude-sonnet-4-6"
        assert meta["group_id"] == "g_r"


class TestHelpers:
    def test_trajectory_id_format(self):
        tid = generate_trajectory_id()
        assert tid.startswith("t_")
        assert len(tid) > 3

    def test_group_id_format(self):
        gid = generate_group_id()
        assert gid.startswith("g_")

    def test_hash_deterministic(self):
        h1 = hash_source_text("hello world")
        h2 = hash_source_text("hello world")
        assert h1 == h2
        assert h1.startswith("sha256:")
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/jdollman/life/growth/show-me-the-model && source venv/bin/activate && python -m pytest tests/test_trajectories.py -v`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/trajectories.py tests/test_trajectories.py
git commit -m "feat: add trajectory save/load/list module with tests"
```

---

## Task 3: Refactor Pipeline Dispatch

**Files:**
- Modify: `backend/pipeline.py`

This is the core refactor. `_call_model` stops receiving a client and instead uses the model registry. The old mapping functions and pricing dict are deleted.

- [ ] **Step 1: Update imports and delete old constants**

At the top of `pipeline.py`, replace the existing imports and constants:

- Remove `from anthropic import AsyncAnthropic` and `from openai import AsyncOpenAI` (no longer needed directly)
- Remove `from anthropic.types import TextBlock` — keep this, it's used in `_call_claude`
- Add `from backend.models import MODEL_REGISTRY, get_client_for_model, estimate_cost`
- Delete the entire `_PRICING` dict (lines 25-34)
- Delete `_map_model_for_openai` function (lines 136-142)
- Delete `_map_model_for_xai` function (lines 145-154)
- Delete `_OPENAI_NO_TEMPERATURE` set (line 157)
- Delete the standalone `_estimate_cost` function (lines 38-45) — replaced by `estimate_cost` from `models.py`

**Note:** This commit also switches xAI from non-reasoning (`grok-4-1-fast-non-reasoning`) to reasoning (`grok-4-1-fast-reasoning`) model variants. This is intentional — per xAI docs, grok-4 reasoning models keep chain-of-thought internal and the `content` field contains only the final answer. The response format is identical to non-reasoning for parsing purposes, but the models are more capable.

- [ ] **Step 2: Refactor `_call_claude` — remove `client` parameter**

Change signature from `_call_claude(client, model, ...)` to `_call_claude(model, ...)`.
Inside the function, get the client at the start:

```python
async def _call_claude(
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
    retries: int = _DEFAULT_RETRIES,
) -> tuple[str, dict]:
    client, _ = get_client_for_model(model)
    # ... rest unchanged
```

- [ ] **Step 3: Refactor `_call_openai` — remove `client` parameter, use registry for `no_temperature`**

Change signature from `_call_openai(client, model, ...)` to `_call_openai(model, ...)`.
Inside: get client, and check `no_temperature` from registry instead of the deleted set.

**Critical:** Delete the line `model = _map_model_for_openai(model)` (currently line 171 in pipeline.py). Model names now go straight to the API as-is from the registry. If this line is not deleted, it will try to look up `grok-4-1-fast-reasoning` in the OpenAI map and pass it through unchanged (harmless), but for OpenAI models it would double-map (also harmless since the mapped names aren't in the map). Still, delete it for clarity.

```python
async def _call_openai(
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_tokens: int,
    retries: int = _DEFAULT_RETRIES,
) -> tuple[str, dict]:
    client, _ = get_client_for_model(model)
    # Delete the old line: model = _map_model_for_openai(model)
    # The model name is already the real API model name.
    messages = [...]
    ...
    base_kwargs = dict(model=model, max_completion_tokens=max_tokens, messages=messages, response_format={"type": "json_object"})
    # Replace: if model not in _OPENAI_NO_TEMPERATURE:
    if not MODEL_REGISTRY.get(model, {}).get("no_temperature"):
        base_kwargs["temperature"] = temperature
    ...
```

- [ ] **Step 4: Refactor `_call_model` — remove `client` and `provider` parameters**

New signature and logic:

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
    if provider == "anthropic":
        return await _call_claude(model, system_prompt, user_prompt, temperature, max_tokens, retries)
    else:
        # OpenAI and xAI both use the OpenAI-compatible API
        return await _call_openai(model, system_prompt, user_prompt, temperature, max_tokens, retries)
```

- [ ] **Step 5: Update all stage functions to not receive `client` or `provider`**

For each of `run_stage1`, `_run_single_pass`, `run_stage2`, `run_stage2_5`, `run_stage3`:
- Remove `client` and `provider` parameters from signatures
- Add a `model` parameter (the model name to use for that stage)
- Update the `_call_model(...)` calls inside to pass `model` instead of `client, provider, prompt["model"]`
- Ignore `prompt["model"]` from the YAML — use the passed-in `model` instead

Example for `run_stage1`:

```python
async def run_stage1(source_text: str, model: str) -> tuple[dict, dict]:
    """Stage 1: Decompose the source text into structural components."""
    logger.info("Stage 1: Decomposition (model=%s)", model)
    prompt = load_and_render("stage1_decomposition.yaml", source_text=source_text)
    raw, usage = await _call_model(
        model,  # user-selected, not from YAML
        prompt["system_prompt"],
        prompt["user_prompt"],
        prompt["temperature"],
        prompt["max_tokens"],
    )
    return _extract_json(raw), usage
```

Apply same pattern to `_run_single_pass`, `run_stage2`, `run_stage2_5`, `run_stage3`.

- [ ] **Step 6: Update `run_pipeline` signature and body**

```python
async def run_pipeline(
    source_text: str,
    workhorse_model: str,
    synthesis_model: str,
    on_stage_complete=None,
    reuse_stages: dict | None = None,
) -> dict:
    all_usage = []

    if reuse_stages:
        # Skip stages 1-2.5, use provided results
        decomposition = reuse_stages["decomposition"]
        stage2_results = reuse_stages["stage2"]
        merged = reuse_stages["dedup"]
        if on_stage_complete:
            on_stage_complete("decomposition", decomposition, reused=True)
            on_stage_complete("stage2", stage2_results, reused=True)
            on_stage_complete("dedup", merged, reused=True)
    else:
        # Stage 1
        decomposition, usage1 = await run_stage1(source_text, model=workhorse_model)
        all_usage.append(usage1)
        if on_stage_complete:
            on_stage_complete("decomposition", decomposition, usage=usage1)

        # Stage 2
        stage2_results, usage2_list = await run_stage2(source_text, decomposition, model=workhorse_model)
        all_usage.extend(usage2_list)
        if on_stage_complete:
            # Sum usage across the 6 parallel passes for the stage-level record
            summed_usage = {"model": workhorse_model,
                           "input_tokens": sum(u["input_tokens"] for u in usage2_list),
                           "output_tokens": sum(u["output_tokens"] for u in usage2_list)}
            on_stage_complete("stage2", stage2_results, usage=summed_usage)

        # Stage 2.5
        merged, usage25 = await run_stage2_5(decomposition, stage2_results, model=workhorse_model)
        all_usage.append(usage25)
        if on_stage_complete:
            on_stage_complete("dedup", merged, usage=usage25)

    # Stage 3 — always runs
    synthesis, usage3 = await run_stage3(source_text, decomposition, merged, model=synthesis_model)
    all_usage.append(usage3)
    if on_stage_complete:
        on_stage_complete("synthesis", synthesis, usage=usage3)

    estimated = estimate_cost(all_usage)
    logger.info("Pipeline complete. Estimated API cost: $%.4f", estimated)

    return {
        "workhorse_model": workhorse_model,
        "synthesis_model": synthesis_model,
        "estimated_cost": estimated,
        "decomposition": decomposition,
        "stage2_results": stage2_results,
        "merged_annotations": merged,
        "synthesis": synthesis,
    }
```

Note: `on_stage_complete` callback now accepts an optional `reused` kwarg. Update the callback signature in `main.py` (Task 5).

- [ ] **Step 7: Verify backend still imports cleanly**

Run: `cd /Users/jdollman/life/growth/show-me-the-model && source venv/bin/activate && python -c "from backend.pipeline import run_pipeline; print('OK')"`
Expected: `OK`

- [ ] **Step 8: Run all tests**

Run: `python -m pytest tests/ -v`
Expected: All tests pass (model tests should still pass; pipeline tests are integration-level and depend on API calls, so not tested yet).

- [ ] **Step 9: Commit**

```bash
git add backend/pipeline.py
git commit -m "refactor: pipeline dispatch uses model registry, not client/provider"
```

---

## Task 4: Job Model + API Endpoints

**Files:**
- Modify: `backend/jobs.py`
- Modify: `backend/main.py`

The job dataclass gets new fields. The `/analyze` endpoint is refactored for configurations. New endpoints are added.

- [ ] **Step 1: Update `Job` dataclass in `jobs.py`**

Add fields to the `Job` class:

```python
@dataclass
class Job:
    id: str
    status: JobStatus
    source_text: str
    created_at: float
    email: str | None = None
    source_url: str | None = None
    input_mode: str = "text"
    # New fields
    group_id: str = ""
    workhorse_model: str = ""
    synthesis_model: str = ""
    trajectory_id: str = ""
    label: str = ""
    # Existing
    stages_completed: list[str] = field(default_factory=list)
    partial_results: dict[str, Any] = field(default_factory=dict)
    final_result: dict | None = None
    error: str | None = None
    error_stage: str | None = None
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
```

Update `to_dict` to include the new fields:

```python
def to_dict(self) -> dict:
    d = {
        "job_id": self.id,
        "status": self.status.value,
        "stages_completed": self.stages_completed,
        "created_at": self.created_at,
        "group_id": self.group_id,
        "workhorse_model": self.workhorse_model,
        "synthesis_model": self.synthesis_model,
        "label": self.label,
    }
    # ... rest unchanged
```

Add `get_group` to `JobStore`:

```python
def get_group(self, group_id: str) -> list[Job]:
    """Return all jobs belonging to a group."""
    return [j for j in self._jobs.values() if j.group_id == group_id]
```

Update `create` to accept the new fields:

```python
def create(self, source_text: str, email: str | None = None, source_url: str | None = None,
           input_mode: str = "text", group_id: str = "", workhorse_model: str = "",
           synthesis_model: str = "", trajectory_id: str = "", label: str = "") -> Job:
    job_id = uuid.uuid4().hex[:12]
    job = Job(
        id=job_id, status=JobStatus.PENDING, source_text=source_text,
        created_at=time.time(), email=email, source_url=source_url,
        input_mode=input_mode, group_id=group_id, workhorse_model=workhorse_model,
        synthesis_model=synthesis_model, trajectory_id=trajectory_id, label=label,
    )
    self._jobs[job_id] = job
    return job
```

- [ ] **Step 2: Refactor `_run_job` in `main.py`**

The function no longer receives `api_key` or `provider`. It reads models from the job and uses the registry. It also saves trajectories.

Key changes from the existing `_run_job`:
- No `api_key` or `provider` params (models come from the job)
- No client creation (handled by model registry)
- `on_stage_complete` callback now accepts `usage` and `reused` kwargs
- Trajectory is saved on completion
- `reused_from` is set when re-synthesizing
- Email is sent only for the first completed job in a group

```python
from datetime import datetime, timezone
from backend.trajectories import generate_trajectory_id, save_trajectory

async def _run_job(job_id: str, base_url: str, reuse_stages: dict | None = None,
                   reused_stage_data: dict | None = None, reused_from: str | None = None) -> None:
    job = store.get(job_id)
    if not job:
        return
    job.status = JobStatus.RUNNING

    stage_data = dict(reused_stage_data) if reused_stage_data else {}

    def on_stage_complete(stage_name: str, result: object, usage: dict | None = None,
                          reused: bool = False) -> None:
        job.stages_completed.append(stage_name)
        job.partial_results[stage_name] = result
        if not reused:
            stage_data[stage_name] = {
                "model": job.workhorse_model if stage_name != "synthesis" else job.synthesis_model,
                "result": result,
                "usage": usage or {},
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        event = {
            "stage": stage_name,
            "name": STAGE_NAMES.get(stage_name, stage_name),
            "result": result,
            "reused": reused,
        }
        job.queue.put_nowait(("stage_complete", event))

    try:
        result = await run_pipeline(
            job.source_text,
            workhorse_model=job.workhorse_model,
            synthesis_model=job.synthesis_model,
            on_stage_complete=on_stage_complete,
            reuse_stages=reuse_stages,
        )

        # Generate IDs (same pattern as existing code)
        analysis_id = secrets.token_urlsafe(6)
        result["analysis_id"] = analysis_id
        trajectory_id = generate_trajectory_id()
        job.trajectory_id = trajectory_id

        # Inject metadata (replaces existing metadata injection)
        decomp = result.get("decomposition", {})
        result["metadata"] = {
            "workhorse_model": job.workhorse_model,
            "synthesis_model": job.synthesis_model,
            "trajectory_id": trajectory_id,
            "group_id": job.group_id,
            "estimated_cost": result.get("estimated_cost"),
            "essay_title": decomp.get("essay_title"),
            "essay_author": decomp.get("essay_author"),
            "essay_source": decomp.get("essay_source"),
            "source_url": job.source_url,
            "input_mode": job.input_mode,
        }

        # Save trajectory
        save_trajectory(
            trajectory_id=trajectory_id,
            analysis_id=analysis_id,
            source_text=job.source_text,
            input_mode=job.input_mode,
            source_url=job.source_url,
            workhorse_model=job.workhorse_model,
            synthesis_model=job.synthesis_model,
            stages=stage_data,
            estimated_cost=result.get("estimated_cost", 0),
            group_id=job.group_id,
            reused_from=reused_from,
        )

        # Save result file (same as existing)
        results_dir = Path(__file__).resolve().parent.parent / "results"
        results_dir.mkdir(exist_ok=True)
        result_path = results_dir / f"{analysis_id}.json"
        result_path.write_text(json.dumps(result, indent=2))
        logger.info("Saved result to %s (analysis_id=%s)", result_path, analysis_id)

        job.final_result = result
        job.status = JobStatus.COMPLETED
        job.queue.put_nowait(("done", {
            "job_id": job.id,
            "analysis_id": analysis_id,
            "trajectory_id": trajectory_id,
            "result": result,
        }))

        # Email: send only for the first completed job in the group
        if job.email:
            group_jobs = store.get_group(job.group_id)
            completed_in_group = [j for j in group_jobs if j.status == JobStatus.COMPLETED]
            if len(completed_in_group) <= 1:  # this is the first
                await send_results_email(job.email, analysis_id, base_url)

    except Exception as exc:
        logger.exception("Pipeline failed for job %s", job_id)
        job.status = JobStatus.FAILED
        job.error = str(exc)
        completed = set(job.stages_completed)
        stage_order = ["decomposition", "stage2", "dedup", "synthesis"]
        failed_stage = next((s for s in stage_order if s not in completed), None)
        job.error_stage = failed_stage
        job.queue.put_nowait(("error", {"message": str(exc), "stage": failed_stage}))
    finally:
        job.queue.put_nowait(None)
```

**Important:** The `on_stage_complete` callback now expects `usage` as a kwarg. Update `run_pipeline` in Task 3 Step 6 accordingly — each stage should pass `usage=usage_record` to the callback. See updated `run_pipeline` code in Task 3.

- [ ] **Step 3: Refactor `/analyze` endpoint for configurations**

Replace the current endpoint body. Key changes:
- Parse `configurations` from request body (or build from `X-Provider` header for backwards compat)
- Validate model names against `MODEL_REGISTRY`
- Handle `reuse_trajectory` — load stages, validate
- Generate `group_id`, create one job per configuration, spawn tasks
- Return `{group_id, jobs: [...]}`

```python
from backend.models import MODEL_REGISTRY, _PROVIDER_DEFAULTS, get_model_label, get_available_models
from backend.trajectories import generate_group_id, generate_trajectory_id, get_reuse_stages, list_trajectories, load_trajectory, save_trajectory

MAX_CONFIGURATIONS = 5

@app.post("/analyze")
@limiter.limit("10/minute")
async def analyze(request: Request, text: str | None = Form(None), url: str | None = Form(None),
                  email: str | None = Form(None), file: UploadFile | None = File(None),
                  x_api_key: str | None = Header(None), x_provider: str | None = Header(None)):
    body: dict = {}
    if text is None and url is None and file is None:
        try:
            body = await request.json()
            email = email or body.get("email")
        except Exception:
            pass

    # For JSON body, configurations come from the parsed body.
    # For multipart form (PDF upload), they come from a special _configurations field.
    configurations = body.get("configurations")
    reuse_trajectory_id = body.get("reuse_trajectory")
    if not configurations:
        # Check for multipart form field (PDF upload path)
        form = await request.form()
        raw_configs = form.get("_configurations")
        if raw_configs:
            try:
                configurations = json.loads(raw_configs)
            except json.JSONDecodeError:
                raise HTTPException(status_code=400, detail="Invalid _configurations JSON")
        reuse_trajectory_id = reuse_trajectory_id or form.get("reuse_trajectory")

    # Backwards compatibility: old format with X-Provider header
    if not configurations:
        provider = (x_provider or "anthropic").strip().lower()
        if provider not in _PROVIDER_DEFAULTS:
            raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")
        defaults = _PROVIDER_DEFAULTS[provider]
        configurations = [{"workhorse_model": defaults["workhorse"], "synthesis_model": defaults["synthesis"]}]

    if len(configurations) > MAX_CONFIGURATIONS:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_CONFIGURATIONS} configurations per submission")

    # Validate model names
    for config in configurations:
        for key in ("workhorse_model", "synthesis_model"):
            model = config.get(key)
            if model and model not in MODEL_REGISTRY:
                raise HTTPException(status_code=400, detail=f"Unknown model: {model}")

    # Handle reuse_trajectory
    reuse_stages = None
    reused_stage_data = None
    reuse_meta = None
    if reuse_trajectory_id:
        try:
            reuse_stages, reuse_meta = get_reuse_stages(reuse_trajectory_id)
            reused_stage_data = reuse_meta.pop("workhorse_stage_data")
        except (FileNotFoundError, ValueError) as e:
            raise HTTPException(status_code=400, detail=str(e))

    # Resolve source text
    if not reuse_trajectory_id:
        if email and not EMAIL_RE.match(email):
            raise HTTPException(status_code=400, detail="Invalid email address format")
        source_text, input_mode, source_url = await _resolve_source_text(text, url, file, body)
    else:
        # Re-synthesis: source_text comes from the saved trajectory (stage 3 needs the essay)
        source_text = reuse_meta["source_text"]
        input_mode = reuse_meta.get("input_mode", "text")
        source_url = reuse_meta.get("source_url")

    group_id = reuse_meta["group_id"] if reuse_meta else generate_group_id()
    base_url = os.getenv("BASE_URL", str(request.base_url).rstrip("/"))

    jobs = []
    for i, config in enumerate(configurations):
        workhorse = config.get("workhorse_model") or (reuse_meta["workhorse_model"] if reuse_meta else None)
        synthesis = config["synthesis_model"]
        label = get_model_label(workhorse, synthesis)

        # Memory efficiency: first job stores source_text, others get a reference
        # (For simplicity, all jobs get the text. For very large essays with many
        # configs, JobStore.get_group() could share, but N<=5 * 50KB is fine.)
        job = store.create(
            source_text=source_text, email=email, source_url=source_url,
            input_mode=input_mode, group_id=group_id,
            workhorse_model=workhorse, synthesis_model=synthesis, label=label,
        )
        asyncio.create_task(_run_job(
            job.id, base_url,
            reuse_stages=reuse_stages,
            reused_stage_data=reused_stage_data,
            reused_from=reuse_trajectory_id,  # set for re-synthesis, None otherwise
        ))
        jobs.append({
            "job_id": job.id,
            "stream_url": f"/jobs/{job.id}/stream",
            "label": label,
        })

    return {"group_id": group_id, "jobs": jobs}
```

- [ ] **Step 4: Add new endpoints**

```python
@app.get("/models")
async def get_models():
    return {"models": get_available_models()}

@app.get("/trajectories")
async def get_trajectories():
    return list_trajectories()

@app.get("/trajectories/{trajectory_id}")
async def get_trajectory(trajectory_id: str):
    if not re.match(r"^t_[A-Za-z0-9_-]{6,12}$", trajectory_id):
        raise HTTPException(status_code=400, detail="Invalid trajectory ID format")
    try:
        return load_trajectory(trajectory_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Trajectory not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

- [ ] **Step 5: Clean up old imports in `main.py`**

Remove:
- `from anthropic import AsyncAnthropic`
- `from openai import AsyncOpenAI`
- The old `_PROVIDER_ENV_KEYS` and `VALID_PROVIDERS` constants (moved to `models.py`)

These are no longer needed since client creation happens in `models.py`.

- [ ] **Step 6: Verify backend imports and run tests**

Run: `source venv/bin/activate && python -c "from backend.main import app; print('OK')" && python -m pytest tests/ -v`
Expected: Imports clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/jobs.py backend/main.py
git commit -m "feat: multi-config /analyze, trajectory endpoints, job model extensions"
```

---

## Task 5: Frontend API Layer + Settings

**Files:**
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/hooks/useApiSettings.js`

- [ ] **Step 1: Update `api.js`**

Replace `submitJob` and add new API functions:

```javascript
/**
 * Fetch the model registry from the backend.
 */
export async function fetchModels() {
  const res = await fetch("/api/models");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Submit one or more configurations for analysis.
 * @param {Object} params
 * @param {Array} params.configurations - [{workhorse_model, synthesis_model}]
 * @param {string} [params.text]
 * @param {string} [params.url]
 * @param {File} [params.file]
 * @param {string} [params.email]
 * @param {string} [params.reuse_trajectory]
 * @returns {Promise<{group_id: string, jobs: Array}>}
 */
export async function submitJob({ text, url, file, email, configurations, reuse_trajectory }) {
  const headers = {};

  let body;
  if (file) {
    body = new FormData();
    body.append("file", file);
    if (email) body.append("email", email);
    // FormData can't carry complex JSON, so put configurations in a special field
    body.append("_configurations", JSON.stringify(configurations));
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({
      text: text || undefined,
      url: url || undefined,
      email: email || undefined,
      configurations,
      reuse_trajectory: reuse_trajectory || undefined,
    });
  }

  const res = await fetch("/api/analyze", { method: "POST", headers, body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch list of saved trajectories.
 */
export async function fetchTrajectories() {
  const res = await fetch("/api/trajectories");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetch a single trajectory by ID.
 */
export async function fetchTrajectory(trajectoryId) {
  const res = await fetch(`/api/trajectories/${trajectoryId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}
```

Keep `connectSSE`, `fetchJob`, and `fetchResult` unchanged.

- [ ] **Step 2: Update `useApiSettings.js`**

Manage an array of configurations instead of a single provider:

```javascript
import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY_CONFIGS = "smtm_configurations";

const DEFAULT_CONFIGS = [
  { workhorse_model: "claude-sonnet-4-6", synthesis_model: "claude-opus-4-6" },
];

export default function useApiSettings() {
  const [configurations, setConfigurations] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_CONFIGS);
      if (stored) return JSON.parse(stored);
    } catch {}
    return DEFAULT_CONFIGS;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_CONFIGS, JSON.stringify(configurations));
  }, [configurations]);

  const addConfiguration = useCallback(() => {
    setConfigurations((prev) => [
      ...prev,
      { ...DEFAULT_CONFIGS[0] },
    ]);
  }, []);

  const removeConfiguration = useCallback((index) => {
    setConfigurations((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateConfiguration = useCallback((index, field, value) => {
    setConfigurations((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [field]: value } : c))
    );
  }, []);

  return { configurations, addConfiguration, removeConfiguration, updateConfiguration };
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api.js frontend/src/hooks/useApiSettings.js
git commit -m "feat: frontend API layer for multi-config submissions and model registry"
```

---

## Task 6: InputForm — Model Selection UI

**Files:**
- Modify: `frontend/src/components/InputForm.jsx`

- [ ] **Step 1: Rewrite InputForm**

Replace the provider dropdown with two model dropdowns per configuration, plus add/remove buttons. The component fetches models from `/api/models` on mount.

Key changes:
- Import `fetchModels` from `api.js`
- `useState` for `models` (loaded from API), `modelsLoading`
- `useEffect` to call `fetchModels()` on mount
- Replace `PROVIDERS` constant and single `<select>` with a `ConfigurationRow` component
- Each row has two `<select>` elements (workhorse and synthesis)
- Models grouped by provider via `<optgroup>`
- "Add another configuration" button (max 5)
- "×" button to remove extra rows
- `canSubmit` no longer checks for API key
- `handleSubmit` sends `configurations` array instead of `apiKey` + `provider`

The model `<select>` should show all models in both dropdowns but order workhorse-tier first in the left dropdown and synthesis-tier first in the right dropdown. Models without `available: true` should be shown but disabled.

```jsx
function ModelSelect({ value, onChange, models, preferTier, style }) {
  // Group by provider, sort preferred tier first within each group
  const providers = [...new Set(models.map((m) => m.provider))];
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="..." style={style}>
      {providers.map((prov) => {
        const group = models
          .filter((m) => m.provider === prov)
          .sort((a, b) => (a.tier === preferTier ? -1 : 1) - (b.tier === preferTier ? -1 : 1));
        return (
          <optgroup key={prov} label={prov.charAt(0).toUpperCase() + prov.slice(1)}>
            {group.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {m.short_name}{!m.available ? " (no key)" : ""}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
```

- [ ] **Step 2: Build and verify no errors**

Run: `cd /Users/jdollman/life/growth/show-me-the-model/frontend && npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/InputForm.jsx
git commit -m "feat: two-dropdown model selection with add/remove configuration rows"
```

---

## Task 7: Multi-Job SSE Streaming

**Files:**
- Modify: `frontend/src/hooks/useJobStream.js`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Update `useJobStream.js` to handle multiple jobs**

The hook now tracks a `groupId` and an array of job states. Each job gets its own SSE connection.

```javascript
export default function useJobStream() {
  const [phase, setPhase] = useState("idle");
  const [groupId, setGroupId] = useState(null);
  const [jobStates, setJobStates] = useState([]);
  // jobStates: [{jobId, label, stages: {}, result: null, error: null, done: false}]
  const [error, setError] = useState(null);

  const reset = useCallback(({ pushHistory = true } = {}) => {
    setPhase("idle");
    setGroupId(null);
    setJobStates([]);
    setError(null);
    if (pushHistory) {
      window.history.pushState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const handleSubmit = useCallback(async (formData) => {
    setPhase("running");
    setJobStates([]);
    setError(null);

    try {
      const { group_id, jobs } = await submitJob(formData);
      setGroupId(group_id);

      const initialStates = jobs.map((j) => ({
        jobId: j.job_id,
        label: j.label,
        stages: {},
        result: null,
        analysisId: null,
        trajectoryId: null,
        error: null,
        done: false,
      }));
      setJobStates(initialStates);

      // Open SSE for each job
      jobs.forEach((j, idx) => {
        connectSSE(j.job_id, {
          onStageComplete: (data) => {
            setJobStates((prev) => prev.map((s, i) =>
              i === idx ? { ...s, stages: { ...s.stages, [data.stage]: data } } : s
            ));
          },
          onDone: (data) => {
            setJobStates((prev) => {
              const updated = prev.map((s, i) =>
                i === idx ? {
                  ...s, done: true, result: data.result,
                  analysisId: data.analysis_id,
                  trajectoryId: data.trajectory_id,
                } : s
              );
              // If all jobs done, show first result
              if (updated.every((s) => s.done || s.error)) {
                const first = updated.find((s) => s.done);
                if (first?.analysisId) {
                  window.history.pushState(null, "", `#/results/${first.analysisId}`);
                }
                setTimeout(() => setPhase("done"), 0);
              }
              return updated;
            });
          },
          onError: (data) => {
            setJobStates((prev) => {
              const updated = prev.map((s, i) =>
                i === idx ? { ...s, error: data, done: true } : s
              );
              if (updated.every((s) => s.done || s.error)) {
                if (updated.every((s) => s.error)) {
                  setError(data);
                  setTimeout(() => setPhase("error"), 0);
                } else {
                  setTimeout(() => setPhase("done"), 0);
                }
              }
              return updated;
            });
          },
        });
      });
    } catch (err) {
      setError({ message: err.message });
      setPhase("error");
    }
  }, []);

  // Computed: first successful result for display
  const firstDone = jobStates.find((s) => s.done && s.result);

  return {
    phase, groupId, jobStates, error,
    result: firstDone?.result || null,
    analysisId: firstDone?.analysisId || null,
    handleSubmit, reset,
    setPhase, setResult: () => {}, setAnalysisId: () => {},
    setError, setGroupId, setJobStates,
  };
}
```

Note: `setResult` and `setAnalysisId` become derived from `jobStates` for the running flow, but `useResultRouting` still needs to set them directly for hash-based navigation. Keep stub setters that update `jobStates`.

- [ ] **Step 2: Update `App.jsx` to pass group data**

```jsx
export default function App() {
  const { phase, groupId, jobStates, result, analysisId, error, handleSubmit, reset,
          setPhase, setResult, setAnalysisId, setError, setGroupId, setJobStates } = useJobStream();

  useResultRouting({ setPhase, setResult, setAnalysisId, setError, reset });

  if (phase === "done") {
    return <ResultsView result={result} analysisId={analysisId} groupId={groupId}
                        jobStates={jobStates} onReset={reset} />;
  }

  // ... rest same, but pass jobStates to ProgressTracker:
  {phase === "running" && (
    <ProgressTracker jobStates={jobStates} stageOrder={STAGE_ORDER} />
  )}
```

- [ ] **Step 3: Build and verify**

Run: `cd /Users/jdollman/life/growth/show-me-the-model/frontend && npx vite build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useJobStream.js frontend/src/App.jsx
git commit -m "feat: multi-job SSE streaming with per-config progress tracking"
```

---

## Task 8: Multi-Pipeline ProgressTracker

**Files:**
- Modify: `frontend/src/components/ProgressTracker.jsx`

- [ ] **Step 1: Update ProgressTracker for multi-job display**

Change props from `{stages, stageOrder}` to `{jobStates, stageOrder}`.

When `jobStates` has one entry, render like before (single pipeline). When multiple, show a labeled section per pipeline.

```jsx
export default function ProgressTracker({ jobStates, stageOrder }) {
  if (!jobStates || jobStates.length === 0) return null;

  return (
    <div className="space-y-6">
      {jobStates.map((job, idx) => (
        <div key={job.jobId}>
          {jobStates.length > 1 && (
            <p className="text-sm font-medium mb-2 font-body" style={{ color: "var(--smtm-text-secondary)" }}>
              {job.label}
            </p>
          )}
          <PipelineProgress stages={job.stages} stageOrder={stageOrder} />
          {job.error && (
            <p className="text-sm mt-1" style={{ color: "var(--smtm-error)" }}>
              Error: {job.error.message}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
```

Extract the existing single-pipeline rendering into a `PipelineProgress` sub-component that takes `{stages, stageOrder}` — this is essentially the current `ProgressTracker` body.

- [ ] **Step 2: Build and verify**

Run: `cd /Users/jdollman/life/growth/show-me-the-model/frontend && npx vite build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ProgressTracker.jsx
git commit -m "feat: multi-pipeline progress tracker with per-config labels"
```

---

## Task 9: Version Navigator + Re-synthesize

**Files:**
- Modify: `frontend/src/components/ResultsView.jsx`
- Modify: `frontend/src/hooks/useResultRouting.js`

- [ ] **Step 1: Add VersionNavigator component to ResultsView**

At the top of the results view, when `jobStates` has multiple completed entries, show a navigator:

```jsx
function VersionNavigator({ jobStates, currentAnalysisId, onSwitch }) {
  const completed = jobStates.filter((j) => j.done && j.result);
  if (completed.length <= 1) return null;

  const currentIdx = completed.findIndex((j) => j.analysisId === currentAnalysisId);

  return (
    <div className="rounded-lg px-4 py-3 mb-6 text-sm" style={{ background: "var(--smtm-share-bg)" }}>
      <span className="font-medium" style={{ color: "var(--smtm-text-primary)" }}>
        Version {currentIdx + 1} of {completed.length}: {completed[currentIdx]?.label}
      </span>
      <div className="flex gap-3 mt-1">
        {completed.map((j, i) =>
          i !== currentIdx ? (
            <button
              key={j.analysisId}
              onClick={() => onSwitch(j)}
              className="text-sm cursor-pointer hover:underline font-body"
              style={{ color: "var(--smtm-accent-teal)" }}
            >
              ▸ {j.label}
            </button>
          ) : null
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update ResultsView props and metadata display**

Add `groupId` and `jobStates` props. Replace the hardcoded workflow display with actual model names from the result metadata.

In `ResultsView`, add the `VersionNavigator` above the main content:

```jsx
export default function ResultsView({ result, analysisId, groupId, jobStates = [], onReset }) {
  const handleSwitch = (job) => {
    // Navigate to the alternate result
    window.history.pushState(null, "", `#/results/${job.analysisId}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
    <div>
      {/* ... existing header ... */}
      <VersionNavigator
        jobStates={jobStates}
        currentAnalysisId={analysisId}
        onSwitch={handleSwitch}
      />
      {/* ... existing content ... */}
    </div>
  );
}
```

Also find and replace the hardcoded workflow display. Search for `metadata.workflow` in `ResultsView.jsx` and replace with:

```jsx
{result?.metadata?.workhorse_model && result?.metadata?.synthesis_model
  ? `${result.metadata.workhorse_model} → ${result.metadata.synthesis_model}`
  : result?.metadata?.workflow || "Unknown"}
```

- [ ] **Step 3: Add Re-synthesize button**

Below the `ShareBox` in `ResultsView`, add a re-synthesize section:

```jsx
function ResynthesizeButton({ trajectoryId, groupId, onSubmit }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && models.length === 0) {
      fetchModels().then((data) => {
        setModels(data.models.filter((m) => m.available));
        const defaultSynth = data.models.find((m) => m.tier === "synthesis" && m.available);
        if (defaultSynth) setSelectedModel(defaultSynth.id);
      });
    }
  }, [open]);

  if (!trajectoryId) return null;

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit({
        reuse_trajectory: trajectoryId,
        configurations: [{ synthesis_model: selectedModel }],
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-4">
      <button onClick={() => setOpen(!open)} className="text-sm cursor-pointer font-body"
              style={{ color: "var(--smtm-accent-teal)" }}>
        {open ? "Cancel" : "Re-synthesize with different model"}
      </button>
      {open && (
        <div className="flex gap-2 mt-2 items-center">
          <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}
                  className="rounded-md border px-3 py-2 text-sm" style={{...inputBase}}>
            {models.map((m) => <option key={m.id} value={m.id}>{m.short_name}</option>)}
          </select>
          <button onClick={handleSubmit} disabled={submitting || !selectedModel}
                  className="rounded-md px-4 py-2 text-sm font-bold cursor-pointer"
                  style={{ background: "var(--smtm-btn-primary-bg)", color: "var(--smtm-btn-primary-text)" }}>
            {submitting ? "Submitting..." : "Run"}
          </button>
        </div>
      )}
    </div>
  );
}
```

Wire this into `ResultsView`. The `onSubmit` prop should trigger a new job submission and transition back to the running phase.

- [ ] **Step 4: Update `useResultRouting.js` for group-aware loading**

When loading a result by hash URL, the version navigator needs to know about sibling results in the same group. The result JSON (saved by `_run_job` in Task 4) includes `metadata.group_id`. Use this to load group siblings.

Update `loadResultById` in `useResultRouting`:

```javascript
const loadResultById = useCallback(
  (hashId) => {
    setPhase("running");
    setError(null);
    fetchResult(hashId)
      .then(async (data) => {
        setResult(data);
        setAnalysisId(data.analysis_id || hashId);

        // Load group siblings for version navigator
        const groupId = data?.metadata?.group_id;
        if (groupId && setGroupId && setJobStates) {
          setGroupId(groupId);
          try {
            const trajectories = await fetchTrajectories();
            const siblings = trajectories.filter((t) => t.group_id === groupId);
            const states = siblings.map((t) => ({
              jobId: t.trajectory_id,
              label: `${t.workhorse_model} → ${t.synthesis_model}`,
              stages: {},
              result: t.analysis_id === (data.analysis_id || hashId) ? data : null,
              analysisId: t.analysis_id,
              trajectoryId: t.trajectory_id,
              error: null,
              done: true,
            }));
            setJobStates(states);
          } catch (e) {
            // Non-fatal: version navigator just won't show
          }
        }

        setPhase("done");
      })
      .catch((err) => {
        setError({ message: `Failed to load analysis: ${err.message}` });
        setPhase("error");
      });
  },
  [setPhase, setResult, setAnalysisId, setError, setGroupId, setJobStates]
);
```

Add `setGroupId` and `setJobStates` to the hook's parameter destructuring. Import `fetchTrajectories` from `api.js`.

The version navigator in ResultsView works off `jobStates`, so when navigating to a URL or re-synthesizing, the siblings are loaded from the trajectories index. When clicking a sibling that hasn't been loaded yet, `handleSwitch` triggers a hash navigation which re-runs `loadResultById` for that analysis ID.

- [ ] **Step 5: Build and verify**

Run: `cd /Users/jdollman/life/growth/show-me-the-model/frontend && npx vite build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ResultsView.jsx frontend/src/hooks/useResultRouting.js
git commit -m "feat: version navigator for comparing parallel runs + re-synthesize button"
```

---

## Task 10: Integration Verification

**Files:** None (testing only)

- [ ] **Step 1: Verify backend starts**

Run: `cd /Users/jdollman/life/growth/show-me-the-model && source venv/bin/activate && timeout 5 uvicorn backend.main:app --host 127.0.0.1 --port 8000 || true`
Expected: Server starts without import errors. (Ctrl+C or timeout is fine.)

- [ ] **Step 2: Verify `/models` endpoint**

Run: `curl -s http://localhost:8000/models | python3 -m json.tool`
Expected: JSON with `models` array listing all 6 models with `available` flags.

- [ ] **Step 3: Verify frontend builds and dev server starts**

Run: `cd /Users/jdollman/life/growth/show-me-the-model/frontend && npx vite build && npx vite --host 127.0.0.1 &`
Expected: Build succeeds. Dev server starts on port 5173.

- [ ] **Step 4: Run all backend tests**

Run: `cd /Users/jdollman/life/growth/show-me-the-model && source venv/bin/activate && python -m pytest tests/ -v`
Expected: All tests pass.

- [ ] **Step 5: Push**

```bash
git push origin master
```

- [ ] **Step 6: Commit final state**

If any fixes were needed during verification, commit them:

```bash
git add -A && git commit -m "fix: integration fixes from end-to-end verification"
git push origin master
```
