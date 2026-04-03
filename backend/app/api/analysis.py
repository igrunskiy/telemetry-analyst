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
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.analysis.worker import get_active_job_count
from app.analysis.lap_metadata import canonical_driver_name as _canonical_driver_name
from app.analysis.lap_metadata import driver_key as _driver_key
from app.analysis.lap_metadata import normalize_lap_meta_dict as _normalize_lap_meta_dict
from app.analysis.upload_inspector import inspect_upload_with_llm
from app.auth.crypto import decrypt
from app.auth.jwt import get_current_user, has_staff_access
from app.config import settings
from app.database import get_db
from app.llm_access import require_llm_provider_access
from app.models.analysis import AnalysisResult
from app.models.analysis_telemetry_file import AnalysisTelemetryFile
from app.models.telemetry_car import TelemetryCar
from app.models.telemetry_track import TelemetryTrack
from app.models.user import User
from app.telemetry.catalog import decompress_csv, resolve_or_create_car, resolve_or_create_track

router = APIRouter(prefix="/api/analysis", tags=["analysis"])
logger = logging.getLogger(__name__)
_MAX_REFERENCE_LAPS = 5


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class LapMetaInput(BaseModel):
    class LapConditionsInput(BaseModel):
        summary: str | None = None
        setup_type: str | None = None
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


class AnalysisVersionSummaryResponse(BaseModel):
    id: str
    version_number: int
    created_at: datetime
    status: str
    is_default_version: bool
    llm_provider: str | None = None
    model_name: str | None = None
    prompt_version: str | None = None


class ReportFeedbackRequest(BaseModel):
    selected_text: str
    comment: str = ""


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
        "version_group_id": str(record.version_group_id or record.id),
        "version_number": record.version_number,
        "is_default_version": record.is_default_version,
    }


def _completed_response(record: AnalysisResult) -> dict[str, Any]:
    enriched = dict(record.result_json or {})
    input_data = record.input_json or {}
    enriched["id"] = str(record.id)
    enriched["user_id"] = str(record.user_id)
    enriched["status"] = record.status
    enriched["created_at"] = record.created_at.isoformat()
    enriched["enqueued_at"] = record.enqueued_at.isoformat() if record.enqueued_at else None
    enriched["share_token"] = record.share_token
    enriched["version_group_id"] = str(record.version_group_id or record.id)
    enriched["version_number"] = record.version_number
    enriched["is_default_version"] = record.is_default_version
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
        "version_group_id": str(record.version_group_id or record.id),
        "version_number": record.version_number,
        "is_default_version": record.is_default_version,
    }


def _record_response(record: AnalysisResult) -> dict[str, Any]:
    if record.status == "completed":
        return _completed_response(record)
    if record.status == "failed":
        return _failed_response(record)
    return _enqueued_response(record)


def _version_group_id_for(record: AnalysisResult) -> uuid.UUID:
    return record.version_group_id or record.id


def _version_summary(record: AnalysisResult) -> dict[str, Any]:
    result_data = record.result_json or {}
    input_data = record.input_json or {}
    return {
        "id": str(record.id),
        "version_number": record.version_number,
        "created_at": record.created_at.isoformat(),
        "status": record.status,
        "is_default_version": record.is_default_version,
        "llm_provider": input_data.get("llm_provider") or result_data.get("llm_provider"),
        "model_name": result_data.get("model_name"),
        "prompt_version": result_data.get("prompt_version") or input_data.get("prompt_version"),
    }


async def _attach_version_history(payload: dict[str, Any], record: AnalysisResult, db: AsyncSession) -> dict[str, Any]:
    group_id = _version_group_id_for(record)
    version_result = await db.execute(
        select(AnalysisResult)
        .where(AnalysisResult.version_group_id == group_id)
        .order_by(AnalysisResult.version_number.desc(), AnalysisResult.created_at.desc())
    )
    versions = version_result.scalars().all()
    payload["version_group_id"] = str(group_id)
    payload["version_number"] = record.version_number
    payload["is_default_version"] = record.is_default_version
    payload["available_versions"] = [_version_summary(item) for item in versions]
    return payload


async def _clone_analysis_telemetry_files(
    *,
    source_analysis_id: uuid.UUID,
    target_analysis_id: uuid.UUID,
    db: AsyncSession,
) -> None:
    source_result = await db.execute(
        select(AnalysisTelemetryFile).where(AnalysisTelemetryFile.analysis_result_id == source_analysis_id)
    )
    for row in source_result.scalars().all():
        db.add(AnalysisTelemetryFile(
            analysis_result_id=target_analysis_id,
            lap_id=row.lap_id,
            file_name=row.file_name,
            compression=row.compression,
            csv_blob=row.csv_blob,
        ))


@router.get("/{analysis_id}/telemetry/{lap_id}")
async def download_analysis_telemetry(
    analysis_id: str,
    lap_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        uid = uuid.UUID(analysis_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid analysis ID format")

    query = select(AnalysisResult).where(AnalysisResult.id == uid)
    if not has_staff_access(current_user.role):
        query = query.where(AnalysisResult.user_id == current_user.id)

    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found")

    file_result = await db.execute(
        select(AnalysisTelemetryFile).where(
            AnalysisTelemetryFile.analysis_result_id == record.id,
            AnalysisTelemetryFile.lap_id == lap_id,
        )
    )
    telemetry_file = file_result.scalar_one_or_none()
    if telemetry_file is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stored telemetry not found")

    csv_text = decompress_csv(telemetry_file.csv_blob, telemetry_file.compression)
    headers = {
        "Content-Disposition": f'attachment; filename="{telemetry_file.file_name}"'
    }
    return Response(content=csv_text, media_type="text/csv; charset=utf-8", headers=headers)


@router.post("/{analysis_id}/feedback", status_code=status.HTTP_201_CREATED)
async def submit_analysis_feedback(
    analysis_id: str,
    body: ReportFeedbackRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        uid = uuid.UUID(analysis_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid analysis ID format")

    query = select(AnalysisResult).where(AnalysisResult.id == uid)
    if not has_staff_access(current_user.role):
        query = query.where(AnalysisResult.user_id == current_user.id)

    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found")

    selected_text = body.selected_text.strip()
    comment = body.comment.strip()
    if not selected_text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected text is required")
    if len(selected_text) > 4000:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected text is too long")
    if len(comment) > 4000:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Comment is too long")

    result_json = dict(record.result_json or {})
    feedback_items = list(result_json.get("user_feedback_items") or [])
    feedback = {
        "id": str(uuid.uuid4()),
        "analysis_id": str(record.id),
        "version_number": record.version_number,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "user_id": str(current_user.id),
        "user_display_name": current_user.display_name,
        "selected_text": selected_text,
        "comment": comment,
        "reviewed_at": None,
    }
    feedback_items.append(feedback)
    result_json["user_feedback_items"] = feedback_items
    record.result_json = result_json
    await db.commit()
    return {"feedback": feedback}


@router.delete("/{analysis_id}/feedback/{feedback_id}", status_code=status.HTTP_200_OK)
async def delete_analysis_feedback(
    analysis_id: str,
    feedback_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        uid = uuid.UUID(analysis_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid analysis ID format")

    query = select(AnalysisResult).where(AnalysisResult.id == uid)
    if not has_staff_access(current_user.role):
        query = query.where(AnalysisResult.user_id == current_user.id)

    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found")

    result_json = dict(record.result_json or {})
    feedback_items = list(result_json.get("user_feedback_items") or [])
    target_item = next((item for item in feedback_items if str(item.get("id")) == feedback_id), None)
    if target_item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found")

    if not has_staff_access(current_user.role) and str(target_item.get("user_id")) != str(current_user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to delete this feedback")

    result_json["user_feedback_items"] = [
        item for item in feedback_items if str(item.get("id")) != feedback_id
    ]
    record.result_json = result_json
    await db.commit()
    return {"ok": True}

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


def _normalize_requested_laps(
    lap_id: str,
    reference_lap_ids: list[str],
    analysis_mode: str,
    laps_metadata: list[dict[str, Any]] | None,
    uploaded_telemetry: list[dict[str, Any]] | None,
) -> tuple[list[str], list[dict[str, Any]] | None, list[dict[str, Any]] | None]:
    seen: set[str] = {lap_id}
    normalized_refs: list[str] = []
    for ref_id in reference_lap_ids:
        if ref_id in seen:
            continue
        normalized_refs.append(ref_id)
        seen.add(ref_id)
        if len(normalized_refs) >= _MAX_REFERENCE_LAPS:
            break

    if len(reference_lap_ids) > len(normalized_refs):
        logger.warning(
            "Trimming analysis lap set: mode=%s primary=%s requested_refs=%d kept_refs=%d",
            analysis_mode,
            lap_id,
            len(reference_lap_ids),
            len(normalized_refs),
        )

    allowed_ids = {lap_id, *normalized_refs}
    filtered_meta = [item for item in (laps_metadata or []) if str(item.get("id")) in allowed_ids] or None
    filtered_uploads = [item for item in (uploaded_telemetry or []) if str(item.get("id")) in allowed_ids] or None
    return normalized_refs, filtered_meta, filtered_uploads


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
    laps_metadata = (
        [_normalize_lap_meta_dict(m.model_dump()) for m in body.laps_metadata] if body.laps_metadata else None
    )
    normalized_refs, laps_metadata, uploaded_telemetry = _normalize_requested_laps(
        body.lap_id,
        body.reference_lap_ids,
        body.analysis_mode,
        laps_metadata,
        uploaded_telemetry,
    )

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
            if set(record.reference_lap_ids) == set(normalized_refs):
                response.status_code = status.HTTP_200_OK
                enriched = _completed_response(record)
                if laps_metadata:
                    enriched["laps_metadata"] = laps_metadata
                return enriched

    try:
        provider_access = await require_llm_provider_access(current_user, body.llm_provider, db)
    except PermissionError as exc:
        detail = str(exc)
        status_code = status.HTTP_429_TOO_MANY_REQUESTS if "quota" in detail.lower() else status.HTTP_403_FORBIDDEN
        raise HTTPException(status_code=status_code, detail=detail) from exc

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
    now = datetime.now(timezone.utc)
    car = await resolve_or_create_car(db, car_name)
    track = await resolve_or_create_track(db, track_name)
    record = AnalysisResult(
        user_id=current_user.id,
        lap_id=body.lap_id,
        reference_lap_ids=normalized_refs,
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
            "llm_key_source": provider_access["key_source"],
            "used_shared_provider": provider_access["key_source"] == "shared",
            "uploaded_telemetry": uploaded_telemetry,
        },
        created_at=now,
        enqueued_at=now,
    )
    db.add(record)
    await db.flush()
    if record.version_group_id is None:
        record.version_group_id = record.id
    await db.refresh(record)

    return _enqueued_response(record)


@router.post("/inspect-upload")
async def inspect_uploaded_telemetry(
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    car_result = await db.execute(
        select(TelemetryCar.name).where(TelemetryCar.source == "garage61").order_by(TelemetryCar.updated_at.desc())
    )
    track_result = await db.execute(
        select(TelemetryTrack.display_name).where(TelemetryTrack.source == "garage61").order_by(TelemetryTrack.updated_at.desc())
    )
    car_candidates = [name for name in car_result.scalars().all() if name]
    track_candidates = [name for name in track_result.scalars().all() if name]
    claude_key = decrypt(current_user.claude_api_key_enc) if current_user.claude_api_key_enc else ""
    gemini_key = decrypt(current_user.gemini_api_key_enc) if current_user.gemini_api_key_enc else ""

    if not claude_key and not gemini_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="A personal Claude or Gemini API key is required in Profile before using telemetry inspection.",
        )

    results: list[dict[str, Any]] = []
    for file in files:
        contents = await file.read()
        text = contents.decode("utf-8", errors="replace")
        results.append(
            await inspect_upload_with_llm(
                file.filename or "upload.csv",
                text,
                car_candidates=car_candidates,
                track_candidates=track_candidates,
                claude_api_key=claude_key,
                gemini_api_key=gemini_key,
            )
        )
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
    if not has_staff_access(current_user.role):
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

    owner = current_user
    if str(record.user_id) != str(current_user.id):
        owner_result = await db.execute(select(User).where(User.id == record.user_id))
        owner = owner_result.scalar_one_or_none()
        if owner is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis owner not found")

    input_data = record.input_json or {}
    llm_provider = input_data.get("llm_provider") or (record.result_json or {}).get("llm_provider") or "claude"
    try:
        provider_access = await require_llm_provider_access(owner, llm_provider, db)
    except PermissionError as exc:
        detail = str(exc)
        status_code = status.HTTP_429_TOO_MANY_REQUESTS if "quota" in detail.lower() else status.HTTP_403_FORBIDDEN
        raise HTTPException(status_code=status_code, detail=detail) from exc

    existing_rj = record.result_json or {}
    base_input = dict(record.input_json or {})
    if not base_input:
        base_input = {
            "analysis_mode": existing_rj.get("analysis_mode", "vs_reference"),
            "laps_metadata": existing_rj.get("laps_metadata"),
        }
    base_input = {
        **base_input,
        "llm_provider": llm_provider,
        "llm_key_source": provider_access["key_source"],
        "used_shared_provider": provider_access["key_source"] == "shared",
        "source_analysis_id": str(record.id),
    }

    group_id = _version_group_id_for(record)
    next_version_result = await db.execute(
        select(func.max(AnalysisResult.version_number)).where(AnalysisResult.version_group_id == group_id)
    )
    next_version_number = int(next_version_result.scalar() or 0) + 1

    await db.execute(
        update(AnalysisResult)
        .where(AnalysisResult.version_group_id == group_id)
        .values(is_default_version=False)
    )

    now = datetime.now(timezone.utc)
    new_record = AnalysisResult(
        user_id=record.user_id,
        lap_id=record.lap_id,
        reference_lap_ids=record.reference_lap_ids or [],
        car_id=record.car_id,
        track_id=record.track_id,
        car_name=record.car_name,
        track_name=record.track_name,
        result_json={},
        status="enqueued",
        input_json=base_input,
        created_at=now,
        enqueued_at=now,
        version_group_id=group_id,
        version_number=next_version_number,
        is_default_version=True,
    )
    db.add(new_record)
    await db.flush()
    await _clone_analysis_telemetry_files(
        source_analysis_id=record.id,
        target_analysis_id=new_record.id,
        db=db,
    )
    await db.flush()

    return _enqueued_response(new_record)


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
        )
    )
    record = result.scalar_one_or_none()

    if record is not None and not (has_staff_access(current_user.role) or record.user_id == current_user.id):
        record = None

    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis not found",
        )

    await db.delete(record)
    await db.commit()


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
    if not has_staff_access(current_user.role):
        query = query.where(AnalysisResult.user_id == current_user.id)

    result = await db.execute(query)
    record = result.scalar_one_or_none()

    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis not found",
        )

    if not has_staff_access(current_user.role) and record.version_group_id and record.id == record.version_group_id:
        default_result = await db.execute(
            select(AnalysisResult)
            .where(
                AnalysisResult.version_group_id == record.version_group_id,
                AnalysisResult.is_default_version == True,
            )
            .order_by(AnalysisResult.version_number.desc())
            .limit(1)
        )
        record = default_result.scalar_one_or_none() or record

    payload = _record_response(record)
    if has_staff_access(current_user.role):
        payload = await _attach_version_history(payload, record, db)
    return payload


@router.post("/{analysis_id}/set-default")
async def set_default_analysis_version(
    analysis_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    try:
        uid = uuid.UUID(analysis_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid analysis ID format")

    result = await db.execute(select(AnalysisResult).where(AnalysisResult.id == uid))
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analysis not found")

    group_id = _version_group_id_for(record)
    await db.execute(
        update(AnalysisResult)
        .where(AnalysisResult.version_group_id == group_id)
        .values(is_default_version=False)
    )
    record.is_default_version = True
    await db.flush()

    payload = _record_response(record)
    payload = await _attach_version_history(payload, record, db)
    return payload


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
