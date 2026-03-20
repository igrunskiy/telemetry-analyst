"""Shared pytest fixtures and configuration."""
import numpy as np
import pandas as pd
import pytest

from app.analysis.processor import TelemetryProcessor, INTERP_POINTS


def make_lap_csv(
    n: int = 300,
    speed_profile: np.ndarray | None = None,
    use_alias_columns: bool = False,
    speed_in_ms: bool = False,
    track_length_m: float | None = None,
) -> str:
    """
    Generate a minimal synthetic telemetry CSV.

    Parameters
    ----------
    n : number of data rows
    speed_profile : optional custom speed array of length n (km/h)
    use_alias_columns : use non-canonical column names to test alias resolution
    speed_in_ms : emit speed in m/s (triggers unit-conversion branch)
    track_length_m : if given, use LapDistPct values in metres instead of 0-1
    """
    dist = np.linspace(0, 1, n)

    if speed_profile is not None:
        speed = np.asarray(speed_profile, dtype=float)
    else:
        # Three clear corners at 25 %, 50 %, 75 % of the lap
        base = 150.0 + 50.0 * np.sin(np.pi * dist)
        for apex_pct in (0.25, 0.50, 0.75):
            base -= 80.0 * np.exp(-((dist - apex_pct) ** 2) / 0.0015)
        speed = np.clip(base, 30.0, 250.0)

    if speed_in_ms:
        speed = speed / 3.6

    throttle = np.clip(speed / 200.0, 0.0, 1.0)
    brake = np.where(speed < 90.0, 0.6, 0.0)
    gear = np.clip((speed / 45.0).astype(int), 1, 6)

    if track_length_m is not None:
        dist_col = dist * track_length_m
    else:
        dist_col = dist

    if use_alias_columns:
        col_names = {
            "dist": "lapdistpct",
            "speed": "velocity",
            "throttle": "gas",
            "brake": "braking",
        }
    else:
        col_names = {
            "dist": "LapDistPct",
            "speed": "Speed",
            "throttle": "Throttle",
            "brake": "Brake",
        }

    df = pd.DataFrame(
        {
            col_names["dist"]: dist_col,
            col_names["speed"]: speed,
            col_names["throttle"]: throttle,
            col_names["brake"]: brake,
            "Gear": gear.astype(float),
        }
    )
    return df.to_csv(index=False)


def make_processed(
    user_speed_offset: float = 0.0,
    n: int = INTERP_POINTS,
    track_length: float = 3000.0,
    throttle_offset: float = 0.0,
    brake_offset: float = 0.0,
) -> dict:
    """
    Build a minimal *already-processed* dict (output of process_laps) for
    zone-detection and prompt tests.  Includes two corners.
    """
    dist = np.linspace(0.0, track_length, n)
    base_speed = 150.0 + 50.0 * np.sin(np.pi * np.linspace(0, 1, n))
    # Two hard corners
    for apex_frac in (0.25, 0.60):
        base_speed -= 80.0 * np.exp(
            -((np.linspace(0, 1, n) - apex_frac) ** 2) / 0.0015
        )
    base_speed = np.clip(base_speed, 30.0, 250.0)

    ref_speed = base_speed.copy()
    user_speed = np.clip(base_speed - user_speed_offset, 10.0, 300.0)

    throttle = np.clip(base_speed / 200.0, 0.0, 1.0)
    brake = np.where(base_speed < 90.0, 0.6, 0.0)
    gear = np.clip((base_speed / 45.0).astype(int), 1, 6).astype(float)

    corners = [
        {
            "corner_num": 1,
            "dist_start": float(dist[int(n * 0.15)]),
            "dist_apex": float(dist[int(n * 0.25)]),
            "dist_end": float(dist[int(n * 0.35)]),
            "min_speed": float(user_speed[int(n * 0.25)]),
            "label": "T1",
        },
        {
            "corner_num": 2,
            "dist_start": float(dist[int(n * 0.50)]),
            "dist_apex": float(dist[int(n * 0.60)]),
            "dist_end": float(dist[int(n * 0.70)]),
            "min_speed": float(user_speed[int(n * 0.60)]),
            "label": "T2",
        },
    ]

    lap_data = {
        "dist": dist.tolist(),
        "speed": ref_speed.tolist(),
        "throttle": (throttle + throttle_offset).clip(0, 1).tolist(),
        "brake": (brake + brake_offset).clip(0, 1).tolist(),
        "gear": gear.tolist(),
    }
    user_lap_data = {
        "dist": dist.tolist(),
        "speed": user_speed.tolist(),
        "throttle": (throttle + throttle_offset).clip(0, 1).tolist(),
        "brake": (brake + brake_offset).clip(0, 1).tolist(),
        "gear": gear.tolist(),
    }

    speed_delta = (ref_speed - user_speed).tolist()

    return {
        "corners": corners,
        "track_length_m": track_length,
        "user_lap": user_lap_data,
        "reference_laps": [lap_data],
        "delta": {
            "dist": dist.tolist(),
            "speed_delta": speed_delta,
            "throttle_delta": np.zeros(n).tolist(),
            "brake_delta": np.zeros(n).tolist(),
        },
        "sectors": [
            {"sector": 1, "user_time_ms": 30_000, "ref_time_ms": 29_500, "delta_ms": 500},
            {"sector": 2, "user_time_ms": 31_000, "ref_time_ms": 31_000, "delta_ms": 0},
            {"sector": 3, "user_time_ms": 29_000, "ref_time_ms": 29_500, "delta_ms": -500},
        ],
    }
