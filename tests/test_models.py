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
