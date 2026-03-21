"""
Analysis execution, caching, and history endpoints.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.worker import get_active_job_count
from app.auth.jwt import get_current_user
from app.config import settings
from app.database import get_db
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
    llm_provider: str = "claude"  # "claude" or "gemini"
    prompt_version: str | None = None  # named prompt; None → model default


class AnalysisHistoryItemResponse(BaseModel):
    id: str
    lap_id: str
    reference_lap_ids: list[str]
    car_name: str
    track_name: str
    created_at: datetime
    estimated_time_gain_seconds: float | None
    analysis_mode: str = "vs_reference"
    status: str = "completed"
    llm_provider: str | None = None
    model_name: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _enqueued_response(record: AnalysisResult) -> dict[str, Any]:
    """Return a minimal response for a newly enqueued or in-progress record."""
    return {
        "id": str(record.id),
        "status": record.status,
        "lap_id": record.lap_id,
        "reference_lap_ids": record.reference_lap_ids,
        "car_name": record.car_name,
        "track_name": record.track_name,
        "created_at": record.created_at.isoformat(),
        "analysis_mode": (record.input_json or {}).get("analysis_mode", "vs_reference"),
    }


def _completed_response(record: AnalysisResult) -> dict[str, Any]:
    enriched = dict(record.result_json or {})
    enriched["id"] = str(record.id)
    enriched["status"] = record.status
    enriched["created_at"] = record.created_at.isoformat()
    return enriched


def _failed_response(record: AnalysisResult) -> dict[str, Any]:
    return {
        "id": str(record.id),
        "status": "failed",
        "error_message": record.error_message or "Analysis failed",
        "lap_id": record.lap_id,
        "reference_lap_ids": record.reference_lap_ids,
        "car_name": record.car_name,
        "track_name": record.track_name,
        "created_at": record.created_at.isoformat(),
    }


def _record_response(record: AnalysisResult) -> dict[str, Any]:
    if record.status == "completed":
        return _completed_response(record)
    if record.status == "failed":
        return _failed_response(record)
    return _enqueued_response(record)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/run", status_code=status.HTTP_202_ACCEPTED)
async def run_analysis(
    body: RunAnalysisRequest,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Enqueue a telemetry analysis job.

    On cache hit (same lap + same reference set, completed status): returns 200 with full result.
    On new job: creates an 'enqueued' record and returns 202. The background worker will
    process it and update the record to 'completed' or 'failed'.
    """
    if not body.reference_lap_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one additional lap ID is required",
        )

    # ----- Cache lookup (only match completed records) -----
    cache_hit = await db.execute(
        select(AnalysisResult).where(
            AnalysisResult.user_id == current_user.id,
            AnalysisResult.lap_id == body.lap_id,
            AnalysisResult.status == "completed",
        )
    )
    for record in cache_hit.scalars().all():
        if set(record.reference_lap_ids) == set(body.reference_lap_ids):
            response.status_code = status.HTTP_200_OK
            enriched = _completed_response(record)
            if body.laps_metadata:
                enriched["laps_metadata"] = [m.model_dump() for m in body.laps_metadata]
            return enriched

    # ----- Queue size check -----
    active_count = await get_active_job_count(db)
    if active_count >= settings.ANALYSIS_WORKER_POOL_SIZE:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Analysis queue is full ({active_count}/{settings.ANALYSIS_WORKER_POOL_SIZE} active jobs). "
                "Please wait for a slot to open up."
            ),
        )

    # ----- Create enqueued record -----
    laps_metadata = (
        [m.model_dump() for m in body.laps_metadata] if body.laps_metadata else None
    )
    now = datetime.now(timezone.utc)
    record = AnalysisResult(
        user_id=current_user.id,
        lap_id=body.lap_id,
        reference_lap_ids=body.reference_lap_ids,
        car_name=body.car_name,
        track_name=body.track_name,
        result_json={},
        status="enqueued",
        input_json={
            "analysis_mode": body.analysis_mode,
            "laps_metadata": laps_metadata,
            "llm_provider": body.llm_provider,
            "prompt_version": body.prompt_version,
        },
        created_at=now,
        enqueued_at=now,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)

    return _enqueued_response(record)


@router.post("/{analysis_id}/regenerate", status_code=status.HTTP_202_ACCEPTED)
async def regenerate_analysis(
    analysis_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Re-enqueue an existing analysis record for reprocessing.
    Resets status to 'enqueued' and clears the previous result.
    """
    try:
        uid = uuid.UUID(analysis_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid analysis ID format")

    query = select(AnalysisResult).where(AnalysisResult.id == uid)
    if current_user.role != "admin":
        query = query.where(AnalysisResult.user_id == current_user.id)

    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found")

    if record.status in ("enqueued", "processing"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Analysis is already queued or being processed",
        )

    active_count = await get_active_job_count(db)
    if active_count >= settings.ANALYSIS_WORKER_POOL_SIZE:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Analysis queue is full ({active_count}/{settings.ANALYSIS_WORKER_POOL_SIZE} active jobs).",
        )

    # Preserve input_json (analysis_mode + laps_metadata); backfill from result_json for old records
    existing_rj = record.result_json or {}
    if not record.input_json:
        record.input_json = {
            "analysis_mode": existing_rj.get("analysis_mode", "vs_reference"),
            "laps_metadata": existing_rj.get("laps_metadata"),
        }

    record.status = "enqueued"
    record.result_json = {}
    record.error_message = None
    record.enqueued_at = datetime.now(timezone.utc)
    await db.flush()

    return _enqueued_response(record)


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
        input_data = r.input_json or {}
        analysis_mode = rj.get("analysis_mode") or input_data.get("analysis_mode", "vs_reference")

        history.append(
            AnalysisHistoryItemResponse(
                id=str(r.id),
                lap_id=r.lap_id,
                reference_lap_ids=r.reference_lap_ids or [],
                car_name=r.car_name,
                track_name=r.track_name,
                created_at=r.created_at,
                estimated_time_gain_seconds=rj.get("estimated_time_gain_seconds"),
                analysis_mode=analysis_mode,
                status=r.status,
                llm_provider=input_data.get("llm_provider") or rj.get("llm_provider"),
                model_name=rj.get("model_name"),
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
    """Return an analysis result by ID. Includes status for in-progress jobs."""
    try:
        uid = uuid.UUID(analysis_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid analysis ID format",
        )

    query = select(AnalysisResult).where(AnalysisResult.id == uid)
    # Admins can read any report; regular users only their own
    if current_user.role != "admin":
        query = query.where(AnalysisResult.user_id == current_user.id)

    result = await db.execute(query)
    record = result.scalar_one_or_none()

    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis not found",
        )

    return _record_response(record)
