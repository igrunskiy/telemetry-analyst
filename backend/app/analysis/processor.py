"""
Telemetry CSV processing for Garage61 lap data.

Handles:
- Parsing raw CSV text with flexible column name resolution
- Normalising lap distance to a 1000-point evenly-spaced grid
- Computing speed/throttle/brake deltas between a user lap and reference laps
- Identifying corner zones via local speed minima
"""

from __future__ import annotations

import io
from typing import Any

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Column name normalisation
# ---------------------------------------------------------------------------

# Maps canonical name -> list of possible CSV column names (case-insensitive)
_COLUMN_ALIASES: dict[str, list[str]] = {
    "LapDistPct": ["lapdistpct", "lap_dist_pct", "lapdist", "distance_pct", "dist_pct", "pct"],
    "Speed": ["speed", "velocity", "spd"],
    "Throttle": ["throttle", "throttleraw", "throttle_raw", "gas", "accel"],
    "Brake": ["brake", "brakeraw", "brake_raw", "braking"],
    "SteeringWheelAngle": ["steeringwheelangle", "steering_wheel_angle", "steer", "steering"],
    "RPM": ["rpm", "enginespeed", "engine_speed"],
    "Lat": ["lat", "latitude", "gpslat"],
    "Lon": ["lon", "lng", "longitude", "gpslon", "gpslong"],
    "Gear": ["gear", "currentgear", "current_gear"],
}


def _rename_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Rename columns to canonical names based on _COLUMN_ALIASES."""
    lower_to_actual = {c.lower().replace(" ", ""): c for c in df.columns}
    rename_map: dict[str, str] = {}

    for canonical, aliases in _COLUMN_ALIASES.items():
        if canonical in df.columns:
            continue  # already present
        for alias in aliases:
            key = alias.lower().replace(" ", "")
            if key in lower_to_actual:
                rename_map[lower_to_actual[key]] = canonical
                break

    return df.rename(columns=rename_map)


# ---------------------------------------------------------------------------
# TelemetryProcessor
# ---------------------------------------------------------------------------

INTERP_POINTS = 1000


class TelemetryProcessor:
    # ------------------------------------------------------------------
    # Parsing
    # ------------------------------------------------------------------

    def parse_csv(self, csv_text: str) -> pd.DataFrame:
        """
        Parse a Garage61 telemetry CSV string into a DataFrame.

        Applies column alias resolution and coerces numeric types.
        Raises ValueError if the resulting DataFrame is empty or
        LapDistPct cannot be resolved.
        """
        try:
            df = pd.read_csv(io.StringIO(csv_text), low_memory=False)
        except Exception as exc:
            raise ValueError(f"Failed to parse telemetry CSV: {exc}") from exc

        df = _rename_columns(df)

        if df.empty:
            raise ValueError("Telemetry CSV produced an empty DataFrame")

        if "LapDistPct" not in df.columns:
            raise ValueError(
                "Could not resolve a LapDistPct column from telemetry CSV. "
                f"Available columns: {list(df.columns)}"
            )

        # Coerce all recognised numeric columns
        for col in ["LapDistPct", "Speed", "Throttle", "Brake", "RPM", "Gear", "Lat", "Lon", "SteeringWheelAngle"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        df = df.dropna(subset=["LapDistPct"])
        return df

    # ------------------------------------------------------------------
    # Normalisation
    # ------------------------------------------------------------------

    def normalize_by_distance(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Ensure LapDistPct is 0–1, sort ascending, then interpolate all numeric
        columns to INTERP_POINTS evenly-spaced distance values.
        Returns a new DataFrame indexed by LapDistPct (0, 0.001, …, 1).
        """
        df = df.copy()

        # Normalise to 0–1 if stored as 0–100
        if df["LapDistPct"].max() > 1.5:
            df["LapDistPct"] = df["LapDistPct"] / 100.0

        df = df.sort_values("LapDistPct").reset_index(drop=True)
        df = df.drop_duplicates(subset=["LapDistPct"])

        target_dist = np.linspace(0.0, 1.0, INTERP_POINTS)

        numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        numeric_cols = [c for c in numeric_cols if c != "LapDistPct"]

        interpolated: dict[str, Any] = {"LapDistPct": target_dist}
        for col in numeric_cols:
            valid = df[["LapDistPct", col]].dropna()
            if len(valid) < 2:
                interpolated[col] = np.full(INTERP_POINTS, np.nan)
            else:
                interpolated[col] = np.interp(
                    target_dist,
                    valid["LapDistPct"].values,
                    valid[col].values,
                )

        return pd.DataFrame(interpolated)

    # ------------------------------------------------------------------
    # Delta computation
    # ------------------------------------------------------------------

    def compute_delta(
        self,
        user_df: pd.DataFrame,
        ref_df: pd.DataFrame,
    ) -> pd.DataFrame:
        """
        Subtract user values from reference values at identical LapDistPct points.

        Adds columns: speed_delta, throttle_delta, brake_delta.
        Positive delta means the reference is faster/more aggressive.
        Both DataFrames must already be normalised to the same distance grid.
        """
        delta = user_df.copy()

        if "Speed" in user_df.columns and "Speed" in ref_df.columns:
            delta["speed_delta"] = ref_df["Speed"].values - user_df["Speed"].values
        else:
            delta["speed_delta"] = np.nan

        if "Throttle" in user_df.columns and "Throttle" in ref_df.columns:
            delta["throttle_delta"] = ref_df["Throttle"].values - user_df["Throttle"].values
        else:
            delta["throttle_delta"] = np.nan

        if "Brake" in user_df.columns and "Brake" in ref_df.columns:
            delta["brake_delta"] = ref_df["Brake"].values - user_df["Brake"].values
        else:
            delta["brake_delta"] = np.nan

        return delta

    # ------------------------------------------------------------------
    # Corner detection
    # ------------------------------------------------------------------

    def identify_corners(self, df: pd.DataFrame) -> list[dict]:
        """
        Detect corners by finding local speed minima in the normalised trace.

        Returns a list of corner dicts:
          {corner_num, dist_start, dist_apex, dist_end, min_speed, label}
        """
        if "Speed" not in df.columns:
            return []

        speed = df["Speed"].ffill().bfill().values
        dist = df["LapDistPct"].values

        # Smooth speed to reduce noise
        window = max(5, len(speed) // 50)
        kernel = np.ones(window) / window
        smoothed = np.convolve(speed, kernel, mode="same")

        # Find local minima with a minimum prominence
        minima_indices = _find_local_minima(smoothed, min_gap=len(speed) // 40)

        corners = []
        for i, apex_idx in enumerate(minima_indices):
            apex_dist = float(dist[apex_idx])
            min_speed = float(smoothed[apex_idx])

            # Corner start: find where speed starts dropping (last local max before apex)
            start_idx = max(0, apex_idx - len(speed) // 20)
            # Corner end: find where speed recovers (next local max after apex)
            end_idx = min(len(speed) - 1, apex_idx + len(speed) // 20)

            corners.append(
                {
                    "corner_num": i + 1,
                    "dist_start": float(dist[start_idx]),
                    "dist_apex": apex_dist,
                    "dist_end": float(dist[end_idx]),
                    "min_speed": min_speed,
                    "label": f"T{i + 1}",
                }
            )

        return corners

    # ------------------------------------------------------------------
    # Orchestration
    # ------------------------------------------------------------------

    def process_laps(
        self,
        user_csv: str,
        reference_csvs: list[str],
    ) -> dict:
        """
        Full processing pipeline:
        1. Parse all CSVs
        2. Normalise to 1000-point distance grid
        3. Pick best reference (longest CSV / first available)
        4. Compute delta vs best reference
        5. Identify corners on the user trace
        6. Return structured result

        Returns:
          {
            user_lap: {dist, speed, throttle, brake, rpm, gear, lat, lon},
            reference_laps: [ same structure per reference ],
            delta: {dist, speed_delta, throttle_delta, brake_delta},
            corners: [ corner dicts ],
            track_coordinates: [ {lat, lon} ] or [],
          }
        """
        # Parse
        user_df_raw = self.parse_csv(user_csv)
        user_df = self.normalize_by_distance(user_df_raw)

        ref_dfs: list[pd.DataFrame] = []
        for csv_text in reference_csvs:
            try:
                raw = self.parse_csv(csv_text)
                ref_dfs.append(self.normalize_by_distance(raw))
            except ValueError:
                continue  # skip unparseable references

        if not ref_dfs:
            # No valid references; return user lap only with empty delta/corners
            return self._build_result(user_df, [], None)

        # Best reference = first (assumed to be sorted by fastest lap time)
        best_ref = ref_dfs[0]

        delta_df = self.compute_delta(user_df, best_ref)
        corners = self.identify_corners(user_df)

        return self._build_result(user_df, ref_dfs, delta_df, corners)

    # ------------------------------------------------------------------
    # Result serialisation
    # ------------------------------------------------------------------

    def _df_to_series(self, df: pd.DataFrame) -> dict:
        """Extract key telemetry series from a normalised DataFrame."""
        def _col(name: str) -> list:
            if name in df.columns:
                return df[name].where(df[name].notna(), other=None).tolist()
            return []

        result = {
            "dist": _col("LapDistPct"),
            "speed": _col("Speed"),
            "throttle": _col("Throttle"),
            "brake": _col("Brake"),
            "rpm": _col("RPM"),
            "gear": _col("Gear"),
        }

        # Track coordinates (lat/lon)
        if "Lat" in df.columns and "Lon" in df.columns:
            result["lat"] = _col("Lat")
            result["lon"] = _col("Lon")

        return result

    def _build_result(
        self,
        user_df: pd.DataFrame,
        ref_dfs: list[pd.DataFrame],
        delta_df: pd.DataFrame | None,
        corners: list[dict] | None = None,
    ) -> dict:
        track_coords: list[dict] = []
        if "Lat" in user_df.columns and "Lon" in user_df.columns:
            lats = user_df["Lat"].tolist()
            lons = user_df["Lon"].tolist()
            track_coords = [
                {"lat": lat, "lon": lon}
                for lat, lon in zip(lats, lons)
                if lat is not None and lon is not None
            ]

        delta_data: dict = {}
        if delta_df is not None:
            delta_data = {
                "dist": delta_df["LapDistPct"].tolist(),
                "speed_delta": delta_df.get("speed_delta", pd.Series(dtype=float)).tolist()
                if "speed_delta" in delta_df.columns
                else [],
                "throttle_delta": delta_df.get("throttle_delta", pd.Series(dtype=float)).tolist()
                if "throttle_delta" in delta_df.columns
                else [],
                "brake_delta": delta_df.get("brake_delta", pd.Series(dtype=float)).tolist()
                if "brake_delta" in delta_df.columns
                else [],
            }

        return {
            "user_lap": self._df_to_series(user_df),
            "reference_laps": [self._df_to_series(r) for r in ref_dfs],
            "delta": delta_data,
            "corners": corners or [],
            "track_coordinates": track_coords,
        }


# ---------------------------------------------------------------------------
# Private helper: local minima finder
# ---------------------------------------------------------------------------

def _find_local_minima(signal: np.ndarray, min_gap: int = 20) -> list[int]:
    """
    Find indices of local minima in `signal` with a minimum separation of
    `min_gap` samples. Uses a simple sliding-window approach.
    """
    n = len(signal)
    half = min_gap // 2
    candidates = []

    for i in range(half, n - half):
        window = signal[max(0, i - half): i + half + 1]
        if signal[i] == window.min() and signal[i] < np.mean(signal) * 0.92:
            candidates.append(i)

    # Enforce minimum gap between kept minima
    kept: list[int] = []
    for idx in candidates:
        if not kept or idx - kept[-1] >= min_gap:
            kept.append(idx)
        elif signal[idx] < signal[kept[-1]]:
            # Replace with deeper minimum
            kept[-1] = idx

    return kept
