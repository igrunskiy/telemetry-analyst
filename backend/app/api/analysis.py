"""
Analysis execution, caching, and history endpoints.
"""

from __future__ import annotations

import secrets
import uuid
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.worker import get_active_job_count
from app.analysis.lap_metadata import canonical_driver_name as _canonical_driver_name
from app.analysis.lap_metadata import driver_key as _driver_key
from app.analysis.lap_metadata import normalize_lap_meta_dict as _normalize_lap_meta_dict
from app.analysis.upload_inspector import inspect_upload
from app.auth.jwt import get_current_user
from app.config import settings
from app.database import get_db
from app.models.analysis import AnalysisResult
from app.models.user import User
from app.telemetry.catalog import resolve_or_create_car, resolve_or_create_track

router = APIRouter(prefix="/api/analysis", tags=["analysis"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class LapMetaInput(BaseModel):
    class LapConditionsInput(BaseModel):
        summary: str | None = None
        weather: str | None = None
        track_state: str | None = None
        air_temp_c: float | None = None
        track_temp_c: float | None = None
        humidity_pct: float | None = None
        wind_kph: float | None = None
        wind_direction: str | float | None = None
        time_of_day: str | None = None

    id: str
    role: str = "reference"
    driver_name: str = ""
    source_driver_name: str | None = None
    driver_key: str | None = None
    lap_time: float = 0.0
    irating: int | None = None
    file_name: str | None = None
    recorded_at: str | None = None
    source: str | None = None
    conditions: LapConditionsInput | None = None


class UploadedTelemetryInput(BaseModel):
    id: str
    file_name: str
    csv_data: str
    role: str = "reference"
    driver_name: str = ""
    source_driver_name: str | None = None
    driver_key: str | None = None
    lap_time: float = 0.0
    irating: int | None = None
    recorded_at: str | None = None
    car_name: str | None = None
    track_name: str | None = None
    source: str = "custom"
    conditions: LapMetaInput.LapConditionsInput | None = None


class RunAnalysisRequest(BaseModel):
    lap_id: str
    reference_lap_ids: list[str]
    car_name: str
    track_name: str
    analysis_mode: str = "vs_reference"  # "vs_reference" or "solo"
    laps_metadata: list[LapMetaInput] | None = None
    llm_provider: str = "claude"  # "claude" or "gemini"
    prompt_version: str | None = None  # named prompt; None → model default
    uploaded_telemetry: list[UploadedTelemetryInput] | None = None


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
    prompt_version: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _enqueued_response(record: AnalysisResult) -> dict[str, Any]:
    """Return a minimal response for a newly enqueued or in-progress record."""
    input_data = record.input_json or {}
    return {
        "id": str(record.id),
        "status": record.status,
        "lap_id": record.lap_id,
        "reference_lap_ids": record.reference_lap_ids,
        "car_name": record.car_name,
        "track_name": record.track_name,
        "created_at": record.created_at.isoformat(),
        "enqueued_at": record.enqueued_at.isoformat() if record.enqueued_at else None,
        "analysis_mode": (record.input_json or {}).get("analysis_mode", "vs_reference"),
        "llm_provider": input_data.get("llm_provider"),
        "prompt_version": input_data.get("prompt_version"),
    }


def _completed_response(record: AnalysisResult) -> dict[str, Any]:
    enriched = dict(record.result_json or {})
    input_data = record.input_json or {}
    enriched["id"] = str(record.id)
    enriched["status"] = record.status
    enriched["created_at"] = record.created_at.isoformat()
    enriched["enqueued_at"] = record.enqueued_at.isoformat() if record.enqueued_at else None
    enriched["share_token"] = record.share_token
    if not enriched.get("prompt_version"):
        enriched["prompt_version"] = input_data.get("prompt_version")
    return enriched


def _failed_response(record: AnalysisResult) -> dict[str, Any]:
    input_data = record.input_json or {}
    return {
        "id": str(record.id),
        "status": "failed",
        "error_message": record.error_message or "Analysis failed",
        "lap_id": record.lap_id,
        "reference_lap_ids": record.reference_lap_ids,
        "car_name": record.car_name,
        "track_name": record.track_name,
        "created_at": record.created_at.isoformat(),
        "enqueued_at": record.enqueued_at.isoformat() if record.enqueued_at else None,
        "llm_provider": input_data.get("llm_provider"),
        "prompt_version": input_data.get("prompt_version"),
    }


def _record_response(record: AnalysisResult) -> dict[str, Any]:
    if record.status == "completed":
        return _completed_response(record)
    if record.status == "failed":
        return _failed_response(record)
    return _enqueued_response(record)

def _resolve_uploaded_context(body: RunAnalysisRequest) -> tuple[str, str, list[dict[str, Any]] | None]:
    uploaded = [_normalize_lap_meta_dict(item.model_dump()) for item in (body.uploaded_telemetry or [])]
    if not uploaded:
        return body.car_name, body.track_name, None

    upload_map = {item["id"]: item for item in uploaded}

    car_name = body.car_name.strip() if body.car_name.strip() else ""
    track_name = body.track_name.strip() if body.track_name.strip() else ""
    primary_upload = upload_map.get(body.lap_id)
    if not car_name and primary_upload:
        car_name = str(primary_upload.get("car_name") or "").strip()
    if not track_name and primary_upload:
        track_name = str(primary_upload.get("track_name") or "").strip()

    if not car_name or not track_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Car and track are required for uploaded telemetry analyses",
        )

    return car_name, track_name, uploaded


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
        logger.warning(
            "Rejecting analysis request with no reference laps: lap_id=%s car=%r track=%r mode=%s laps_metadata_count=%d",
            body.lap_id,
            body.car_name,
            body.track_name,
            body.analysis_mode,
            len(body.laps_metadata or []),
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one additional lap ID is required",
        )

    car_name, track_name, uploaded_telemetry = _resolve_uploaded_context(body)

    # ----- Cache lookup (only match completed records) -----
    if not uploaded_telemetry:
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
                    enriched["laps_metadata"] = [_normalize_lap_meta_dict(m.model_dump()) for m in body.laps_metadata]
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
        [_normalize_lap_meta_dict(m.model_dump()) for m in body.laps_metadata] if body.laps_metadata else None
    )
    now = datetime.now(timezone.utc)
    car = await resolve_or_create_car(db, car_name)
    track = await resolve_or_create_track(db, track_name)
    record = AnalysisResult(
        user_id=current_user.id,
        lap_id=body.lap_id,
        reference_lap_ids=body.reference_lap_ids,
        car_id=car.id,
        track_id=track.id,
        car_name=car_name,
        track_name=track_name,
        result_json={},
        status="enqueued",
        input_json={
            "analysis_mode": body.analysis_mode,
            "laps_metadata": laps_metadata,
            "llm_provider": body.llm_provider,
            "prompt_version": body.prompt_version,
            "uploaded_telemetry": uploaded_telemetry,
        },
        created_at=now,
        enqueued_at=now,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)

    return _enqueued_response(record)


@router.post("/inspect-upload")
async def inspect_uploaded_telemetry(
    files: list[UploadFile] = File(...),
    _current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for file in files:
        contents = await file.read()
        text = contents.decode("utf-8", errors="replace")
        results.append(inspect_upload(file.filename or "upload.csv", text))
    return results


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
                prompt_version=rj.get("prompt_version") or input_data.get("prompt_version"),
            )
        )

    return history


@router.get("/shared/{share_token}")
async def get_shared_analysis(
    share_token: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Public endpoint — returns a read-only analysis result by share token. No auth required."""
    result = await db.execute(
        select(AnalysisResult).where(AnalysisResult.share_token == share_token)
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared analysis not found")

    if record.status != "completed":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not yet available")

    return _completed_response(record)


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


@router.post("/{analysis_id}/share")
async def share_analysis(
    analysis_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Generate a share token for an analysis, allowing public read-only access."""
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

    if not record.share_token:
        record.share_token = secrets.token_urlsafe(32)
        await db.flush()

    return {"share_token": record.share_token}
