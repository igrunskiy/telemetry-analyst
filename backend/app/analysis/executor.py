"""
Shared analysis execution logic used by both the HTTP endpoint (cache hit path)
and the background queue worker.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.analysis.llm import analyze_with_claude, CLAUDE_MODEL
from app.analysis.gemini import analyze_with_gemini, GEMINI_MODEL
from app.analysis.processor import TelemetryProcessor
from app.analysis.zones import detect_weak_zones
from app.auth.crypto import decrypt
from app.models.user import User
from app.telemetry.catalog import load_csv_for_lap_id

logger = logging.getLogger(__name__)


async def execute_analysis(
    *,
    lap_id: str,
    reference_lap_ids: list[str],
    car_name: str,
    track_name: str,
    analysis_mode: str,
    laps_metadata: list[dict] | None,
    llm_provider: str = "claude",
    prompt_version: str | None = None,
    uploaded_telemetry: list[dict[str, Any]] | None = None,
    user: User,
    db,
) -> dict[str, Any]:
    """
    Run the full telemetry → weak-zone → LLM pipeline and return the result dict.
    Raises ValueError or Exception on failure (caller decides how to surface errors).
    """
    model_name = GEMINI_MODEL if llm_provider == "gemini" else CLAUDE_MODEL
    all_lap_ids = [lap_id] + list(reference_lap_ids)

    logger.info(
        "Starting analysis: lap=%s refs=%s car=%r track=%r mode=%s provider=%s model=%s",
        lap_id, reference_lap_ids, car_name, track_name, analysis_mode, llm_provider, model_name,
    )

    upload_ids = {item["id"] for item in (uploaded_telemetry or [])}
    logger.debug("Fetching %d lap CSVs from telemetry sources", len(all_lap_ids))
    t0 = time.monotonic()
    csv_results = await asyncio.gather(
        *[
            load_csv_for_lap_id(
                lid,
                user=user,
                db=db,
                uploaded_telemetry=uploaded_telemetry,
            )
            for lid in all_lap_ids
        ],
        return_exceptions=True,
    )
    logger.info("CSV fetch complete in %.2fs", time.monotonic() - t0)

    failed_csvs = [lid for lid, r in zip(all_lap_ids, csv_results) if isinstance(r, Exception)]
    if failed_csvs:
        logger.warning("Failed to fetch CSVs for laps: %s", failed_csvs)

    # Build laps_metadata if not supplied
    if not laps_metadata:
        laps_metadata = [
            {
                "id": lid,
                "role": "user" if i == 0 else "reference",
                "driver_name": "",
                "lap_time": 0,
                "source": "custom" if lid in upload_ids else "garage61",
            }
            for i, lid in enumerate(all_lap_ids)
        ]

    user_csv = csv_results[0]
    if isinstance(user_csv, Exception):
        raise ValueError(f"Failed to fetch user lap CSV: {user_csv}")

    reference_csvs = [r for r in csv_results[1:] if not isinstance(r, Exception) and r]
    logger.info(
        "CSV summary: user lap OK, %d/%d reference laps OK",
        len(reference_csvs), len(reference_lap_ids),
    )

    # Telemetry processing
    _t_start = time.monotonic()
    logger.debug("Starting telemetry processing (mode=%s)", analysis_mode)
    processor = TelemetryProcessor()
    processed = processor.process_laps(user_csv, reference_csvs, analysis_mode=analysis_mode)
    t_process = time.monotonic() - _t_start
    logger.info(
        "Telemetry processing complete in %.2fs: %d corners, %d sectors, track=%.0fm",
        t_process,
        len(processed.get("corners", [])),
        len(processed.get("sectors", [])),
        processed.get("track_length_m", 0),
    )

    # Weak zone detection
    logger.debug("Running weak zone detection")
    t0 = time.monotonic()
    weak_zones = detect_weak_zones(processed)
    logger.info(
        "Weak zone detection complete in %.2fs: %d zones found",
        time.monotonic() - t0, len(weak_zones),
    )
    if weak_zones:
        severity_counts = {"high": 0, "medium": 0, "low": 0}
        for z in weak_zones:
            severity_counts[z["severity"]] = severity_counts.get(z["severity"], 0) + 1
        logger.debug("Zone severity breakdown: %s", severity_counts)

    # LLM analysis — route to selected provider
    logger.info("Sending telemetry to LLM: provider=%s model=%s", llm_provider, model_name)
    t0 = time.monotonic()
    if llm_provider == "gemini":
        gemini_key = decrypt(user.gemini_api_key_enc) if user.gemini_api_key_enc else ""
        llm_result = await analyze_with_gemini(
            processed=processed,
            weak_zones=weak_zones,
            car_name=car_name,
            track_name=track_name,
            gemini_api_key=gemini_key,
            analysis_mode=analysis_mode,
            prompt_version=prompt_version,
        )
    else:
        claude_key = decrypt(user.claude_api_key_enc) if user.claude_api_key_enc else ""
        llm_result = await analyze_with_claude(
            processed=processed,
            weak_zones=weak_zones,
            car_name=car_name,
            track_name=track_name,
            claude_api_key=claude_key,
            analysis_mode=analysis_mode,
            prompt_version=prompt_version,
        )
    t_llm = time.monotonic() - t0
    logger.info(
        "LLM analysis complete in %.2fs: %d improvement areas, est. gain=%.2fs",
        t_llm,
        len(llm_result.get("improvement_areas", [])),
        llm_result.get("estimated_time_gain_seconds") or 0.0,
    )

    _generation_time_s = round(time.monotonic() - _t_start, 1)
    logger.info("Total analysis pipeline complete in %.1fs", _generation_time_s)

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
        "llm_provider": llm_provider,
        "model_name": model_name,
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
