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
    # Anthropic
    "claude-sonnet-4-6":         {"provider": "anthropic", "tier": "workhorse",  "short_name": "Sonnet",     "pricing": {"input": 3.00e-6,  "output": 15.00e-6}},
    "claude-opus-4-6":           {"provider": "anthropic", "tier": "synthesis",  "short_name": "Opus",       "pricing": {"input": 15.00e-6, "output": 75.00e-6}},
    # OpenAI
    "gpt-5-mini":                {"provider": "openai",    "tier": "workhorse",  "short_name": "GPT-5 mini", "pricing": {"input": 1.50e-6,  "output": 6.00e-6},  "no_temperature": True},
    "gpt-5.4":                   {"provider": "openai",    "tier": "synthesis",  "short_name": "GPT-5.4",    "pricing": {"input": 10.00e-6, "output": 30.00e-6}},
    # xAI — reasoning variants (reasoning is internal; content field is just the answer)
    "grok-4-1-fast-reasoning":   {"provider": "xai",       "tier": "workhorse",  "short_name": "Grok 4.1 Fast", "pricing": {"input": 0.20e-6,  "output": 0.50e-6}},
    "grok-4.20-0309-reasoning":  {"provider": "xai",       "tier": "synthesis",  "short_name": "Grok 4.20",     "pricing": {"input": 2.00e-6,  "output": 6.00e-6}},
}
```

- `tier` is a UI hint (which dropdown to show the model in first) but any model can go in either slot.
- `pricing` consolidates the current `_PRICING` dict into the registry.
- `short_name` is used for human-readable labels in the UI (e.g., "Sonnet → Opus" in version navigator and job response labels).
- `no_temperature` (optional, default False): when True, `_call_openai` omits the `temperature` parameter. Currently only applies to `gpt-5-mini`. Replaces the existing `_OPENAI_NO_TEMPERATURE` set.
- xAI models use the **reasoning** variants intentionally. Per xAI docs, grok-4 reasoning models keep chain-of-thought internal — the `content` field contains only the final answer. The non-reasoning variants from the prior commit are replaced.
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
- `group_id`: generated as `"g_" + secrets.token_urlsafe(6)`. Ties together trajectories from a single parallel submission, used by the frontend for click-through navigation. Re-synthesis jobs inherit the group_id of the trajectory they reuse, so they appear as additional versions alongside the originals.
- `stage2.result` contains the full 6-pass results dict (keys: `identities`, `general_eq`, `exog_endog`, `quantitative`, `consistency`, `steelman`), matching the current `run_stage2` return format. `stage2.usage` is the sum across all 6 passes.
- Each stage records its own model independently, supporting future per-stage model selection without a format change.
- `trajectories/` directory is gitignored (add to `.gitignore`).
- Trajectories **supplement** the existing `results/` files, not replace them. `results/{analysis_id}.json` continues to be written for shareable URL compatibility. The trajectory contains the full per-stage trace; the result file contains the rendered output.

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

When `reuse_trajectory` is set, stages 1-2.5 are loaded from the trajectory. `workhorse_model` and `text` are not required. If `workhorse_model` is provided alongside `reuse_trajectory`, it is ignored (the workhorse model is determined by the saved trajectory).

**Validation:** If `reuse_trajectory` references a trajectory that doesn't exist, is corrupt, or has incomplete workhorse stages (e.g., original run failed mid-pipeline), return HTTP 400 with a descriptive error. Per the project's "Fail Loudly" principle, never silently fall back to re-running stages.

**Limits:** Maximum 5 configurations per submission. Return HTTP 400 if exceeded.

Response returns a group ID and per-configuration job IDs. Labels are derived from `short_name` in the model registry:

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
# Provider-to-model defaults for backwards compatibility
_PROVIDER_DEFAULTS = {
    "anthropic": {"workhorse": "claude-sonnet-4-6",       "synthesis": "claude-opus-4-6"},
    "openai":    {"workhorse": "gpt-5-mini",              "synthesis": "gpt-5.4"},
    "xai":       {"workhorse": "grok-4-1-fast-reasoning", "synthesis": "grok-4.20-0309-reasoning"},
}

if not configurations:
    provider = x_provider or "anthropic"
    defaults = _PROVIDER_DEFAULTS[provider]
    configurations = [{"workhorse_model": defaults["workhorse"], "synthesis_model": defaults["synthesis"]}]
```

This keeps the upstream hosted version functional.

### Email Behavior

For parallel submissions, email notification is sent once when the **first** job in the group completes, with a link to the group's results. Subsequent completions do not trigger additional emails.

### xAI Compatibility Notes

- xAI's OpenAI-compatible API supports `response_format: {"type": "json_object"}`. If a future model doesn't, add a `no_json_mode` flag to the registry (same pattern as `no_temperature`).
- xAI reasoning models reject `presencePenalty`, `frequencyPenalty`, and `stop` parameters. The app doesn't use any of these, so no change needed.

### Memory Efficiency

For parallel runs on the same essay, the `Job` dataclass stores `source_text` once on the first job. Subsequent jobs in the same group reference the first job's text via `group_id` lookup in the `JobStore`. This avoids N copies of potentially large (50KB) essays in memory.

### Files Changed

| File | Change |
|------|--------|
| `backend/pipeline.py` | Model registry, client cache, `_call_model` takes model name not client, `run_pipeline` takes model names + `reuse_stages`, delete `_map_model_for_openai`/`_map_model_for_xai`/`_PRICING`/`_OPENAI_NO_TEMPERATURE` (consolidated into registry) |
| `backend/main.py` | `/analyze` accepts configurations array + `reuse_trajectory`, spawns parallel jobs, new `/trajectories`, `/trajectories/{id}`, `/models` endpoints, backwards-compat shim with `_PROVIDER_DEFAULTS`, trajectory saving, email-once-per-group logic |
| `backend/jobs.py` | Job dataclass gets `group_id`, `workhorse_model`, `synthesis_model`, `trajectory_id` fields. `JobStore` gets `get_group(group_id)` method. Source text shared across group. |
| `.gitignore` | Add `trajectories/` |
| `frontend/src/components/InputForm.jsx` | Two model dropdowns, add/remove configuration rows, fetch from `/models` |
| `frontend/src/hooks/useApiSettings.js` | Manage configurations array instead of single provider |
| `frontend/src/api.js` | `submitJob` sends configurations array, new `fetchTrajectories`/`fetchTrajectory`/`fetchModels` functions |
| `frontend/src/hooks/useJobStream.js` | Handle multiple SSE streams, track per-job progress |
| `frontend/src/components/ProgressTracker.jsx` | Show multi-pipeline progress with per-config labels |
| `frontend/src/components/ResultsView.jsx` | Version navigator bar, re-synthesize button, replace hardcoded workflow display with model names from trajectory metadata |
| `frontend/src/hooks/useResultRouting.js` | Load group info for version navigation |
