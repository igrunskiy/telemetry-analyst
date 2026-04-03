"""
Weak zone detection from processed telemetry data.

Analyses each corner and the straights between corners to identify areas
where the user is losing time relative to the best reference lap.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Speed delta threshold (km/h) below which a corner speed is considered weak
CORNER_SPEED_WEAK_THRESHOLD = -2.0  # ref_speed - user_speed > 2 km/h => user is slower

# Straight top-speed delta threshold (km/h)
STRAIGHT_SPEED_THRESHOLD = -3.0

# Distance-based windows (metres) — dist_grid and corner distances are all in metres
APEX_WINDOW_M = 50.0            # ±50 m search window around corner apex
BRAKE_LOOKBACK_M = 150.0        # look this far before corner start for braking onset
BRAKE_GAP_THRESHOLD_M = 15.0    # flag if user brakes ≥15 m earlier than reference
THROTTLE_LOOKAHEAD_M = 100.0    # look this far after corner end for throttle pickup
THROTTLE_GAP_THRESHOLD_M = 15.0 # flag if user picks up throttle ≥15 m later than reference
EXIT_WINDOW_M = 30.0            # ±30 m around corner end for exit speed check
MIN_STRAIGHT_M = 80.0           # minimum straight length (m) to analyse
BRAKE_ONSET_THRESHOLD = 0.01    # treat 1% pedal application as meaningful onset
THROTTLE_ONSET_THRESHOLD = 0.01 # treat 1% pedal application as meaningful pickup


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
        logger.debug("No reference laps available, skipping weak zone detection")
        return []

    logger.info("detect_weak_zones: analysing %d corners", len(corners))

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
        apex_user_speeds = _get_slice(user_speed, dist_grid, d_apex - APEX_WINDOW_M, d_apex + APEX_WINDOW_M)
        apex_ref_speeds = _get_slice(ref_speed, dist_grid, d_apex - APEX_WINDOW_M, d_apex + APEX_WINDOW_M)

        if apex_user_speeds and apex_ref_speeds:
            u_apex = float(np.mean(apex_user_speeds))
            r_apex = float(np.mean(apex_ref_speeds))
            apex_delta = r_apex - u_apex  # positive = user slower

            if apex_delta >= abs(CORNER_SPEED_WEAK_THRESHOLD):
                sev = _severity(apex_delta, 2.0, 6.0)
                logger.debug("T%d corner_speed [%s]: user=%.1f ref=%.1f delta=%.1f km/h", c_num, sev, u_apex, r_apex, apex_delta)
                zones.append(
                    {
                        "zone_type": "corner_speed",
                        "corner_num": c_num,
                        "dist": d_apex,
                        "severity": sev,
                        "metric": "Min corner speed",
                        "user_value": round(u_apex, 1),
                        "ref_value": round(r_apex, 1),
                        "delta": round(apex_delta, 1),
                    }
                )

        # 2. Braking point — check if user starts braking earlier
        # Braking region: from BRAKE_LOOKBACK_M before corner start to apex
        brake_zone_start = max(0.0, d_start - BRAKE_LOOKBACK_M)
        u_brakes = _get_slice(user_brake, dist_grid, brake_zone_start, d_start)
        r_brakes = _get_slice(ref_brake, dist_grid, brake_zone_start, d_start)

        if u_brakes and r_brakes:
            u_brake_onset = _find_onset_dist(
                user_brake,
                dist_grid,
                brake_zone_start,
                d_apex,
                threshold=BRAKE_ONSET_THRESHOLD,
            )
            r_brake_onset = _find_onset_dist(
                ref_brake,
                dist_grid,
                brake_zone_start,
                d_apex,
                threshold=BRAKE_ONSET_THRESHOLD,
            )

            if u_brake_onset is not None and r_brake_onset is not None:
                # Negative = user brakes earlier (smaller dist = earlier braking)
                brake_gap = r_brake_onset - u_brake_onset  # negative = user brakes earlier
                if brake_gap < -BRAKE_GAP_THRESHOLD_M:
                    sev = _severity(abs(brake_gap), BRAKE_GAP_THRESHOLD_M, BRAKE_GAP_THRESHOLD_M * 3)
                    logger.debug("T%d braking_point [%s]: user=%.0fm ref=%.0fm gap=%.0fm (braking early)", c_num, sev, u_brake_onset, r_brake_onset, abs(brake_gap))
                    zones.append(
                        {
                            "zone_type": "braking_point",
                            "corner_num": c_num,
                            "dist": u_brake_onset,
                            "severity": sev,
                            "metric": "Braking point (m)",
                            "user_value": round(u_brake_onset, 1),
                            "ref_value": round(r_brake_onset, 1),
                            "delta": round(brake_gap, 1),
                        }
                    )

        # 3. Throttle pickup — check if user gets on throttle later post-apex
        throttle_zone_end = d_end + THROTTLE_LOOKAHEAD_M
        u_throttle_onset = _find_onset_dist(
            user_throttle,
            dist_grid,
            d_apex,
            throttle_zone_end,
            threshold=THROTTLE_ONSET_THRESHOLD,
        )
        r_throttle_onset = _find_onset_dist(
            ref_throttle,
            dist_grid,
            d_apex,
            throttle_zone_end,
            threshold=THROTTLE_ONSET_THRESHOLD,
        )

        if u_throttle_onset is not None and r_throttle_onset is not None:
            throttle_gap = u_throttle_onset - r_throttle_onset  # positive = user later
            if throttle_gap > THROTTLE_GAP_THRESHOLD_M:
                sev = _severity(throttle_gap, THROTTLE_GAP_THRESHOLD_M, THROTTLE_GAP_THRESHOLD_M * 3)
                logger.debug("T%d throttle_pickup [%s]: user=%.0fm ref=%.0fm gap=%.0fm (late throttle)", c_num, sev, u_throttle_onset, r_throttle_onset, throttle_gap)
                zones.append(
                    {
                        "zone_type": "throttle_pickup",
                        "corner_num": c_num,
                        "dist": r_throttle_onset,
                        "severity": sev,
                        "metric": "Throttle pickup point (m)",
                        "user_value": round(u_throttle_onset, 1),
                        "ref_value": round(r_throttle_onset, 1),
                        "delta": round(throttle_gap, 1),
                    }
                )

        # 4. Exit speed — compare speed at corner exit
        exit_user = _get_slice(user_speed, dist_grid, d_end - EXIT_WINDOW_M, d_end + EXIT_WINDOW_M)
        exit_ref = _get_slice(ref_speed, dist_grid, d_end - EXIT_WINDOW_M, d_end + EXIT_WINDOW_M)

        if exit_user and exit_ref:
            u_exit = float(np.mean(exit_user))
            r_exit = float(np.mean(exit_ref))
            exit_delta = r_exit - u_exit  # positive = user slower

            if exit_delta >= 3.0:
                sev = _severity(exit_delta, 3.0, 8.0)
                logger.debug("T%d exit_speed [%s]: user=%.1f ref=%.1f delta=%.1f km/h", c_num, sev, u_exit, r_exit, exit_delta)
                zones.append(
                    {
                        "zone_type": "exit_speed",
                        "corner_num": c_num,
                        "dist": d_end,
                        "severity": sev,
                        "metric": "Corner exit speed",
                        "user_value": round(u_exit, 1),
                        "ref_value": round(r_exit, 1),
                        "delta": round(exit_delta, 1),
                    }
                )

    # ------------------------------------------------------------------
    # Straight analysis (between corners)
    # ------------------------------------------------------------------
    track_length_m = float(processed.get("track_length_m", dist_grid[-1] if dist_grid else 3000.0))

    if corners and dist_grid:
        straight_regions = _get_straight_regions(corners, track_length_m)
        for s_start, s_end in straight_regions:
            u_top = _get_slice(user_speed, dist_grid, s_start, s_end)
            r_top = _get_slice(ref_speed, dist_grid, s_start, s_end)

            if u_top and r_top:
                u_max = float(np.max(u_top))
                r_max = float(np.max(r_top))
                s_delta = r_max - u_max  # positive = user slower on straight

                if s_delta >= abs(STRAIGHT_SPEED_THRESHOLD):
                    sev = _severity(s_delta, 3.0, 10.0)
                    logger.debug("straight_speed [%s] at %.0f-%.0fm: user=%.1f ref=%.1f delta=%.1f km/h", sev, s_start, s_end, u_max, r_max, s_delta)
                    zones.append(
                        {
                            "zone_type": "straight_speed",
                            "corner_num": None,
                            "dist": (s_start + s_end) / 2,
                            "severity": sev,
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

    by_type: dict[str, int] = {}
    for z in zones:
        by_type[z["zone_type"]] = by_type.get(z["zone_type"], 0) + 1
    logger.info("detect_weak_zones done: %d zones total — %s", len(zones), by_type)

    return zones


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _find_onset_dist(
    series: list[float],
    dist_grid: list[float],
    d_start: float,
    d_end: float,
    threshold: float = 0.01,
) -> float | None:
    """
    Find the first LapDistPct value within [d_start, d_end] where `series`
    exceeds `threshold`. Returns None if no such point exists.
    """
    for val, d in zip(series, dist_grid):
        if d_start <= d <= d_end and val is not None and float(val) >= threshold:
            return d
    return None


def _get_straight_regions(corners: list[dict], track_length_m: float = 3000.0) -> list[tuple[float, float]]:
    """
    Return (start_m, end_m) metre pairs for the straight sections between corners.
    """
    straights = []
    sorted_corners = sorted(corners, key=lambda c: c["dist_apex"])

    # Before first corner
    if sorted_corners and sorted_corners[0]["dist_start"] > MIN_STRAIGHT_M:
        straights.append((0.0, sorted_corners[0]["dist_start"]))

    # Between corners
    for i in range(len(sorted_corners) - 1):
        s = sorted_corners[i]["dist_end"]
        e = sorted_corners[i + 1]["dist_start"]
        if e - s > MIN_STRAIGHT_M:
            straights.append((s, e))

    # After last corner
    if sorted_corners and sorted_corners[-1]["dist_end"] < track_length_m - MIN_STRAIGHT_M:
        straights.append((sorted_corners[-1]["dist_end"], track_length_m))

    return straights
