"""
Weak zone detection from processed telemetry data.

Analyses each corner and the straights between corners to identify areas
where the user is losing time relative to the best reference lap.
"""

from __future__ import annotations

from typing import Any

import numpy as np


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Speed delta threshold (km/h) below which a corner speed is considered weak
CORNER_SPEED_WEAK_THRESHOLD = -2.0  # ref_speed - user_speed > 2 km/h => user is slower

# Throttle/brake fraction thresholds (0–1 or 0–100 normalised)
THROTTLE_LATE_THRESHOLD = -0.05   # user throttle pickup is 5% lower than ref at same dist
BRAKE_EARLY_THRESHOLD = 0.05      # user starts braking earlier (positive = user brakes more)

# Straight top-speed delta threshold (km/h)
STRAIGHT_SPEED_THRESHOLD = -3.0


def _severity(delta: float, low: float, high: float) -> str:
    """Map a positive deficit magnitude to a severity level."""
    mag = abs(delta)
    if mag >= abs(high):
        return "high"
    if mag >= abs(low):
        return "medium"
    return "low"


def _get_slice(series: list, dist: list, d_start: float, d_end: float) -> list:
    """Return elements of `series` whose corresponding `dist` falls within [d_start, d_end]."""
    return [v for v, d in zip(series, dist) if d_start <= d <= d_end and v is not None]


def detect_weak_zones(processed: dict) -> list[dict]:
    """
    Analyse corners and straights to produce a prioritised list of weak zones.

    Parameters
    ----------
    processed : dict
        Output of TelemetryProcessor.process_laps()

    Returns
    -------
    list[dict]
        Each item:
        {
            zone_type: "corner_speed"|"braking_point"|"throttle_pickup"|"exit_speed"|"straight_speed",
            corner_num: int | None,
            dist: float,          # LapDistPct of the zone centre
            severity: "low"|"medium"|"high",
            metric: str,          # human-readable metric name
            user_value: float,
            ref_value: float,
            delta: float,         # ref - user  (positive = user is worse)
        }
    Sorted by estimated time loss (severity desc, then abs delta desc).
    """
    corners: list[dict] = processed.get("corners", [])
    delta: dict = processed.get("delta", {})
    user_lap: dict = processed.get("user_lap", {})
    ref_laps: list[dict] = processed.get("reference_laps", [])

    if not ref_laps:
        return []

    best_ref = ref_laps[0]
    dist_grid: list[float] = delta.get("dist") or user_lap.get("dist") or []
    speed_delta: list[float] = delta.get("speed_delta", [])
    throttle_delta: list[float] = delta.get("throttle_delta", [])
    brake_delta: list[float] = delta.get("brake_delta", [])

    user_speed: list[float] = user_lap.get("speed", [])
    ref_speed: list[float] = best_ref.get("speed", [])
    user_throttle: list[float] = user_lap.get("throttle", [])
    ref_throttle: list[float] = best_ref.get("throttle", [])
    user_brake: list[float] = user_lap.get("brake", [])
    ref_brake: list[float] = best_ref.get("brake", [])

    zones: list[dict] = []

    # ------------------------------------------------------------------
    # Per-corner analysis
    # ------------------------------------------------------------------
    for corner in corners:
        c_num: int = corner["corner_num"]
        d_start: float = corner["dist_start"]
        d_apex: float = corner["dist_apex"]
        d_end: float = corner["dist_end"]
        apex_idx = d_end  # fallback

        # 1. Corner speed at apex
        apex_user_speeds = _get_slice(user_speed, dist_grid, d_apex - 0.01, d_apex + 0.01)
        apex_ref_speeds = _get_slice(ref_speed, dist_grid, d_apex - 0.01, d_apex + 0.01)

        if apex_user_speeds and apex_ref_speeds:
            u_apex = float(np.mean(apex_user_speeds))
            r_apex = float(np.mean(apex_ref_speeds))
            apex_delta = r_apex - u_apex  # positive = user slower

            if apex_delta >= abs(CORNER_SPEED_WEAK_THRESHOLD):
                zones.append(
                    {
                        "zone_type": "corner_speed",
                        "corner_num": c_num,
                        "dist": d_apex,
                        "severity": _severity(apex_delta, 2.0, 6.0),
                        "metric": "Min corner speed",
                        "user_value": round(u_apex, 1),
                        "ref_value": round(r_apex, 1),
                        "delta": round(apex_delta, 1),
                    }
                )

        # 2. Braking point — check if user starts braking earlier
        # Braking region: from corner start going back a bit
        brake_zone_start = max(0.0, d_start - 0.04)
        u_brakes = _get_slice(user_brake, dist_grid, brake_zone_start, d_start)
        r_brakes = _get_slice(ref_brake, dist_grid, brake_zone_start, d_start)

        if u_brakes and r_brakes:
            u_brake_onset = _find_onset_dist(user_brake, dist_grid, brake_zone_start, d_apex, threshold=0.05)
            r_brake_onset = _find_onset_dist(ref_brake, dist_grid, brake_zone_start, d_apex, threshold=0.05)

            if u_brake_onset is not None and r_brake_onset is not None:
                # Positive = user brakes earlier (earlier dist = earlier braking)
                brake_gap = r_brake_onset - u_brake_onset  # negative = user brakes earlier
                if brake_gap < -0.005:  # user brakes at least 0.5% lap distance earlier
                    zones.append(
                        {
                            "zone_type": "braking_point",
                            "corner_num": c_num,
                            "dist": u_brake_onset,
                            "severity": _severity(abs(brake_gap), 0.005, 0.015),
                            "metric": "Braking point (LapDistPct)",
                            "user_value": round(u_brake_onset, 4),
                            "ref_value": round(r_brake_onset, 4),
                            "delta": round(brake_gap, 4),
                        }
                    )

        # 3. Throttle pickup — check if user gets on throttle later post-apex
        throttle_zone_end = min(1.0, d_end + 0.03)
        u_throttle_onset = _find_onset_dist(
            user_throttle, dist_grid, d_apex, throttle_zone_end, threshold=0.1
        )
        r_throttle_onset = _find_onset_dist(
            ref_throttle, dist_grid, d_apex, throttle_zone_end, threshold=0.1
        )

        if u_throttle_onset is not None and r_throttle_onset is not None:
            throttle_gap = u_throttle_onset - r_throttle_onset  # positive = user later
            if throttle_gap > 0.005:
                zones.append(
                    {
                        "zone_type": "throttle_pickup",
                        "corner_num": c_num,
                        "dist": r_throttle_onset,
                        "severity": _severity(throttle_gap, 0.005, 0.015),
                        "metric": "Throttle pickup point (LapDistPct)",
                        "user_value": round(u_throttle_onset, 4),
                        "ref_value": round(r_throttle_onset, 4),
                        "delta": round(throttle_gap, 4),
                    }
                )

        # 4. Exit speed — compare speed at corner exit
        exit_user = _get_slice(user_speed, dist_grid, d_end - 0.01, d_end + 0.01)
        exit_ref = _get_slice(ref_speed, dist_grid, d_end - 0.01, d_end + 0.01)

        if exit_user and exit_ref:
            u_exit = float(np.mean(exit_user))
            r_exit = float(np.mean(exit_ref))
            exit_delta = r_exit - u_exit  # positive = user slower

            if exit_delta >= 3.0:
                zones.append(
                    {
                        "zone_type": "exit_speed",
                        "corner_num": c_num,
                        "dist": d_end,
                        "severity": _severity(exit_delta, 3.0, 8.0),
                        "metric": "Corner exit speed",
                        "user_value": round(u_exit, 1),
                        "ref_value": round(r_exit, 1),
                        "delta": round(exit_delta, 1),
                    }
                )

    # ------------------------------------------------------------------
    # Straight analysis (between corners)
    # ------------------------------------------------------------------
    if corners and dist_grid:
        straight_regions = _get_straight_regions(corners)
        for s_start, s_end in straight_regions:
            u_top = _get_slice(user_speed, dist_grid, s_start, s_end)
            r_top = _get_slice(ref_speed, dist_grid, s_start, s_end)

            if u_top and r_top:
                u_max = float(np.max(u_top))
                r_max = float(np.max(r_top))
                s_delta = r_max - u_max  # positive = user slower on straight

                if s_delta >= abs(STRAIGHT_SPEED_THRESHOLD):
                    zones.append(
                        {
                            "zone_type": "straight_speed",
                            "corner_num": None,
                            "dist": (s_start + s_end) / 2,
                            "severity": _severity(s_delta, 3.0, 10.0),
                            "metric": "Straight top speed",
                            "user_value": round(u_max, 1),
                            "ref_value": round(r_max, 1),
                            "delta": round(s_delta, 1),
                        }
                    )

    # ------------------------------------------------------------------
    # Sort by estimated time loss
    # ------------------------------------------------------------------
    severity_rank = {"high": 3, "medium": 2, "low": 1}
    zones.sort(
        key=lambda z: (severity_rank.get(z["severity"], 0), abs(z["delta"])),
        reverse=True,
    )

    return zones


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _find_onset_dist(
    series: list[float],
    dist_grid: list[float],
    d_start: float,
    d_end: float,
    threshold: float = 0.05,
) -> float | None:
    """
    Find the first LapDistPct value within [d_start, d_end] where `series`
    exceeds `threshold`. Returns None if no such point exists.
    """
    for val, d in zip(series, dist_grid):
        if d_start <= d <= d_end and val is not None and float(val) >= threshold:
            return d
    return None


def _get_straight_regions(corners: list[dict]) -> list[tuple[float, float]]:
    """
    Return (start, end) LapDistPct pairs for the straight sections between corners.
    """
    straights = []
    sorted_corners = sorted(corners, key=lambda c: c["dist_apex"])

    # Before first corner
    if sorted_corners and sorted_corners[0]["dist_start"] > 0.02:
        straights.append((0.0, sorted_corners[0]["dist_start"]))

    # Between corners
    for i in range(len(sorted_corners) - 1):
        s = sorted_corners[i]["dist_end"]
        e = sorted_corners[i + 1]["dist_start"]
        if e - s > 0.02:  # at least 2% of lap distance
            straights.append((s, e))

    # After last corner (wrap to 1.0)
    if sorted_corners and sorted_corners[-1]["dist_end"] < 0.98:
        straights.append((sorted_corners[-1]["dist_end"], 1.0))

    return straights
