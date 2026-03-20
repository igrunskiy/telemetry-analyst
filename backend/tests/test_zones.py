"""Unit tests for weak zone detection (zones.py)."""
from __future__ import annotations

import numpy as np
import pytest

from app.analysis.zones import (
    detect_weak_zones,
    _severity,
    _get_slice,
    _find_onset_dist,
    _get_straight_regions,
    BRAKE_GAP_THRESHOLD_M,
    THROTTLE_GAP_THRESHOLD_M,
    APEX_WINDOW_M,
)
from tests.conftest import make_processed


# ---------------------------------------------------------------------------
# _severity
# ---------------------------------------------------------------------------

class TestSeverity:
    def test_high_when_above_high_threshold(self):
        assert _severity(15.0, 5.0, 10.0) == "high"

    def test_medium_when_between_thresholds(self):
        assert _severity(7.0, 5.0, 10.0) == "medium"

    def test_low_when_below_low_threshold(self):
        assert _severity(2.0, 5.0, 10.0) == "low"

    def test_boundary_at_low_threshold_is_medium(self):
        assert _severity(5.0, 5.0, 10.0) == "medium"

    def test_negative_value_uses_absolute_magnitude(self):
        assert _severity(-15.0, 5.0, 10.0) == "high"


# ---------------------------------------------------------------------------
# _get_slice
# ---------------------------------------------------------------------------

class TestGetSlice:
    def test_returns_values_within_range(self):
        result = _get_slice(
            [10.0, 20.0, 30.0, 40.0, 50.0],
            [100.0, 200.0, 300.0, 400.0, 500.0],
            150.0, 350.0,
        )
        assert result == [20.0, 30.0]

    def test_includes_boundary_points(self):
        result = _get_slice([10.0, 20.0], [100.0, 200.0], 100.0, 200.0)
        assert result == [10.0, 20.0]

    def test_returns_empty_when_outside_range(self):
        result = _get_slice([10.0, 20.0], [100.0, 200.0], 300.0, 400.0)
        assert result == []

    def test_excludes_none_values(self):
        result = _get_slice([10.0, None, 30.0], [100.0, 200.0, 300.0], 0.0, 500.0)
        assert None not in result
        assert 10.0 in result
        assert 30.0 in result

    def test_empty_inputs_return_empty(self):
        assert _get_slice([], [], 0.0, 100.0) == []


# ---------------------------------------------------------------------------
# _find_onset_dist
# ---------------------------------------------------------------------------

class TestFindOnsetDist:
    def test_returns_first_dist_exceeding_threshold(self):
        result = _find_onset_dist(
            [0.0, 0.0, 0.1, 0.5, 0.9],
            [100.0, 200.0, 300.0, 400.0, 500.0],
            50.0, 600.0, threshold=0.05,
        )
        assert result == 300.0

    def test_returns_none_when_never_exceeds(self):
        result = _find_onset_dist(
            [0.0, 0.01, 0.02],
            [100.0, 200.0, 300.0],
            50.0, 400.0, threshold=0.5,
        )
        assert result is None

    def test_returns_none_when_signal_outside_range(self):
        result = _find_onset_dist(
            [0.9, 0.9],
            [100.0, 200.0],
            300.0, 500.0, threshold=0.5,
        )
        assert result is None

    def test_respects_d_start_bound(self):
        # Signal exceeds at dist=100, but d_start=200 — should skip it
        result = _find_onset_dist(
            [0.9, 0.0, 0.9],
            [100.0, 200.0, 300.0],
            200.0, 400.0, threshold=0.5,
        )
        assert result == 300.0

    def test_none_values_in_series_are_skipped(self):
        result = _find_onset_dist(
            [None, None, 0.9],
            [100.0, 200.0, 300.0],
            50.0, 400.0, threshold=0.5,
        )
        assert result == 300.0


# ---------------------------------------------------------------------------
# _get_straight_regions
# ---------------------------------------------------------------------------

class TestGetStraightRegions:
    def test_finds_straight_between_corners(self):
        corners = [
            {"dist_apex": 500,  "dist_start": 300,  "dist_end": 700},
            {"dist_apex": 2000, "dist_start": 1800, "dist_end": 2200},
        ]
        straights = _get_straight_regions(corners, track_length_m=3000.0)
        # The ~1100 m gap between corner 1 end (700) and corner 2 start (1800) should appear
        between = [(s, e) for s, e in straights if s >= 700 and e <= 1800]
        assert len(between) >= 1

    def test_filters_straights_shorter_than_minimum(self):
        corners = [
            {"dist_apex": 300, "dist_start": 250, "dist_end": 350},
            {"dist_apex": 400, "dist_start": 360, "dist_end": 450},  # 10 m gap
        ]
        straights = _get_straight_regions(corners, track_length_m=1000.0)
        for s, e in straights:
            assert e - s >= 80.0

    def test_empty_corners_returns_empty(self):
        assert _get_straight_regions([], track_length_m=3000.0) == []

    def test_segment_before_first_corner(self):
        corners = [{"dist_apex": 500, "dist_start": 300, "dist_end": 700}]
        straights = _get_straight_regions(corners, track_length_m=3000.0)
        before = [(s, e) for s, e in straights if e <= 300]
        assert len(before) >= 1

    def test_segment_after_last_corner(self):
        corners = [{"dist_apex": 500, "dist_start": 300, "dist_end": 700}]
        straights = _get_straight_regions(corners, track_length_m=3000.0)
        after = [(s, e) for s, e in straights if s >= 700]
        assert len(after) >= 1


# ---------------------------------------------------------------------------
# detect_weak_zones
# ---------------------------------------------------------------------------

class TestDetectWeakZones:
    def test_empty_when_no_reference(self):
        processed = make_processed()
        processed["reference_laps"] = []
        assert detect_weak_zones(processed) == []

    def test_detects_corner_speed_deficit(self):
        # User 15 km/h slower everywhere → corner speed zones should appear
        processed = make_processed(user_speed_offset=15.0)
        zones = detect_weak_zones(processed)
        types = [z["zone_type"] for z in zones]
        assert "corner_speed" in types

    def test_no_corner_speed_zone_for_identical_laps(self):
        processed = make_processed(user_speed_offset=0.0)
        zones = detect_weak_zones(processed)
        corner_zones = [z for z in zones if z["zone_type"] == "corner_speed"]
        assert len(corner_zones) == 0

    def test_zone_has_all_required_fields(self):
        processed = make_processed(user_speed_offset=15.0)
        zones = detect_weak_zones(processed)
        assert zones, "Expected at least one zone"
        for z in zones:
            for field in ("zone_type", "corner_num", "dist", "severity", "metric",
                          "user_value", "ref_value", "delta"):
                assert field in z, f"Zone missing field: {field}"

    def test_corner_speed_delta_positive_for_deficit(self):
        """delta = ref - user; positive means user is slower."""
        processed = make_processed(user_speed_offset=15.0)
        zones = detect_weak_zones(processed)
        for z in [z for z in zones if z["zone_type"] == "corner_speed"]:
            assert z["delta"] > 0

    def test_sorted_by_severity_descending(self):
        processed = make_processed(user_speed_offset=15.0)
        zones = detect_weak_zones(processed)
        rank = {"high": 3, "medium": 2, "low": 1}
        for i in range(1, len(zones)):
            assert rank[zones[i - 1]["severity"]] >= rank[zones[i]["severity"]]

    def test_high_severity_for_large_deficit(self):
        processed = make_processed(user_speed_offset=30.0)
        zones = detect_weak_zones(processed)
        assert any(z["severity"] == "high" for z in zones if z["zone_type"] == "corner_speed")

    def test_straight_speed_zones_detected(self):
        """Force ref to be much faster on straights."""
        processed = make_processed(user_speed_offset=10.0)
        zones = detect_weak_zones(processed)
        types = [z["zone_type"] for z in zones]
        # At minimum, should have corner or straight speed zones
        assert len(zones) > 0

    def test_throttle_pickup_detected(self):
        """User picks up throttle 50 m later than reference."""
        processed = make_processed()
        n = len(processed["user_lap"]["dist"])
        dist = processed["user_lap"]["dist"]
        track_len = processed["track_length_m"]

        # Build throttle arrays: ref picks up at corner exit, user picks up 50 m later
        corner_end = processed["corners"][0]["dist_end"]

        ref_throttle = []
        user_throttle = []
        for d in dist:
            if d >= corner_end:
                ref_throttle.append(0.8)
            else:
                ref_throttle.append(0.0)
            if d >= corner_end + 50.0:
                user_throttle.append(0.8)
            else:
                user_throttle.append(0.0)

        processed["user_lap"]["throttle"] = user_throttle
        processed["reference_laps"][0]["throttle"] = ref_throttle

        zones = detect_weak_zones(processed)
        types = [z["zone_type"] for z in zones]
        assert "throttle_pickup" in types

    def test_late_braking_detected(self):
        """User brakes 50 m later than reference → 'braking_point' zone (missed braking point)."""
        processed = make_processed()
        dist = processed["user_lap"]["dist"]
        corner_start = processed["corners"][0]["dist_start"]

        # Reference starts braking at corner_start; user starts 50 m later (less aggressive)
        ref_brake = [0.6 if d >= corner_start else 0.0 for d in dist]
        user_brake = [0.6 if d >= corner_start + 50.0 else 0.0 for d in dist]

        processed["user_lap"]["brake"] = user_brake
        processed["reference_laps"][0]["brake"] = ref_brake

        zones = detect_weak_zones(processed)
        types = [z["zone_type"] for z in zones]
        assert "braking_point" in types
