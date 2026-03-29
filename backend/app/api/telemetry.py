from __future__ import annotations

import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.analysis.upload_inspector import inspect_upload
from app.auth.jwt import get_current_user
from app.database import get_db
from app.models.telemetry_car import TelemetryCar
from app.models.telemetry_track import TelemetryTrack
from app.models.uploaded_telemetry import UploadedTelemetry
from app.models.user import User
from app.telemetry.catalog import (
    compress_csv,
    driver_key,
    list_combined_recent_laps,
    list_garage61_cars,
    list_garage61_tracks,
    resolve_or_create_car,
    resolve_or_create_track,
    sync_garage61_dictionary,
)

router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])


class ImportedTelemetryResponse(BaseModel):
    id: str
    file_name: str
    car_name: str
    track_name: str
    driver_name: str
    driver_key: str | None = None
    lap_time: float
    recorded_at: str | None = None
    sample_count: int = 0
    track_length_m: float | None = None
    created_at: str
    source: str = "upload"


class ImportedTelemetryUpdateRequest(BaseModel):
    car_name: str
    track_name: str
    driver_name: str
    lap_time: float
    recorded_at: str | None = None


class Garage61DictionaryEntryResponse(BaseModel):
    id: str
    entry_type: str
    name: str
    variant: str | None = None
    display_name: str


def _row_to_response(row: UploadedTelemetry) -> ImportedTelemetryResponse:
    car_name = row.car.name if row.car else row.car_name
    track_name = row.track.display_name if row.track else row.track_name
    return ImportedTelemetryResponse(
        id=f"upload:{row.id}",
        file_name=row.file_name,
        car_name=car_name,
        track_name=track_name,
        driver_name=row.driver_name,
        driver_key=row.driver_key,
        lap_time=row.lap_time_ms,
        recorded_at=row.recorded_at,
        sample_count=row.sample_count,
        track_length_m=row.track_length_m,
        created_at=row.created_at.isoformat(),
    )


def _parse_import_id(value: str) -> uuid.UUID:
    raw = value[7:] if value.startswith("upload:") else value
    try:
        return uuid.UUID(raw)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Imported telemetry not found") from exc


@router.post("/imports", response_model=list[ImportedTelemetryResponse], status_code=status.HTTP_201_CREATED)
async def import_telemetry_files(
    files: list[UploadFile] = File(...),
    metadata_json: str = Form(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ImportedTelemetryResponse]:
    try:
        metadata_items = json.loads(metadata_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid metadata_json payload") from exc

    if not isinstance(metadata_items, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="metadata_json must be a list")

    metadata_by_name = {
        str(item.get("file_name")): item
        for item in metadata_items
        if isinstance(item, dict) and item.get("file_name")
    }
    import_batch_id = uuid.uuid4()
    created: list[UploadedTelemetry] = []

    for file in files:
        file_name = file.filename or "upload.csv"
        item = metadata_by_name.get(file_name)
        if item is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Missing metadata for {file_name}")
        contents = await file.read()
        text = contents.decode("utf-8", errors="replace")
        inspection = inspect_upload(file_name, text)

        car_name = str(item.get("car_name") or inspection["metadata"].get("car_name") or "").strip()
        track_name = str(item.get("track_name") or inspection["metadata"].get("track_name") or "").strip()
        if not car_name or not track_name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Car and track are required for {file_name}",
            )

        driver_name = " ".join(str(item.get("driver_name") or current_user.display_name or "").split()).strip()
        source_driver_name = " ".join(str(item.get("source_driver_name") or driver_name).split()).strip() or None
        lap_time = float(item.get("lap_time") or inspection["metadata"].get("lap_time") or 0)
        car = await resolve_or_create_car(db, car_name)
        track = await resolve_or_create_track(db, track_name)

        row = UploadedTelemetry(
            user_id=current_user.id,
            import_batch_id=import_batch_id,
            file_name=file_name,
            compression="gzip",
            csv_blob=compress_csv(text),
            car_id=car.id,
            track_id=track.id,
            car_name=car_name,
            track_name=track_name,
            driver_name=driver_name,
            source_driver_name=source_driver_name,
            driver_key=str(item.get("driver_key") or driver_key(driver_name) or "") or None,
            lap_time_ms=lap_time,
            recorded_at=str(item.get("recorded_at") or inspection["metadata"].get("recorded_at") or "").strip() or None,
            sample_count=int(item.get("sample_count") or inspection.get("sample_count") or 0),
            track_length_m=inspection.get("track_length_m"),
        )
        db.add(row)
        created.append(row)

    await db.flush()
    for row in created:
        await db.refresh(row)
    return [_row_to_response(row) for row in created]


@router.get("/imports", response_model=list[ImportedTelemetryResponse])
async def list_imported_telemetry(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ImportedTelemetryResponse]:
    result = await db.execute(
        select(UploadedTelemetry)
        .options(selectinload(UploadedTelemetry.car), selectinload(UploadedTelemetry.track))
        .where(UploadedTelemetry.user_id == current_user.id)
        .order_by(UploadedTelemetry.created_at.desc())
        .limit(200)
    )
    return [_row_to_response(row) for row in result.scalars().all()]


@router.patch("/imports/{import_id}", response_model=ImportedTelemetryResponse)
async def update_imported_telemetry(
    import_id: str,
    payload: ImportedTelemetryUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ImportedTelemetryResponse:
    result = await db.execute(
        select(UploadedTelemetry)
        .options(selectinload(UploadedTelemetry.car), selectinload(UploadedTelemetry.track))
        .where(
            UploadedTelemetry.id == _parse_import_id(import_id),
            UploadedTelemetry.user_id == current_user.id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Imported telemetry not found")

    car_name = payload.car_name.strip()
    track_name = payload.track_name.strip()
    driver_name = " ".join(payload.driver_name.split()).strip()
    if not car_name or not track_name or not driver_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Car, track, and driver are required",
        )

    car = await resolve_or_create_car(db, car_name)
    track = await resolve_or_create_track(db, track_name)
    row.car_id = car.id
    row.track_id = track.id
    row.car_name = car_name
    row.track_name = track_name
    row.driver_name = driver_name
    row.source_driver_name = driver_name
    row.driver_key = driver_key(driver_name)
    row.lap_time_ms = float(payload.lap_time or 0)
    row.recorded_at = payload.recorded_at.strip() if payload.recorded_at else None

    await db.flush()
    await db.refresh(row)
    return _row_to_response(row)


@router.delete("/imports/{import_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_imported_telemetry(
    import_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(UploadedTelemetry).where(
            UploadedTelemetry.id == _parse_import_id(import_id),
            UploadedTelemetry.user_id == current_user.id,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Imported telemetry not found")
    await db.delete(row)


@router.get("/recent")
async def list_recent_telemetry(
    limit: int = 10,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict[str, Any]]:
    return await list_combined_recent_laps(current_user, db, limit)


@router.post("/dictionary/sync")
async def sync_dictionary(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    return await sync_garage61_dictionary(current_user, db)


@router.get("/dictionary/{entry_type}", response_model=list[Garage61DictionaryEntryResponse])
async def list_dictionary(
    entry_type: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Garage61DictionaryEntryResponse]:
    if entry_type not in {"car", "track"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dictionary not found")
    entries = await (list_garage61_cars(db) if entry_type == "car" else list_garage61_tracks(db))
    if not entries and current_user.access_token_enc:
        await sync_garage61_dictionary(current_user, db)
        entries = await (list_garage61_cars(db) if entry_type == "car" else list_garage61_tracks(db))
    return [
        Garage61DictionaryEntryResponse(
            id=row.platform_id,
            entry_type=entry_type,
            name=row.name,
            variant=(row.variant if isinstance(row, TelemetryTrack) else None),
            display_name=(row.display_name if isinstance(row, TelemetryTrack) else row.name),
        )
        for row in entries
    ]
