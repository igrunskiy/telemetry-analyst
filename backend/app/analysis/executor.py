"""
Shared analysis execution logic used by both the HTTP endpoint (cache hit path)
and the background queue worker.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.analysis.llm import analyze_with_claude
from app.analysis.processor import TelemetryProcessor
from app.analysis.zones import detect_weak_zones
from app.auth.crypto import decrypt
from app.garage61.client import Garage61Client
from app.models.user import User

logger = logging.getLogger(__name__)


async def execute_analysis(
    *,
    lap_id: str,
    reference_lap_ids: list[str],
    car_name: str,
    track_name: str,
    analysis_mode: str,
    laps_metadata: list[dict] | None,
    user: User,
    db,
) -> dict[str, Any]:
    """
    Run the full telemetry → weak-zone → Claude pipeline and return the result dict.
    Raises ValueError or Exception on failure (caller decides how to surface errors).
    """
    # Build Garage61 client for this user
    access_token = decrypt(user.access_token_enc)
    refresh_token = decrypt(user.refresh_token_enc) if user.refresh_token_enc else None
    client = Garage61Client(
        access_token=access_token,
        refresh_token=refresh_token,
        user_id=str(user.garage61_user_id),
        db=db,
    )

    # Fetch all CSVs concurrently
    all_lap_ids = [lap_id] + list(reference_lap_ids)
    csv_results = await asyncio.gather(
        *[client.get_lap_csv(lid) for lid in all_lap_ids],
        return_exceptions=True,
    )

    # Build laps_metadata if not supplied
    if not laps_metadata:
        laps_metadata = [
            {
                "id": lid,
                "role": "user" if i == 0 else "reference",
                "driver_name": "",
                "lap_time": 0,
            }
            for i, lid in enumerate(all_lap_ids)
        ]

    user_csv = csv_results[0]
    if isinstance(user_csv, Exception):
        raise ValueError(f"Failed to fetch user lap CSV: {user_csv}")

    reference_csvs = [r for r in csv_results[1:] if not isinstance(r, Exception) and r]

    # Telemetry processing
    _t_start = time.monotonic()
    processor = TelemetryProcessor()
    processed = processor.process_laps(user_csv, reference_csvs, analysis_mode=analysis_mode)

    # Weak zone detection
    weak_zones = detect_weak_zones(processed)

    # Claude analysis
    claude_key = decrypt(user.claude_api_key_enc) if user.claude_api_key_enc else ""
    llm_result = await analyze_with_claude(
        processed=processed,
        weak_zones=weak_zones,
        car_name=car_name,
        track_name=track_name,
        claude_api_key=claude_key,
        analysis_mode=analysis_mode,
    )

    _generation_time_s = round(time.monotonic() - _t_start, 1)

    # Build telemetry object for frontend
    user_lap = processed.get("user_lap", {})
    ref_laps = processed.get("reference_laps", [])
    ref_lap = ref_laps[0] if ref_laps else {}
    delta = processed.get("delta", {})

    telemetry: dict[str, Any] = {
        "distances": user_lap.get("dist", []),
        "user_speed": user_lap.get("speed", []),
        "ref_speed": ref_lap.get("speed", []),
        "user_throttle": user_lap.get("throttle", []),
        "ref_throttle": ref_lap.get("throttle", []),
        "user_brake": user_lap.get("brake", []),
        "ref_brake": ref_lap.get("brake", []),
        "user_gear": user_lap.get("gear", []),
        "ref_gear": ref_lap.get("gear", []),
        "delta_ms": delta.get("time_delta_ms", []),
        "corners": processed.get("corners", []),
        "sectors": processed.get("sectors", []),
    }
    if "lat" in user_lap:
        telemetry["user_lat"] = user_lap["lat"]
        telemetry["user_lon"] = user_lap.get("lon", [])
    if "lat" in ref_lap:
        telemetry["ref_lat"] = ref_lap["lat"]
        telemetry["ref_lon"] = ref_lap.get("lon", [])

    return {
        "lap_id": lap_id,
        "reference_lap_ids": reference_lap_ids,
        "car_name": car_name,
        "track_name": track_name,
        "analysis_mode": analysis_mode,
        "summary": llm_result.get("summary", ""),
        "estimated_time_gain_seconds": llm_result.get("estimated_time_gain_seconds"),
        "improvement_areas": llm_result.get("improvement_areas", []),
        "strengths": llm_result.get("strengths", []),
        "sector_notes": llm_result.get("sector_notes", []),
        "driving_scores": llm_result.get("driving_scores"),
        "sector_scores": llm_result.get("sector_scores", []),
        "telemetry": telemetry,
        "weak_zones": weak_zones,
        "laps_metadata": laps_metadata,
        "generation_time_s": _generation_time_s,
    }
