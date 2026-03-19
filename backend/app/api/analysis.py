"""
Analysis execution, caching, and history endpoints.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.llm import analyze_with_claude
from app.analysis.processor import TelemetryProcessor
from app.analysis.zones import detect_weak_zones
from app.auth.crypto import decrypt
from app.auth.jwt import get_current_user
from app.database import get_db
from app.garage61.client import Garage61Client, get_garage61_client
from app.models.analysis import AnalysisResult
from app.models.user import User

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class LapMetaInput(BaseModel):
    id: str
    role: str = "reference"
    driver_name: str = ""
    lap_time: float = 0.0
    irating: int | None = None


class RunAnalysisRequest(BaseModel):
    lap_id: str
    reference_lap_ids: list[str]
    car_name: str
    track_name: str
    analysis_mode: str = "vs_reference"  # "vs_reference" or "solo"
    laps_metadata: list[LapMetaInput] | None = None


class AnalysisHistoryItemResponse(BaseModel):
    id: str
    lap_id: str
    reference_lap_ids: list[str]
    car_name: str
    track_name: str
    created_at: datetime
    estimated_time_gain_seconds: float | None
    analysis_mode: str = "vs_reference"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/run", status_code=status.HTTP_201_CREATED)
async def run_analysis(
    body: RunAnalysisRequest,
    response: Response,
    current_user: User = Depends(get_current_user),
    client: Garage61Client = Depends(get_garage61_client),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Execute a full telemetry analysis for the given lap vs reference laps.

    Checks the DB cache first. On cache miss:
    1. Fetches all CSVs concurrently from Garage61
    2. Processes telemetry and detects weak zones
    3. Calls Claude for AI coaching analysis
    4. Persists result to DB
    5. Returns the full result
    """
    if not body.reference_lap_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one additional lap ID is required",
        )

    # ----- Cache lookup -----
    cache_hit = await db.execute(
        select(AnalysisResult).where(
            AnalysisResult.user_id == current_user.id,
            AnalysisResult.lap_id == body.lap_id,
        )
    )
    existing = cache_hit.scalars().all()
    for record in existing:
        # Match if same set of reference laps — return cached result with 200
        if set(record.reference_lap_ids) == set(body.reference_lap_ids):
            response.status_code = status.HTTP_200_OK
            enriched = dict(record.result_json)
            enriched["id"] = str(record.id)
            enriched["created_at"] = record.created_at.isoformat()
            # Inject fresh metadata on cache hit if caller supplied it
            if body.laps_metadata:
                enriched["laps_metadata"] = [m.model_dump() for m in body.laps_metadata]
            return enriched

    # ----- Fetch CSVs -----
    all_lap_ids = [body.lap_id] + list(body.reference_lap_ids)
    try:
        csv_results = await asyncio.gather(
            *[client.get_lap_csv(lap_id) for lap_id in all_lap_ids],
            return_exceptions=True,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch telemetry data from Garage61: {exc}",
        )

    # Build laps_metadata — use client-supplied values when available (reliable),
    # otherwise fall back to empty placeholders
    if body.laps_metadata:
        laps_metadata = [m.model_dump() for m in body.laps_metadata]
    else:
        laps_metadata = [
            {"id": lap_id, "role": "user" if i == 0 else "reference",
             "driver_name": "", "lap_time": 0}
            for i, lap_id in enumerate(all_lap_ids)
        ]

    user_csv = csv_results[0]
    if isinstance(user_csv, Exception):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch user lap CSV: {user_csv}",
        )

    reference_csvs = [
        r for r in csv_results[1:] if not isinstance(r, Exception) and r
    ]

    # ----- Telemetry processing -----
    processor = TelemetryProcessor()
    try:
        processed = processor.process_laps(user_csv, reference_csvs, analysis_mode=body.analysis_mode)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Telemetry processing failed: {exc}",
        )

    # ----- Weak zone detection -----
    weak_zones = detect_weak_zones(processed)

    # ----- Claude analysis -----
    claude_key = (
        decrypt(current_user.claude_api_key_enc)
        if current_user.claude_api_key_enc
        else ""
    )

    try:
        llm_result = await analyze_with_claude(
            processed=processed,
            weak_zones=weak_zones,
            car_name=body.car_name,
            track_name=body.track_name,
            claude_api_key=claude_key,
            analysis_mode=body.analysis_mode,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Claude analysis failed: {exc}",
        )

    # ----- Build telemetry object for frontend visualizations -----
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

    # ----- Build full result (LLM fields flattened to top level) -----
    full_result: dict[str, Any] = {
        "lap_id": body.lap_id,
        "reference_lap_ids": body.reference_lap_ids,
        "car_name": body.car_name,
        "track_name": body.track_name,
        "analysis_mode": body.analysis_mode,
        # LLM coaching fields at top level (matches frontend AnalysisReport type)
        "summary": llm_result.get("summary", ""),
        "estimated_time_gain_seconds": llm_result.get("estimated_time_gain_seconds"),
        "improvement_areas": llm_result.get("improvement_areas", []),
        "strengths": llm_result.get("strengths", []),
        "sector_notes": llm_result.get("sector_notes", []),
        # Telemetry object for visualizations
        "telemetry": telemetry,
        # Keep weak_zones for potential future use
        "weak_zones": weak_zones,
        # Per-lap metadata (driver, irating, lap time)
        "laps_metadata": laps_metadata,
    }

    # ----- Persist to DB -----
    record = AnalysisResult(
        user_id=current_user.id,
        lap_id=body.lap_id,
        reference_lap_ids=body.reference_lap_ids,
        car_name=body.car_name,
        track_name=body.track_name,
        result_json=full_result,
        created_at=datetime.now(timezone.utc),
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)

    full_result["id"] = str(record.id)
    full_result["created_at"] = record.created_at.isoformat()
    return full_result


@router.get("/history", response_model=list[AnalysisHistoryItemResponse])
async def get_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[AnalysisHistoryItemResponse]:
    """Return a list of the current user's past analysis results (summary view)."""
    result = await db.execute(
        select(AnalysisResult)
        .where(AnalysisResult.user_id == current_user.id)
        .order_by(AnalysisResult.created_at.desc())
        .limit(50)
    )
    records = result.scalars().all()

    history = []
    for r in records:
        rj = r.result_json or {}

        history.append(
            AnalysisHistoryItemResponse(
                id=str(r.id),
                lap_id=r.lap_id,
                reference_lap_ids=r.reference_lap_ids or [],
                car_name=r.car_name,
                track_name=r.track_name,
                created_at=r.created_at,
                estimated_time_gain_seconds=rj.get("estimated_time_gain_seconds"),
                analysis_mode=rj.get("analysis_mode", "vs_reference"),
            )
        )

    return history


@router.delete("/{analysis_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_analysis(
    analysis_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete an analysis result owned by the current user."""
    try:
        uid = uuid.UUID(analysis_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid analysis ID format",
        )

    result = await db.execute(
        select(AnalysisResult).where(
            AnalysisResult.id == uid,
            AnalysisResult.user_id == current_user.id,
        )
    )
    record = result.scalar_one_or_none()

    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis not found",
        )

    await db.delete(record)


@router.get("/{analysis_id}")
async def get_analysis(
    analysis_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Return a full cached analysis result by ID."""
    try:
        uid = uuid.UUID(analysis_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid analysis ID format",
        )

    result = await db.execute(
        select(AnalysisResult).where(
            AnalysisResult.id == uid,
            AnalysisResult.user_id == current_user.id,
        )
    )
    record = result.scalar_one_or_none()

    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis not found",
        )

    enriched = dict(record.result_json)
    enriched["id"] = str(record.id)
    enriched["created_at"] = record.created_at.isoformat()
    return enriched
