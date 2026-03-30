"""Tests for LLM prompt building — no real API calls made."""
from __future__ import annotations

import pytest

from app.analysis.llm import (
    _build_corner_table,
    _build_corner_names_table,
    _build_gear_table,
    _build_lap_conditions_table,
    _build_sector_table,
    _build_user_prompt,
    _build_solo_prompt,
    SYSTEM_PROMPT,
)
from app.analysis.lap_metadata import normalize_lap_meta_dict
from tests.conftest import make_processed


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

class TestSystemPrompt:
    def test_loaded_and_non_empty(self):
        assert len(SYSTEM_PROMPT) > 100

    def test_mentions_motorsport_or_racing(self):
        lower = SYSTEM_PROMPT.lower()
        assert "motorsport" in lower or "racing" in lower or "lap" in lower

    def test_instructs_json_output(self):
        assert "JSON" in SYSTEM_PROMPT

    def test_no_trailing_whitespace_lines(self):
        for line in SYSTEM_PROMPT.splitlines():
            assert line == line.rstrip(), f"Trailing whitespace on: {line!r}"


# ---------------------------------------------------------------------------
# _build_corner_table
# ---------------------------------------------------------------------------

class TestBuildCornerTable:
    def test_returns_string(self):
        assert isinstance(_build_corner_table(make_processed(), []), str)

    def test_contains_t_prefixed_corner_labels(self):
        result = _build_corner_table(make_processed(), [])
        assert "T1" in result
        assert "T2" in result

    def test_no_c_prefix_corner_labels(self):
        result = _build_corner_table(make_processed(), [])
        # Should never use the old C-prefix style
        import re
        c_labels = re.findall(r'\bC\d+\b', result)
        assert c_labels == [], f"Found C-prefix labels: {c_labels}"

    def test_fallback_message_when_no_corners(self):
        processed = make_processed()
        processed["corners"] = []
        result = _build_corner_table(processed, [])
        assert "No corner" in result

    def test_contains_speed_header(self):
        result = _build_corner_table(make_processed(), [])
        # Column header is "min spd" (abbreviated)
        assert "spd" in result.lower() or "speed" in result.lower()

    def test_includes_braking_and_throttle_columns(self):
        result = _build_corner_table(make_processed(), [])
        assert "Braking" in result or "braking" in result.lower()
        assert "Throttle" in result or "throttle" in result.lower()

    def test_includes_corner_names_when_available(self):
        result = _build_corner_table(make_processed(), [])
        assert "Andretti Hairpin" in result


class TestBuildCornerNamesTable:
    def test_returns_string(self):
        assert isinstance(_build_corner_names_table(make_processed()), str)

    def test_contains_named_corners(self):
        result = _build_corner_names_table(make_processed())
        assert "Andretti Hairpin" in result
        assert "Rainey Curve" in result

    def test_fallback_when_no_corners(self):
        processed = make_processed()
        processed["corners"] = []
        result = _build_corner_names_table(processed)
        assert "No corner" in result


# ---------------------------------------------------------------------------
# _build_gear_table
# ---------------------------------------------------------------------------

class TestBuildGearTable:
    def test_returns_string(self):
        assert isinstance(_build_gear_table(make_processed()), str)

    def test_contains_corner_labels(self):
        result = _build_gear_table(make_processed())
        assert "T1" in result

    def test_fallback_when_no_gear_data(self):
        processed = make_processed()
        processed["user_lap"] = {k: v for k, v in processed["user_lap"].items() if k != "gear"}
        result = _build_gear_table(processed)
        assert "No gear" in result

    def test_fallback_when_no_corners(self):
        processed = make_processed()
        processed["corners"] = []
        result = _build_gear_table(processed)
        assert "No corner" in result


# ---------------------------------------------------------------------------
# _build_sector_table
# ---------------------------------------------------------------------------

class TestBuildSectorTable:
    def test_returns_string(self):
        assert isinstance(_build_sector_table(make_processed()), str)

    def test_contains_sector_labels(self):
        result = _build_sector_table(make_processed())
        assert "S1" in result
        assert "S2" in result
        assert "S3" in result

    def test_shows_delta_signs(self):
        result = _build_sector_table(make_processed())
        # Sector 1 has +500 ms delta, sector 3 has -500 ms
        assert "+" in result
        assert "-" in result

    def test_fallback_when_no_sectors(self):
        processed = make_processed()
        processed["sectors"] = []
        result = _build_sector_table(processed)
        assert "No sector" in result


class TestLapConditionsHelpers:
    def test_builds_conditions_table(self):
        result = _build_lap_conditions_table([
            {
                "id": "lap-1",
                "role": "user",
                "driver_name": "Driver A",
                "conditions": {
                    "weather": "Overcast",
                    "air_temp_c": 18.5,
                    "track_temp_c": 24.0,
                },
            }
        ])
        assert "Overcast" in result
        assert "18.5C" in result
        assert "24.0C" in result

    def test_normalizes_nested_conditions(self):
        normalized = normalize_lap_meta_dict({
            "id": "lap-1",
            "role": "user",
            "driver_name": " Driver A ",
            "conditions": {
                "weather": "Clear",
                "air_temp_c": 22.0,
                "humidity_pct": None,
            },
        })
        assert normalized["driver_name"] == "Driver A"
        assert normalized["conditions"] == {
            "weather": "Clear",
            "air_temp_c": 22.0,
        }


# ---------------------------------------------------------------------------
# _build_user_prompt (vs_reference mode)
# ---------------------------------------------------------------------------

class TestBuildUserPrompt:
    def test_returns_string(self):
        result = _build_user_prompt(make_processed(), [], "Car A", "Track B")
        assert isinstance(result, str)

    def test_contains_car_and_track_names(self):
        result = _build_user_prompt(make_processed(), [], "Formula Vee", "Watkins Glen")
        assert "Formula Vee" in result
        assert "Watkins Glen" in result

    def test_contains_json_schema_keys(self):
        result = _build_user_prompt(make_processed(), [], "Car", "Track")
        for key in ("improvement_areas", "driving_scores", "summary", "strengths"):
            assert key in result

    def test_contains_all_driving_score_metrics(self):
        result = _build_user_prompt(make_processed(), [], "Car", "Track")
        for metric in ("braking_points", "brake_application", "throttle_pickup", "steering"):
            assert metric in result

    def test_contains_corner_table(self):
        result = _build_user_prompt(make_processed(), [], "Car", "Track")
        assert "T1" in result

    def test_includes_corner_names_section(self):
        result = _build_user_prompt(make_processed(), [], "Car", "Track")
        assert "Corner Names" in result
        assert "Andretti Hairpin" in result

    def test_does_not_mention_median(self):
        """vs_reference prompt should not use solo-mode language."""
        result = _build_user_prompt(make_processed(), [], "Car", "Track")
        # "median" is specific to solo mode context
        assert "median of all your" not in result.lower()

    def test_includes_lap_conditions_section(self):
        result = _build_user_prompt(
            make_processed(),
            [],
            "Car",
            "Track",
            [{"id": "lap-1", "role": "user", "driver_name": "Driver A", "conditions": {"weather": "Clear"}}],
        )
        assert "Lap Conditions" in result
        assert "Clear" in result


# ---------------------------------------------------------------------------
# _build_solo_prompt (session/solo mode)
# ---------------------------------------------------------------------------

class TestBuildSoloPrompt:
    def test_returns_string(self):
        result = _build_solo_prompt(make_processed(), [], "Car A", "Track B")
        assert isinstance(result, str)

    def test_contains_car_and_track_names(self):
        result = _build_solo_prompt(make_processed(), [], "MX-5", "Brands Hatch")
        assert "MX-5" in result
        assert "Brands Hatch" in result

    def test_includes_corner_names_section(self):
        result = _build_solo_prompt(make_processed(), [], "Car", "Track")
        assert "Corner Names" in result
        assert "Rainey Curve" in result

    def test_uses_median_language(self):
        result = _build_solo_prompt(make_processed(), [], "Car", "Track")
        assert "median" in result.lower()

    def test_instructs_not_to_mention_reference_driver(self):
        """Solo prompt should explicitly tell Claude not to use 'reference driver' language."""
        result = _build_solo_prompt(make_processed(), [], "Car", "Track")
        # The instruction "Do NOT mention" must be present
        assert "do not mention" in result.lower() or "not mention" in result.lower()

    def test_contains_driving_scores_schema(self):
        result = _build_solo_prompt(make_processed(), [], "Car", "Track")
        for metric in ("driving_scores", "braking_points", "brake_application",
                        "throttle_pickup", "steering"):
            assert metric in result

    def test_contains_json_schema_keys(self):
        result = _build_solo_prompt(make_processed(), [], "Car", "Track")
        for key in ("improvement_areas", "summary", "sector_notes"):
            assert key in result

    def test_score_meaning_text_present(self):
        """Should explain what the scores mean in solo/consistency context."""
        result = _build_solo_prompt(make_processed(), [], "Car", "Track")
        assert "consistent" in result.lower() or "consistency" in result.lower()

    def test_mentions_condition_context(self):
        result = _build_solo_prompt(
            make_processed(),
            [],
            "Car",
            "Track",
            [{"id": "lap-1", "role": "user", "driver_name": "Driver A", "conditions": {"weather": "Rain"}}],
        )
        assert "Rain" in result
        assert "condition" in result.lower()
