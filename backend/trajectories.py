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


def _validate_id(trajectory_id: str) -> None:
    """Guard against path traversal in trajectory IDs."""
    if "/" in trajectory_id or "\\" in trajectory_id or ".." in trajectory_id:
        raise ValueError(f"Invalid trajectory ID: {trajectory_id}")


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
    _validate_id(trajectory_id)
    path = _ensure_dir() / f"{trajectory_id}.json"
    path.write_text(json.dumps(trajectory, indent=2))
    logger.info("Saved trajectory %s to %s", trajectory_id, path)
    return path


def load_trajectory(trajectory_id: str) -> dict:
    """Load a trajectory by ID. Raises FileNotFoundError or ValueError on problems."""
    _validate_id(trajectory_id)
    path = TRAJECTORIES_DIR / f"{trajectory_id}.json"
    if not path.is_file():
        raise FileNotFoundError(f"Trajectory not found: {trajectory_id}")
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        raise ValueError(f"Corrupt trajectory file {trajectory_id}: {e}") from e
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
    for path in sorted(
        TRAJECTORIES_DIR.glob("t_*.json"), key=lambda p: p.stat().st_mtime, reverse=True
    ):
        try:
            data = json.loads(path.read_text())
            decomp = data.get("stages", {}).get("decomposition", {}).get("result", {})
            result.append({
                "trajectory_id": data["trajectory_id"],
                "analysis_id": data.get("analysis_id"),
                "created_at": data.get("created_at"),
                "workhorse_model": data.get("workhorse_model"),
                "synthesis_model": data.get("synthesis_model"),
                "source_text_hash": data.get("source_text_hash"),
                "group_id": data.get("group_id"),
                "estimated_cost": data.get("estimated_cost"),
                "essay_title": decomp.get("essay_title"),
                "essay_author": decomp.get("essay_author"),
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
