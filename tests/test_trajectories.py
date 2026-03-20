"""Tests for backend.trajectories — save, load, list, reuse."""

import pytest

from backend.trajectories import (
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
        "decomposition": {
            "model": "claude-sonnet-4-6",
            "result": {"thesis": "test"},
            "usage": {"input_tokens": 100, "output_tokens": 200},
            "timestamp": "2026-03-20T14:30:05Z",
        },
        "stage2": {
            "model": "claude-sonnet-4-6",
            "result": {
                "identities": {},
                "general_eq": {},
                "exog_endog": {},
                "quantitative": {},
                "consistency": {},
                "steelman": {},
            },
            "usage": {"input_tokens": 600, "output_tokens": 1200},
            "timestamp": "2026-03-20T14:31:00Z",
        },
        "dedup": {
            "model": "claude-sonnet-4-6",
            "result": {"merged": []},
            "usage": {"input_tokens": 100, "output_tokens": 200},
            "timestamp": "2026-03-20T14:32:00Z",
        },
        "synthesis": {
            "model": "claude-opus-4-6",
            "result": {"report": "test"},
            "usage": {"input_tokens": 200, "output_tokens": 400},
            "timestamp": "2026-03-20T14:33:00Z",
        },
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
