"""Tests for Claude Code CLI subprocess wrapper."""

from unittest.mock import AsyncMock, patch

import pytest

from backend.claude_code_runner import (
    _call_claude_code,
    _get_cli_model_name,
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
    mock_proc = AsyncMock()
    mock_proc.returncode = 0
    mock_proc.communicate = AsyncMock(return_value=(b'{"thesis": "test"}', b""))

    with patch("asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
        text, usage = await _call_claude_code(
            model="claude-sonnet-4-6",
            system_prompt="You are an economist.",
            user_prompt="Analyze this.",
            temperature=0.2,
            max_tokens=4096,
        )

        assert text == '{"thesis": "test"}'
        assert usage["model"] == "claude-sonnet-4-6"
        assert usage["input_tokens"] > 0
        assert usage["output_tokens"] > 0
        # Verify claude was called with correct args
        call_args = mock_exec.call_args[0]
        assert "claude" in call_args
        assert "--model" in call_args
        assert "sonnet" in call_args


@pytest.mark.asyncio
async def test_call_claude_code_failure():
    """Test CLI failure raises RuntimeError."""
    mock_proc = AsyncMock()
    mock_proc.returncode = 1
    mock_proc.communicate = AsyncMock(return_value=(b"", b"Error: model not available"))

    with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
        with pytest.raises(RuntimeError, match="Claude Code CLI failed"):
            await _call_claude_code(
                model="claude-sonnet-4-6",
                system_prompt="test",
                user_prompt="test",
                temperature=0.2,
                max_tokens=4096,
            )
