"""Unit tests for TelemetryProcessor."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.analysis.processor import (
    TelemetryProcessor,
    _find_local_minima,
    INTERP_POINTS,
    DEFAULT_TRACK_LENGTH_M,
)
from tests.conftest import make_lap_csv


# ---------------------------------------------------------------------------
# parse_csv
# ---------------------------------------------------------------------------

class TestParseCsv:
    def test_parses_standard_columns(self):
        proc = TelemetryProcessor()
        df = proc.parse_csv(make_lap_csv())
        assert "LapDistPct" in df.columns
        assert "Speed" in df.columns
        assert not df.empty

    def test_resolves_alias_columns(self):
        proc = TelemetryProcessor()
        df = proc.parse_csv(make_lap_csv(use_alias_columns=True))
        assert "LapDistPct" in df.columns
        assert "Speed" in df.columns
        assert "Throttle" in df.columns
        assert "Brake" in df.columns

    def test_raises_on_missing_lapdistpct(self):
        proc = TelemetryProcessor()
        bad = "Speed,Throttle,Brake\n100,0.5,0.0\n120,0.8,0.0\n"
        with pytest.raises(ValueError, match="LapDistPct"):
            proc.parse_csv(bad)

    def test_raises_on_empty_input(self):
        proc = TelemetryProcessor()
        with pytest.raises((ValueError, Exception)):
            proc.parse_csv("")

    def test_converts_speed_ms_to_kmh(self):
        """Values < 130 are assumed m/s → multiply by 3.6."""
        proc = TelemetryProcessor()
        df = proc.parse_csv(make_lap_csv(speed_in_ms=True))
        assert df["Speed"].max() > 130

    def test_does_not_double_convert_kmh(self):
        proc = TelemetryProcessor()
        df = proc.parse_csv(make_lap_csv(speed_in_ms=False))
        # Original max was ~200 km/h, should stay < 300 after parse
        assert df["Speed"].max() < 300

    def test_drops_rows_with_null_lapdistpct(self):
        proc = TelemetryProcessor()
        import io
        import pandas as pd_inner
        good = pd.DataFrame({
            "LapDistPct": [0.0, None, 0.5, 1.0],
            "Speed": [100.0, 120.0, 80.0, 150.0],
        })
        df = proc.parse_csv(good.to_csv(index=False))
        assert df["LapDistPct"].isna().sum() == 0


# ---------------------------------------------------------------------------
# detect_track_length
# ---------------------------------------------------------------------------

class TestDetectTrackLength:
    def test_returns_raw_max_when_over_500(self):
        proc = TelemetryProcessor()
        df = pd.DataFrame({"LapDistPct": np.linspace(0, 4327, 100)})
        assert proc.detect_track_length(df) == pytest.approx(4327, rel=0.01)

    def test_returns_default_when_under_500(self):
        proc = TelemetryProcessor()
        df = pd.DataFrame({"LapDistPct": np.linspace(0, 1, 100)})
        assert proc.detect_track_length(df) == DEFAULT_TRACK_LENGTH_M

    def test_threshold_at_exactly_500(self):
        proc = TelemetryProcessor()
        # max == 500 → not > 500 → should return default
        df = pd.DataFrame({"LapDistPct": np.linspace(0, 500, 100)})
        assert proc.detect_track_length(df) == DEFAULT_TRACK_LENGTH_M


# ---------------------------------------------------------------------------
# normalize_by_distance
# ---------------------------------------------------------------------------

class TestNormalizeByDistance:
    def test_output_has_interp_points_rows(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        assert len(df) == INTERP_POINTS

    def test_lapdistpct_is_zero_to_one(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        assert df["LapDistPct"].min() >= 0.0
        assert df["LapDistPct"].max() <= 1.0

    def test_normalises_0_to_100_input(self):
        proc = TelemetryProcessor()
        raw = pd.DataFrame({
            "LapDistPct": np.linspace(0, 100, 200),
            "Speed": np.linspace(80, 200, 200),
        })
        df = proc.normalize_by_distance(raw)
        assert df["LapDistPct"].max() <= 1.0

    def test_normalises_metres_input(self):
        proc = TelemetryProcessor()
        raw = pd.DataFrame({
            "LapDistPct": np.linspace(0, 4200, 200),
            "Speed": np.full(200, 120.0),
        })
        df = proc.normalize_by_distance(raw)
        assert df["LapDistPct"].max() <= 1.0

    def test_preserves_speed_column(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        assert "Speed" in df.columns
        assert not df["Speed"].isna().all()

    def test_output_is_monotonically_increasing(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        diffs = np.diff(df["LapDistPct"].values)
        assert (diffs >= 0).all()


# ---------------------------------------------------------------------------
# compute_delta
# ---------------------------------------------------------------------------

class TestComputeDelta:
    def _norm_pair(self, speed_offset: float = 0.0):
        proc = TelemetryProcessor()
        user_df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        ref_df = user_df.copy()
        ref_df["Speed"] = ref_df["Speed"] + speed_offset
        return proc, user_df, ref_df

    def test_positive_delta_when_ref_faster(self):
        proc, user_df, ref_df = self._norm_pair(speed_offset=10.0)
        delta = proc.compute_delta(user_df, ref_df)
        assert delta["speed_delta"].mean() == pytest.approx(10.0, abs=0.5)

    def test_negative_delta_when_user_faster(self):
        proc, user_df, ref_df = self._norm_pair(speed_offset=-10.0)
        delta = proc.compute_delta(user_df, ref_df)
        assert delta["speed_delta"].mean() == pytest.approx(-10.0, abs=0.5)

    def test_zero_delta_for_identical_laps(self):
        proc, user_df, ref_df = self._norm_pair(speed_offset=0.0)
        delta = proc.compute_delta(user_df, ref_df)
        assert delta["speed_delta"].abs().max() < 1e-9

    def test_all_channels_present(self):
        proc, user_df, ref_df = self._norm_pair()
        delta = proc.compute_delta(user_df, ref_df)
        for col in ("speed_delta", "throttle_delta", "brake_delta"):
            assert col in delta.columns

    def test_length_matches_input(self):
        proc, user_df, ref_df = self._norm_pair()
        delta = proc.compute_delta(user_df, ref_df)
        assert len(delta) == INTERP_POINTS


# ---------------------------------------------------------------------------
# median_laps
# ---------------------------------------------------------------------------

class TestMedianLaps:
    def test_single_lap_returned_unchanged(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        result = proc.median_laps([df])
        pd.testing.assert_frame_equal(result, df)

    def test_median_of_three_is_middle_value(self):
        proc = TelemetryProcessor()
        base = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        low = base.copy(); low["Speed"] = base["Speed"] - 10
        high = base.copy(); high["Speed"] = base["Speed"] + 10
        result = proc.median_laps([low, base, high])
        pd.testing.assert_series_equal(
            result["Speed"], base["Speed"], check_names=False
        )

    def test_median_not_skewed_by_outlier(self):
        proc = TelemetryProcessor()
        base = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        outlier = base.copy(); outlier["Speed"] = base["Speed"] + 1000
        result = proc.median_laps([base, base.copy(), outlier])
        # Median should stay close to base, not pulled toward outlier
        assert result["Speed"].mean() < base["Speed"].mean() + 10

    def test_two_laps_returns_midpoint(self):
        proc = TelemetryProcessor()
        base = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        shifted = base.copy(); shifted["Speed"] = base["Speed"] + 20
        result = proc.median_laps([base, shifted])
        expected = (base["Speed"] + shifted["Speed"]) / 2
        pd.testing.assert_series_equal(result["Speed"], expected, check_names=False)


# ---------------------------------------------------------------------------
# identify_corners
# ---------------------------------------------------------------------------

class TestIdentifyCorners:
    def test_detects_at_least_one_corner(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        corners = proc.identify_corners(df)
        assert len(corners) >= 1

    def test_corner_nums_are_sequential_from_one(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        corners = proc.identify_corners(df)
        for i, c in enumerate(corners):
            assert c["corner_num"] == i + 1

    def test_corner_label_uses_T_prefix(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        corners = proc.identify_corners(df)
        for c in corners:
            assert c["label"] == f"T{c['corner_num']}"

    def test_all_required_fields_present(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        corners = proc.identify_corners(df)
        for c in corners:
            for field in ("corner_num", "dist_start", "dist_apex", "dist_end", "min_speed", "label"):
                assert field in c, f"Missing field: {field}"

    def test_apex_dist_between_start_and_end(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        corners = proc.identify_corners(df, track_length_m=3000.0)
        for c in corners:
            assert c["dist_start"] <= c["dist_apex"] <= c["dist_end"]

    def test_no_corners_without_speed_column(self):
        proc = TelemetryProcessor()
        df = pd.DataFrame({"LapDistPct": np.linspace(0, 1, 100)})
        assert proc.identify_corners(df) == []


# ---------------------------------------------------------------------------
# _find_local_minima
# ---------------------------------------------------------------------------

class TestFindLocalMinima:
    def test_finds_single_obvious_minimum(self):
        signal = np.array([10, 9, 8, 7, 3, 7, 8, 9, 10, 10, 10, 10, 10, 10, 10], dtype=float)
        result = _find_local_minima(signal, min_gap=3)
        assert 4 in result

    def test_finds_multiple_minima(self):
        x = np.linspace(0, 4 * np.pi, 600)
        signal = 10 + np.cos(x) * 4
        result = _find_local_minima(signal, min_gap=60)
        assert len(result) >= 2

    def test_enforces_minimum_gap(self):
        x = np.linspace(0, 4 * np.pi, 600)
        signal = 10 + np.cos(x) * 4
        result = _find_local_minima(signal, min_gap=60)
        for i in range(1, len(result)):
            assert result[i] - result[i - 1] >= 60

    def test_flat_signal_returns_empty(self):
        signal = np.ones(200)
        assert _find_local_minima(signal, min_gap=10) == []

    def test_prefers_deeper_minimum_within_gap(self):
        # Two close minima: the second is deeper
        signal = np.ones(100) * 10.0
        signal[40] = 5.0
        signal[45] = 2.0  # deeper, within gap of first
        result = _find_local_minima(signal, min_gap=20)
        if result:
            assert 45 in result


# ---------------------------------------------------------------------------
# compute_time_delta
# ---------------------------------------------------------------------------

class TestComputeTimeDelta:
    def test_zero_for_identical_laps(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        delta = proc.compute_time_delta(df, df)
        assert abs(delta[-1]) < 0.5  # near-zero final delta

    def test_positive_when_user_slower(self):
        proc = TelemetryProcessor()
        user_df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        ref_df = user_df.copy()
        ref_df["Speed"] = user_df["Speed"] * 1.05
        delta = proc.compute_time_delta(user_df, ref_df)
        assert delta[-1] > 0

    def test_negative_when_user_faster(self):
        proc = TelemetryProcessor()
        user_df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        ref_df = user_df.copy()
        ref_df["Speed"] = user_df["Speed"] * 0.95
        delta = proc.compute_time_delta(user_df, ref_df)
        assert delta[-1] < 0

    def test_output_length_is_interp_points(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        delta = proc.compute_time_delta(df, df)
        assert len(delta) == INTERP_POINTS

    def test_cumulative_monotone_for_constant_deficit(self):
        """If user is consistently slower, cumulative delta should be monotone."""
        proc = TelemetryProcessor()
        user_df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        ref_df = user_df.copy()
        ref_df["Speed"] = user_df["Speed"] + 20  # ref always faster
        delta = proc.compute_time_delta(user_df, ref_df)
        diffs = np.diff(delta)
        assert (diffs >= -0.1).all(), "Cumulative delta should be mostly non-decreasing"


# ---------------------------------------------------------------------------
# compute_sectors
# ---------------------------------------------------------------------------

class TestComputeSectors:
    def test_returns_n_sectors(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        assert len(proc.compute_sectors(df, df, n_sectors=3)) == 3
        assert len(proc.compute_sectors(df, df, n_sectors=5)) == 5

    def test_sector_fields_present(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        for s in proc.compute_sectors(df, df):
            for f in ("sector", "user_time_ms", "ref_time_ms", "delta_ms"):
                assert f in s

    def test_sequential_sector_numbering(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        for i, s in enumerate(proc.compute_sectors(df, df, n_sectors=4)):
            assert s["sector"] == i + 1

    def test_zero_delta_for_identical_laps(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        for s in proc.compute_sectors(df, df, n_sectors=3):
            assert abs(s["delta_ms"]) <= 1

    def test_positive_sector_times(self):
        proc = TelemetryProcessor()
        df = proc.normalize_by_distance(proc.parse_csv(make_lap_csv()))
        for s in proc.compute_sectors(df, df, n_sectors=3):
            assert s["user_time_ms"] > 0
            assert s["ref_time_ms"] > 0


# ---------------------------------------------------------------------------
# process_laps (integration)
# ---------------------------------------------------------------------------

class TestProcessLaps:
    def test_expected_top_level_keys(self):
        proc = TelemetryProcessor()
        result = proc.process_laps(make_lap_csv(), [make_lap_csv()])
        for key in ("user_lap", "reference_laps", "delta", "corners", "sectors", "track_length_m"):
            assert key in result

    def test_user_lap_speed_length(self):
        proc = TelemetryProcessor()
        result = proc.process_laps(make_lap_csv(), [make_lap_csv()])
        assert len(result["user_lap"]["speed"]) == INTERP_POINTS

    def test_delta_arrays_same_length(self):
        proc = TelemetryProcessor()
        result = proc.process_laps(make_lap_csv(), [make_lap_csv()])
        n = len(result["delta"]["speed_delta"])
        assert len(result["delta"]["throttle_delta"]) == n
        assert len(result["delta"]["brake_delta"]) == n

    def test_solo_mode_runs_without_error(self):
        proc = TelemetryProcessor()
        result = proc.process_laps(
            make_lap_csv(), [make_lap_csv(), make_lap_csv()], analysis_mode="solo"
        )
        assert len(result["delta"]["speed_delta"]) == INTERP_POINTS

    def test_no_reference_returns_empty_delta(self):
        proc = TelemetryProcessor()
        result = proc.process_laps(make_lap_csv(), [])
        assert result["delta"] == {}

    def test_bad_reference_csv_skipped(self):
        proc = TelemetryProcessor()
        bad = "not,valid,telemetry\n1,2,3\n"
        # Should not raise — bad CSV is silently skipped
        result = proc.process_laps(make_lap_csv(), [bad])
        assert "user_lap" in result

    def test_track_length_in_metres_detected(self):
        proc = TelemetryProcessor()
        result = proc.process_laps(
            make_lap_csv(track_length_m=4700.0),
            [make_lap_csv(track_length_m=4700.0)],
        )
        assert result["track_length_m"] == pytest.approx(4700.0, rel=0.02)

    def test_reference_laps_list_length(self):
        proc = TelemetryProcessor()
        result = proc.process_laps(make_lap_csv(), [make_lap_csv(), make_lap_csv()])
        assert len(result["reference_laps"]) == 2
