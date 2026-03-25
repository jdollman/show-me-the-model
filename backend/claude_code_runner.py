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
            cli_model,
            attempt + 1,
            retries + 1,
        )

        proc = await asyncio.create_subprocess_exec(
            "claude",
            "-p",
            "--model",
            cli_model,
            "--system-prompt",
            system_prompt,
            "--output-format",
            "text",
            "--bare",
            "--tools",
            "",
            "--permission-mode",
            "bypassPermissions",
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
        previous_text = text

        if not text:
            if attempt < retries:
                logger.warning("Empty response from CLI, retrying...")
                continue
            raise RuntimeError("Claude Code CLI returned empty response")

        # Try parsing JSON — if it works, return immediately
        try:
            json.loads(
                text.strip().removeprefix("```json").removeprefix("```").removesuffix("```")
            )
            break  # Valid JSON, exit retry loop
        except (json.JSONDecodeError, ValueError):
            if attempt < retries:
                logger.warning(
                    "JSON parse failed (attempt %d/%d), retrying...",
                    attempt + 1,
                    retries + 1,
                )
            else:
                break  # Return as-is on last attempt, let pipeline's _extract_json handle it

    # Estimate token usage (rough: 1 token ~ 4 chars, actual ~3.5 for English).
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
