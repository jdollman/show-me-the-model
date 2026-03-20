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
