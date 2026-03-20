# Factorial Model Selection & Trajectory Saving

**Date:** 2026-03-20
**Status:** Approved

## Problem

The app currently treats "provider" (Anthropic/OpenAI/xAI) as the unit of configuration. The user picks a provider and the app maps that to a workhorse model (stages 1-2.5) and a synthesis model (stage 3). This prevents mixing providers across stages, comparing different model combinations, and reusing expensive parsing results with different synthesis models.

## Design

### Model Registry

Replace the provider-based dispatch with a model registry. Model name is the primitive — the pipeline figures out which SDK client to use from the model name.

```python
MODEL_REGISTRY = {
    "claude-sonnet-4-6":         {"provider": "anthropic", "tier": "workhorse",  "pricing": {"input": 3.00e-6,  "output": 15.00e-6}},
    "claude-opus-4-6":           {"provider": "anthropic", "tier": "synthesis",  "pricing": {"input": 15.00e-6, "output": 75.00e-6}},
    "gpt-5-mini":                {"provider": "openai",    "tier": "workhorse",  "pricing": {"input": 1.50e-6,  "output": 6.00e-6}},
    "gpt-5.4":                   {"provider": "openai",    "tier": "synthesis",  "pricing": {"input": 10.00e-6, "output": 30.00e-6}},
    "grok-4-1-fast-reasoning":   {"provider": "xai",       "tier": "workhorse",  "pricing": {"input": 0.20e-6,  "output": 0.50e-6}},
    "grok-4.20-0309-reasoning":  {"provider": "xai",       "tier": "synthesis",  "pricing": {"input": 2.00e-6,  "output": 6.00e-6}},
}
```

- `tier` is a UI hint (which dropdown to show the model in first) but any model can go in either slot.
- `pricing` consolidates the current `_PRICING` dict into the registry.
- New models/providers are added by adding a row to the registry + the corresponding env var.

### Client Dispatch

`_call_model` becomes self-sufficient. It receives a model name (not a client), looks up the provider from the registry, and uses a module-level client cache:

```python
_clients: dict[str, AsyncAnthropic | AsyncOpenAI] = {}

def _get_client(provider: str) -> AsyncAnthropic | AsyncOpenAI:
    if provider not in _clients:
        if provider == "anthropic":
            _clients[provider] = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        elif provider == "openai":
            _clients[provider] = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        elif provider == "xai":
            _clients[provider] = AsyncOpenAI(api_key=os.getenv("XAI_API_KEY"), base_url="https://api.x.ai/v1")
    return _clients[provider]
```

`_call_model` signature changes from `(client, provider, model, ...)` to `(model, ...)`. It determines the provider from the registry and calls `_call_claude` or `_call_openai` accordingly.

The model-mapping functions (`_map_model_for_openai`, `_map_model_for_xai`) are deleted. The actual model names from the registry go straight to the API.

YAML prompt files still specify a model field, but `run_pipeline` ignores it and uses the user-selected model instead.

### Pipeline Signature

```python
async def run_pipeline(
    source_text: str,
    workhorse_model: str,
    synthesis_model: str,
    on_stage_complete=None,
    reuse_stages: dict | None = None,  # stages 1-2.5 from a saved trajectory
) -> dict:
```

When `reuse_stages` is provided, the pipeline skips stages 1-2.5 and jumps to synthesis using the provided intermediate results. It still fires `on_stage_complete` callbacks for the reused stages (with a `reused: true` flag) so the frontend can show progress.

### Trajectory Format

Every run saves a trajectory file to `trajectories/{trajectory_id}.json`:

```json
{
  "trajectory_id": "t_abc123",
  "analysis_id": "xyz789",
  "created_at": "2026-03-20T14:30:00Z",
  "source_text_hash": "sha256:...",
  "input_mode": "url",
  "source_url": "https://...",
  "workhorse_model": "claude-sonnet-4-6",
  "synthesis_model": "grok-4.20-0309-reasoning",
  "stages": {
    "decomposition": {
      "model": "claude-sonnet-4-6",
      "result": {},
      "usage": {"input_tokens": 1234, "output_tokens": 5678},
      "timestamp": "2026-03-20T14:30:05Z"
    },
    "stage2": {
      "model": "claude-sonnet-4-6",
      "result": {},
      "usage": {},
      "timestamp": "..."
    },
    "dedup": {},
    "synthesis": {
      "model": "grok-4.20-0309-reasoning",
      "result": {},
      "usage": {},
      "timestamp": "..."
    }
  },
  "estimated_cost": 0.1234,
  "reused_from": null,
  "group_id": "g_xyz789"
}
```

- `source_text_hash`: SHA-256 of the source text. Links trajectories on the same essay without duplicating text.
- `reused_from`: trajectory ID whose stages 1-2.5 were reused, or null. The reused stage data is copied into this trajectory so it's self-contained.
- `group_id`: ties together trajectories from a single parallel submission, used by the frontend for click-through navigation.
- Each stage records its own model independently, supporting future per-stage model selection without a format change.
- `trajectories/` directory is gitignored.

### API Changes

**`POST /analyze` — modified:**

Accepts a list of configurations:

```json
{
  "text": "essay text...",
  "configurations": [
    {"workhorse_model": "claude-sonnet-4-6", "synthesis_model": "claude-opus-4-6"},
    {"workhorse_model": "claude-sonnet-4-6", "synthesis_model": "grok-4.20-0309-reasoning"}
  ]
}
```

For re-synthesis from a saved trajectory:

```json
{
  "reuse_trajectory": "t_abc123",
  "configurations": [
    {"synthesis_model": "gpt-5.4"}
  ]
}
```

When `reuse_trajectory` is set, stages 1-2.5 are loaded from the trajectory. `workhorse_model` and `text` are not required.

Response returns a group ID and per-configuration job IDs:

```json
{
  "group_id": "g_xyz789",
  "jobs": [
    {"job_id": "abc123", "stream_url": "/jobs/abc123/stream", "label": "Sonnet → Opus"},
    {"job_id": "def456", "stream_url": "/jobs/def456/stream", "label": "Sonnet → Grok 4.20"}
  ]
}
```

Each job runs independently as its own asyncio task and streams SSE events on its own stream URL.

**`GET /trajectories` — new:**

Returns a lightweight index of saved trajectories:

```json
[
  {
    "trajectory_id": "t_abc123",
    "analysis_id": "xyz789",
    "created_at": "...",
    "workhorse_model": "claude-sonnet-4-6",
    "synthesis_model": "claude-opus-4-6",
    "source_text_hash": "sha256:...",
    "group_id": "g_xyz789",
    "estimated_cost": 0.1234
  }
]
```

**`GET /trajectories/{trajectory_id}` — new:**

Returns the full trajectory JSON.

**`GET /models` — new:**

Returns the model registry so the frontend doesn't hardcode model lists:

```json
{
  "models": [
    {"id": "claude-sonnet-4-6", "provider": "anthropic", "tier": "workhorse", "available": true},
    {"id": "claude-opus-4-6", "provider": "anthropic", "tier": "synthesis", "available": true},
    ...
  ]
}
```

`available` is true when the corresponding env var is set. This way the frontend can gray out models the user hasn't configured keys for.

### Frontend Changes

**InputForm:**

Two model dropdowns replace the single provider selector:

```
Workhorse Model (Stages 1-2.5)     Synthesis Model (Stage 3)
[Claude Sonnet 4.6           v]    [Claude Opus 4.6             v]
                        [+ Add another configuration]
```

Models grouped by provider via `<optgroup>`. Tier determines default ordering (workhorse-tier models first in left dropdown, synthesis-tier first in right dropdown) but all models appear in both.

"Add another configuration" adds a row. Each extra row has an "x" to remove. On submit, all configurations are sent as the `configurations` array.

The form fetches available models from `GET /models` on mount rather than hardcoding.

**ProgressTracker:**

When multiple configurations run, shows all pipelines:

```
Sonnet → Opus
  ✓ Decomposition  ✓ Analysis  ✓ Dedup  ⟳ Synthesis

Sonnet → Grok 4.20
  ✓ Decomposition  ✓ Analysis  ✓ Dedup  ⟳ Synthesis
```

Each pipeline streams independently via its own SSE connection.

**ResultsView — version navigator:**

When a result belongs to a group with multiple trajectories, a navigator appears:

```
Version 1 of 3: Sonnet → Opus
  ▸ Sonnet → Grok 4.20   ▸ Sonnet → GPT-5.4
```

Clicking an alternate loads that trajectory's result. URL updates to `#/results/{analysis_id}` for bookmarkability.

**Re-synthesize button:**

In the results view, a "Re-synthesize with different model" button. Shows a synthesis model dropdown and submits with `reuse_trajectory`. The new result appears as another version in the navigator.

### Backwards Compatibility

The old request format (single `X-Provider` header, no `configurations` array) continues to work. `main.py` detects the old format and converts it to the new format internally:

```python
if not configurations:
    provider = x_provider or "anthropic"
    configurations = [{"workhorse_model": default_workhorse(provider), "synthesis_model": default_synthesis(provider)}]
```

This keeps the upstream hosted version functional.

### Files Changed

| File | Change |
|------|--------|
| `backend/pipeline.py` | Model registry, client cache, `_call_model` takes model name not client, `run_pipeline` takes model names + `reuse_stages` |
| `backend/main.py` | `/analyze` accepts configurations array + `reuse_trajectory`, spawns parallel jobs, new `/trajectories`, `/trajectories/{id}`, `/models` endpoints |
| `backend/jobs.py` | Job dataclass gets `group_id`, `workhorse_model`, `synthesis_model`, `trajectory_id` fields |
| `frontend/src/components/InputForm.jsx` | Two model dropdowns, add/remove configuration rows, fetch from `/models` |
| `frontend/src/hooks/useApiSettings.js` | Manage configurations array instead of single provider |
| `frontend/src/api.js` | `submitJob` sends configurations array, new `fetchTrajectories`/`fetchTrajectory`/`fetchModels` functions |
| `frontend/src/hooks/useJobStream.js` | Handle multiple SSE streams, track per-job progress |
| `frontend/src/components/ProgressTracker.jsx` | Show multi-pipeline progress |
| `frontend/src/components/ResultsView.jsx` | Version navigator bar, re-synthesize button |
| `frontend/src/hooks/useResultRouting.js` | Load group info for version navigation |
