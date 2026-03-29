from __future__ import annotations

import gzip
import uuid
from collections import defaultdict
from typing import Any
from urllib.parse import quote, unquote

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import logging

from app.auth.crypto import decrypt
from app.garage61.client import Garage61Client

logger = logging.getLogger(__name__)
from app.models.telemetry_car import TelemetryCar
from app.models.telemetry_track import TelemetryTrack
from app.models.uploaded_telemetry import UploadedTelemetry
from app.models.user import User


SOURCE_GARAGE61 = "garage61"
SOURCE_UPLOAD = "upload"
SOURCE_CUSTOM = "custom"


def make_lap_id(source: str, raw_id: str) -> str:
    return f"{source}:{raw_id}"


def parse_lap_id(value: str) -> tuple[str, str]:
    if ":" in value:
        prefix, raw = value.split(":", 1)
        if prefix in {SOURCE_GARAGE61, SOURCE_UPLOAD}:
            return prefix, raw
    return SOURCE_GARAGE61, value


def make_car_key(source: str, value: str | int | uuid.UUID) -> str:
    if source == SOURCE_GARAGE61:
        return f"{SOURCE_GARAGE61}-car:{value}"
    return f"{SOURCE_UPLOAD}-car:{quote(str(value), safe='')}"


def make_track_key(source: str, value: str | int | uuid.UUID) -> str:
    if source == SOURCE_GARAGE61:
        return f"{SOURCE_GARAGE61}-track:{value}"
    return f"{SOURCE_UPLOAD}-track:{quote(str(value), safe='')}"


def parse_catalog_key(value: str | None, expected_kind: str) -> tuple[str | None, str | None]:
    if not value or ":" not in value:
        return None, None
    prefix, raw = value.split(":", 1)
    if prefix == f"{SOURCE_GARAGE61}-{expected_kind}":
        return SOURCE_GARAGE61, raw
    if prefix == f"{SOURCE_UPLOAD}-{expected_kind}":
        return SOURCE_UPLOAD, unquote(raw)
    return None, None


def compress_csv(content: str) -> bytes:
    return gzip.compress(content.encode("utf-8"))


def decompress_csv(blob: bytes, compression: str) -> str:
    if compression == "gzip":
        return gzip.decompress(blob).decode("utf-8", errors="replace")
    return blob.decode("utf-8", errors="replace")


def canonical_driver_name(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(value.split()).strip()


def driver_key(value: str | None) -> str | None:
    normalized = canonical_driver_name(value).lower()
    key = "".join(ch for ch in normalized if ch.isalnum())
    return key or None


def normalize_catalog_name(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(value.split()).strip().casefold()


async def get_optional_garage61_client(user: User, db: AsyncSession) -> Garage61Client | None:
    if not user.access_token_enc:
        return None
    access_token = decrypt(user.access_token_enc)
    refresh_token = decrypt(user.refresh_token_enc) if user.refresh_token_enc else None
    return Garage61Client(
        access_token=access_token,
        refresh_token=refresh_token,
        user_id=str(user.garage61_user_id or user.id),
        db=db,
    )


def _format_track_name(track: dict[str, Any]) -> str:
    name = track.get("name") or "Unknown track"
    variant = track.get("variant") or track.get("config")
    if variant and str(variant).strip() and variant != name:
        return f"{name} - {variant}"
    return name


async def list_garage61_cars(db: AsyncSession) -> list[TelemetryCar]:
    result = await db.execute(
        select(TelemetryCar)
        .where(TelemetryCar.source == SOURCE_GARAGE61)
        .order_by(TelemetryCar.name.asc())
    )
    return list(result.scalars().all())


async def list_garage61_tracks(db: AsyncSession) -> list[TelemetryTrack]:
    result = await db.execute(
        select(TelemetryTrack)
        .where(TelemetryTrack.source == SOURCE_GARAGE61)
        .order_by(TelemetryTrack.display_name.asc())
    )
    return list(result.scalars().all())


async def _find_car_by_name(db: AsyncSession, name: str) -> TelemetryCar | None:
    result = await db.execute(
        select(TelemetryCar)
        .where(TelemetryCar.normalized_name == normalize_catalog_name(name))
        .order_by(TelemetryCar.source.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _find_track_by_name(db: AsyncSession, display_name: str) -> TelemetryTrack | None:
    result = await db.execute(
        select(TelemetryTrack)
        .where(TelemetryTrack.normalized_name == normalize_catalog_name(display_name))
        .order_by(TelemetryTrack.source.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def resolve_or_create_car(db: AsyncSession, name: str) -> TelemetryCar:
    existing = await _find_car_by_name(db, name)
    if existing is not None:
        return existing
    car = TelemetryCar(
        source=SOURCE_CUSTOM,
        platform_id=None,
        name=name.strip(),
        normalized_name=normalize_catalog_name(name),
    )
    db.add(car)
    await db.flush()
    return car


async def resolve_or_create_track(db: AsyncSession, display_name: str) -> TelemetryTrack:
    existing = await _find_track_by_name(db, display_name)
    if existing is not None:
        return existing
    track = TelemetryTrack(
        source=SOURCE_CUSTOM,
        platform_id=None,
        name=display_name.strip(),
        variant=None,
        display_name=display_name.strip(),
        normalized_name=normalize_catalog_name(display_name),
    )
    db.add(track)
    await db.flush()
    return track


async def sync_garage61_dictionary(user: User, db: AsyncSession) -> dict[str, int]:
    garage61 = await get_optional_garage61_client(user, db)
    if not garage61:
        return {"cars": 0, "tracks": 0}

    cars = [item for item in await garage61.get_cars() if isinstance(item, dict)]
    tracks = [item for item in await garage61.get_tracks() if isinstance(item, dict)]

    existing_cars = {(row.source, row.platform_id): row for row in await list_garage61_cars(db)}
    existing_tracks = {(row.source, row.platform_id): row for row in await list_garage61_tracks(db)}

    car_count = 0
    for item in cars:
        platform_id = str(item.get("id") or "").strip()
        if not platform_id:
            continue
        name = str(item.get("name") or "Unknown car").strip() or "Unknown car"
        row = existing_cars.get((SOURCE_GARAGE61, platform_id))
        if row is None:
            row = TelemetryCar(
                source=SOURCE_GARAGE61,
                platform_id=platform_id,
                name=name,
                normalized_name=normalize_catalog_name(name),
            )
            db.add(row)
        else:
            row.name = name
            row.normalized_name = normalize_catalog_name(name)
        car_count += 1

    track_count = 0
    for item in tracks:
        platform_id = str(item.get("id") or "").strip()
        if not platform_id:
            continue
        name = str(item.get("name") or "Unknown track").strip() or "Unknown track"
        variant = str(item.get("variant") or item.get("config") or "").strip() or None
        display_name = _format_track_name(item)
        row = existing_tracks.get((SOURCE_GARAGE61, platform_id))
        if row is None:
            row = TelemetryTrack(
                source=SOURCE_GARAGE61,
                platform_id=platform_id,
                name=name,
                variant=variant,
                display_name=display_name,
                normalized_name=normalize_catalog_name(display_name),
            )
            db.add(row)
        else:
            row.name = name
            row.variant = variant
            row.display_name = display_name
            row.normalized_name = normalize_catalog_name(display_name)
        track_count += 1

    await db.flush()
    return {"cars": car_count, "tracks": track_count}


def _normalize_uploaded_lap(item: UploadedTelemetry) -> dict[str, Any]:
    car_name = item.car.name if item.car else item.car_name
    track_name = item.track.display_name if item.track else item.track_name
    return {
        "id": make_lap_id(SOURCE_UPLOAD, str(item.id)),
        "lap_time": item.lap_time_ms,
        "car_name": car_name,
        "track_name": track_name,
        "car_id": make_car_key(SOURCE_UPLOAD, item.car_id or car_name),
        "track_id": make_track_key(SOURCE_UPLOAD, item.track_id or track_name),
        "driver_name": item.driver_name,
        "source_driver_name": item.source_driver_name,
        "driver_key": item.driver_key,
        "recorded_at": item.recorded_at or item.created_at.isoformat(),
        "file_name": item.file_name,
        "sample_count": item.sample_count,
        "track_length_m": item.track_length_m,
        "source": SOURCE_UPLOAD,
        "import_batch_id": str(item.import_batch_id),
        "created_at": item.created_at.isoformat(),
    }


def _normalize_garage61_lap(item: dict[str, Any], fallback_id: str) -> dict[str, Any]:
    car = item.get("car") or {}
    track = item.get("track") or item.get("circuit") or {}
    driver = item.get("driver") or item.get("user") or {}
    driver_name = f"{driver.get('firstName', '')} {driver.get('lastName', '')}".strip()
    car_id = item.get("car_id") or item.get("carId") or car.get("id")
    track_id = item.get("track_id") or item.get("trackId") or track.get("id")
    raw_id = str(item.get("id") or item.get("lapId") or item.get("lap_id") or fallback_id)
    return {
        "id": make_lap_id(SOURCE_GARAGE61, raw_id),
        "lap_time": float(item.get("lap_time") or item.get("lapTime") or item.get("lap_time_ms") or item.get("lapTimeMs") or 0),
        "car_name": item.get("car_name") or item.get("carName") or car.get("name") or "Unknown car",
        "track_name": item.get("track_name") or item.get("trackName") or _format_track_name(track),
        "car_id": make_car_key(SOURCE_GARAGE61, car_id) if car_id is not None else None,
        "track_id": make_track_key(SOURCE_GARAGE61, track_id) if track_id is not None else None,
        "driver_name": driver_name,
        "driver_key": driver_key(driver_name),
        "recorded_at": item.get("startTime") or item.get("timestamp") or "",
        "irating": item.get("driverRating"),
        "season": item.get("seasonName") or (item["season"]["name"] if isinstance(item.get("season"), dict) else item.get("season")),
        "source": SOURCE_GARAGE61,
    }


async def list_combined_cars(user: User, db: AsyncSession) -> list[dict[str, Any]]:
    cars: list[dict[str, Any]] = []
    seen_names: set[str] = set()
    garage61_entries = await list_garage61_cars(db)
    if not garage61_entries:
        await sync_garage61_dictionary(user, db)
        garage61_entries = await list_garage61_cars(db)
    for entry in garage61_entries:
        seen_names.add(entry.name.casefold())
        cars.append({
            "id": make_car_key(SOURCE_GARAGE61, entry.platform_id or entry.id),
            "name": entry.name,
            "source": SOURCE_GARAGE61,
            "platform_id": entry.platform_id,
        })

    result = await db.execute(
        select(TelemetryCar)
        .join(UploadedTelemetry, UploadedTelemetry.car_id == TelemetryCar.id)
        .where(UploadedTelemetry.user_id == user.id)
        .distinct()
        .order_by(TelemetryCar.name.asc())
    )
    for entry in result.scalars().all():
        if not entry.name or entry.name.casefold() in seen_names:
            continue
        cars.append({
            "id": make_car_key(SOURCE_UPLOAD, entry.id),
            "name": entry.name,
            "source": SOURCE_UPLOAD,
        })
    return cars


async def list_combined_tracks(user: User, db: AsyncSession) -> list[dict[str, Any]]:
    tracks: list[dict[str, Any]] = []
    seen_names: set[str] = set()
    garage61_entries = await list_garage61_tracks(db)
    if not garage61_entries:
        await sync_garage61_dictionary(user, db)
        garage61_entries = await list_garage61_tracks(db)
    for entry in garage61_entries:
        seen_names.add(entry.display_name.casefold())
        tracks.append({
            "id": make_track_key(SOURCE_GARAGE61, entry.platform_id or entry.id),
            "name": entry.name,
            "variant": entry.variant,
            "source": SOURCE_GARAGE61,
            "platform_id": entry.platform_id,
        })

    result = await db.execute(
        select(TelemetryTrack)
        .join(UploadedTelemetry, UploadedTelemetry.track_id == TelemetryTrack.id)
        .where(UploadedTelemetry.user_id == user.id)
        .distinct()
        .order_by(TelemetryTrack.display_name.asc())
    )
    for entry in result.scalars().all():
        if not entry.display_name or entry.display_name.casefold() in seen_names:
            continue
        tracks.append({
            "id": make_track_key(SOURCE_UPLOAD, entry.id),
            "name": entry.name,
            "variant": entry.variant,
            "source": SOURCE_UPLOAD,
        })
    return tracks


async def _resolve_filter_context(
    user: User,
    db: AsyncSession,
    car_key: str | None,
    track_key: str | None,
) -> tuple[str | None, str | None, int | None, int | None, uuid.UUID | None, uuid.UUID | None]:
    car_source, raw_car = parse_catalog_key(car_key, "car")
    track_source, raw_track = parse_catalog_key(track_key, "track")
    car_name: str | None = None
    track_name: str | None = None
    upload_car_uuid: uuid.UUID | None = None
    upload_track_uuid: uuid.UUID | None = None
    try:
        garage61_car_id = int(raw_car) if car_source == SOURCE_GARAGE61 and raw_car is not None else None
    except ValueError:
        garage61_car_id = None
    try:
        garage61_track_id = int(raw_track) if track_source == SOURCE_GARAGE61 and raw_track is not None else None
    except ValueError:
        garage61_track_id = None

    if car_source == SOURCE_UPLOAD and raw_car:
        try:
            upload_car_uuid = uuid.UUID(raw_car)
            result = await db.execute(select(TelemetryCar).where(TelemetryCar.id == upload_car_uuid))
            entry = result.scalar_one_or_none()
            if entry is not None:
                car_name = entry.name
        except ValueError:
            upload_car_uuid = None
    if track_source == SOURCE_UPLOAD and raw_track:
        try:
            upload_track_uuid = uuid.UUID(raw_track)
            result = await db.execute(select(TelemetryTrack).where(TelemetryTrack.id == upload_track_uuid))
            entry = result.scalar_one_or_none()
            if entry is not None:
                track_name = entry.display_name
        except ValueError:
            upload_track_uuid = None

    car_entries = await list_garage61_cars(db)
    track_entries = await list_garage61_tracks(db)
    if (garage61_car_id is not None or garage61_track_id is not None or car_name or track_name) and (not car_entries or not track_entries):
        await sync_garage61_dictionary(user, db)
        car_entries = await list_garage61_cars(db)
        track_entries = await list_garage61_tracks(db)

    if garage61_car_id is not None:
        for entry in car_entries:
            if entry.platform_id == str(garage61_car_id):
                car_name = entry.name
                break
    if car_name and garage61_car_id is None:
        for entry in car_entries:
            if entry.name.casefold() == car_name.casefold() and entry.platform_id is not None:
                try:
                    garage61_car_id = int(entry.platform_id)
                except ValueError:
                    pass
                break
    if garage61_track_id is not None:
        for entry in track_entries:
            if entry.platform_id == str(garage61_track_id):
                track_name = entry.display_name
                break
    if track_name and garage61_track_id is None:
        for entry in track_entries:
            if entry.display_name.casefold() == track_name.casefold() and entry.platform_id is not None:
                try:
                    garage61_track_id = int(entry.platform_id)
                except ValueError:
                    pass
                break

    return car_name, track_name, garage61_car_id, garage61_track_id, upload_car_uuid, upload_track_uuid


async def list_combined_my_laps(
    user: User,
    db: AsyncSession,
    car_key: str | None,
    track_key: str | None,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    if not car_key or not track_key:
        return []
    car_name, track_name, garage61_car_id, garage61_track_id, upload_car_uuid, upload_track_uuid = await _resolve_filter_context(user, db, car_key, track_key)
    laps: list[dict[str, Any]] = []

    garage61 = await get_optional_garage61_client(user, db)
    if garage61 and garage61_car_id is not None and garage61_track_id is not None:
        data = await garage61.get_my_laps(car_id=garage61_car_id, track_id=garage61_track_id, limit=200, offset=0)
        laps.extend(
            _normalize_garage61_lap(item, f"my-{idx}")
            for idx, item in enumerate(data)
            if isinstance(item, dict)
        )

    # Query uploaded laps by UUID match OR by name match
    upload_filters = [UploadedTelemetry.user_id == user.id]
    if upload_car_uuid and upload_track_uuid:
        upload_filters.append(UploadedTelemetry.car_id == upload_car_uuid)
        upload_filters.append(UploadedTelemetry.track_id == upload_track_uuid)
    elif car_name and track_name:
        matching_car = await _find_car_by_name(db, car_name)
        matching_track = await _find_track_by_name(db, track_name)
        if matching_car and matching_track:
            upload_filters.append(UploadedTelemetry.car_id == matching_car.id)
            upload_filters.append(UploadedTelemetry.track_id == matching_track.id)
        else:
            upload_filters = []  # no matching car/track — skip query

    if upload_filters:
        result = await db.execute(
            select(UploadedTelemetry)
            .options(selectinload(UploadedTelemetry.car), selectinload(UploadedTelemetry.track))
            .where(*upload_filters)
            .order_by(UploadedTelemetry.created_at.desc())
        )
        laps.extend(_normalize_uploaded_lap(item) for item in result.scalars().all())

    laps.sort(key=lambda item: str(item.get("recorded_at") or ""), reverse=True)
    return laps[offset: offset + limit]


async def list_combined_my_sessions(
    user: User,
    db: AsyncSession,
    car_key: str | None,
    track_key: str | None,
    limit: int,
    offset: int,
) -> list[dict[str, Any]]:
    if not car_key or not track_key:
        return []
    car_name, track_name, garage61_car_id, garage61_track_id, upload_car_uuid, upload_track_uuid = await _resolve_filter_context(user, db, car_key, track_key)
    sessions: list[dict[str, Any]] = []

    garage61 = await get_optional_garage61_client(user, db)
    if garage61 and garage61_car_id is not None and garage61_track_id is not None:
        data = await garage61.get_my_sessions(car_id=garage61_car_id, track_id=garage61_track_id, limit=200, offset=0)
        if data:
            for idx, item in enumerate(data):
                if not isinstance(item, dict):
                    continue
                laps = [_normalize_garage61_lap(l, f"session-{idx}-lap-{i}") for i, l in enumerate(item.get("laps") or []) if isinstance(l, dict)]
                lap_times = [float(l.get("lap_time") or 0) for l in laps if l.get("lap_time")]
                sessions.append({
                    "id": make_lap_id(SOURCE_GARAGE61, str(item.get("id") or item.get("sessionId") or f"session-{idx}")),
                    "date": item.get("startTime") or item.get("date") or "",
                    "car_name": item.get("carName") or item.get("car_name") or car_name or "Unknown car",
                    "track_name": item.get("trackName") or item.get("track_name") or track_name or "Unknown track",
                    "car_id": make_car_key(SOURCE_GARAGE61, garage61_car_id),
                    "track_id": make_track_key(SOURCE_GARAGE61, garage61_track_id),
                    "lap_count": len(laps),
                    "best_lap_time": min(lap_times) if lap_times else 0,
                    "laps": laps,
                    "source": SOURCE_GARAGE61,
                })
        else:
            # /sessions not available — fall back to /laps grouped by date
            laps_data = await garage61.get_my_laps(car_id=garage61_car_id, track_id=garage61_track_id, limit=200, offset=0)
            by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
            for idx, item in enumerate(laps_data):
                if not isinstance(item, dict):
                    continue
                lap = _normalize_garage61_lap(item, f"lap-{idx}")
                date_key = (lap.get("recorded_at") or "")[:10]
                by_date[date_key].append(lap)
            for date_key, laps in by_date.items():
                lap_times = [float(l.get("lap_time") or 0) for l in laps if l.get("lap_time")]
                sessions.append({
                    "id": make_lap_id(SOURCE_GARAGE61, f"session-{date_key}"),
                    "date": date_key,
                    "car_name": car_name or "Unknown car",
                    "track_name": track_name or "Unknown track",
                    "car_id": make_car_key(SOURCE_GARAGE61, garage61_car_id),
                    "track_id": make_track_key(SOURCE_GARAGE61, garage61_track_id),
                    "lap_count": len(laps),
                    "best_lap_time": min(lap_times) if lap_times else 0,
                    "laps": sorted(laps, key=lambda l: float(l.get("lap_time") or 0)),
                    "source": SOURCE_GARAGE61,
                })

    upload_filters = [UploadedTelemetry.user_id == user.id]
    if upload_car_uuid and upload_track_uuid:
        upload_filters.append(UploadedTelemetry.car_id == upload_car_uuid)
        upload_filters.append(UploadedTelemetry.track_id == upload_track_uuid)
    elif car_name and track_name:
        matching_car = await _find_car_by_name(db, car_name)
        matching_track = await _find_track_by_name(db, track_name)
        if matching_car and matching_track:
            upload_filters.append(UploadedTelemetry.car_id == matching_car.id)
            upload_filters.append(UploadedTelemetry.track_id == matching_track.id)
        else:
            upload_filters = []

    if upload_filters:
        result = await db.execute(
            select(UploadedTelemetry)
            .options(selectinload(UploadedTelemetry.car), selectinload(UploadedTelemetry.track))
            .where(*upload_filters)
            .order_by(UploadedTelemetry.created_at.asc())
        )
        grouped: dict[str, list[UploadedTelemetry]] = defaultdict(list)
        for item in result.scalars().all():
            date_part = (item.recorded_at or item.created_at.isoformat())[:10]
            group_key = f"{date_part}:{item.car_id or item.car_name}:{item.track_id or item.track_name}"
            grouped[group_key].append(item)
        for batch_id, items in grouped.items():
            laps = [_normalize_uploaded_lap(item) for item in items]
            lap_times = [float(l.get("lap_time") or 0) for l in laps if l.get("lap_time")]
            date = items[0].recorded_at or items[0].created_at.isoformat()
            sessions.append({
                "id": make_lap_id(SOURCE_UPLOAD, f"session-{batch_id}"),
                "date": date,
                "car_name": items[0].car.name if items[0].car else car_name or items[0].car_name,
                "track_name": items[0].track.display_name if items[0].track else track_name or items[0].track_name,
                "car_id": make_car_key(SOURCE_UPLOAD, items[0].car_id or (upload_car_uuid or items[0].car_name)),
                "track_id": make_track_key(SOURCE_UPLOAD, items[0].track_id or (upload_track_uuid or items[0].track_name)),
                "lap_count": len(laps),
                "best_lap_time": min(lap_times) if lap_times else 0,
                "laps": sorted(laps, key=lambda lap: float(lap.get("lap_time") or 0)),
                "source": SOURCE_UPLOAD,
            })

    sessions.sort(key=lambda item: str(item.get("date") or ""), reverse=True)
    return sessions[offset: offset + limit]


async def list_combined_reference_laps(
    user: User,
    db: AsyncSession,
    car_key: str | None,
    track_key: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    if not car_key or not track_key:
        return []
    car_name, track_name, garage61_car_id, garage61_track_id, upload_car_uuid, upload_track_uuid = await _resolve_filter_context(user, db, car_key, track_key)
    laps: list[dict[str, Any]] = []

    garage61 = await get_optional_garage61_client(user, db)
    if garage61 and garage61_car_id is not None and garage61_track_id is not None:
        data = await garage61.get_reference_laps(car_id=garage61_car_id, track_id=garage61_track_id, limit=max(limit, 20))
        laps.extend(
            _normalize_garage61_lap(item, f"ref-{idx}")
            for idx, item in enumerate(data)
            if isinstance(item, dict)
        )

    upload_filters = [UploadedTelemetry.user_id == user.id]
    if upload_car_uuid and upload_track_uuid:
        upload_filters.append(UploadedTelemetry.car_id == upload_car_uuid)
        upload_filters.append(UploadedTelemetry.track_id == upload_track_uuid)
    elif car_name and track_name:
        matching_car = await _find_car_by_name(db, car_name)
        matching_track = await _find_track_by_name(db, track_name)
        if matching_car and matching_track:
            upload_filters.append(UploadedTelemetry.car_id == matching_car.id)
            upload_filters.append(UploadedTelemetry.track_id == matching_track.id)
        else:
            upload_filters = []

    if upload_filters:
        result = await db.execute(
            select(UploadedTelemetry)
            .options(selectinload(UploadedTelemetry.car), selectinload(UploadedTelemetry.track))
            .where(*upload_filters)
            .order_by(UploadedTelemetry.lap_time_ms.asc(), UploadedTelemetry.created_at.desc())
        )
        laps.extend(_normalize_uploaded_lap(item) for item in result.scalars().all())

    laps.sort(key=lambda item: float(item.get("lap_time") or 0) if item.get("lap_time") else float("inf"))
    return laps[:limit]


async def list_combined_recent_laps(user: User, db: AsyncSession, limit: int) -> list[dict[str, Any]]:
    """Return recent activity as session-level entries (one per car+track+date).

    Garage61 data comes from /me/statistics (single API call).
    Uploaded files are grouped by (car, track, date).
    """
    items: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    # --- Garage61: extract from /me/statistics (single API call) ---
    # Each drivingStatistics entry looks like:
    #   {"day": "2024-12-10", "car": 1, "track": 34, "sessionType": 1,
    #    "events": 1, "timeOnTrack": 440.16, "lapsDriven": 1, "cleanLapsDriven": 1}
    garage61 = await get_optional_garage61_client(user, db)
    if garage61:
        # Build car/track name lookup from local dictionary
        car_lookup: dict[str, str] = {}
        track_lookup: dict[str, str] = {}
        for entry in await list_garage61_cars(db):
            if entry.platform_id:
                car_lookup[entry.platform_id] = entry.name
        for entry in await list_garage61_tracks(db):
            if entry.platform_id:
                track_lookup[entry.platform_id] = entry.display_name

        try:
            stats = await garage61.get_me_statistics()
            driving_stats = stats.get("drivingStatistics") or []

            if isinstance(driving_stats, list):
                # Sort by day descending so we get the most recent first
                driving_stats.sort(key=lambda e: e.get("day") or "" if isinstance(e, dict) else "", reverse=True)

                for entry in driving_stats:
                    if not isinstance(entry, dict):
                        continue
                    car_id = entry.get("car")
                    track_id = entry.get("track")
                    if car_id is None or track_id is None:
                        continue
                    day = entry.get("day") or ""
                    dedup = f"g61:{car_id}:{track_id}:{day}"
                    if dedup in seen_keys:
                        continue
                    seen_keys.add(dedup)

                    car_name = car_lookup.get(str(car_id), f"Car {car_id}")
                    track_name = track_lookup.get(str(track_id), f"Track {track_id}")
                    laps_driven = int(entry.get("lapsDriven") or 0)

                    items.append({
                        "id": make_lap_id(SOURCE_GARAGE61, f"stats-{car_id}-{track_id}-{day}"),
                        "lap_time": 0,
                        "car_name": car_name,
                        "track_name": track_name,
                        "car_id": make_car_key(SOURCE_GARAGE61, car_id),
                        "track_id": make_track_key(SOURCE_GARAGE61, track_id),
                        "recorded_at": day,
                        "lap_count": laps_driven,
                        "source": SOURCE_GARAGE61,
                    })
        except Exception:
            logger.exception("Failed to fetch Garage61 statistics for recent activity")

    # --- Uploaded telemetry: one entry per file ---
    result = await db.execute(
        select(UploadedTelemetry)
        .options(selectinload(UploadedTelemetry.car), selectinload(UploadedTelemetry.track))
        .where(UploadedTelemetry.user_id == user.id)
        .order_by(UploadedTelemetry.created_at.desc())
    )
    for row in result.scalars().all():
        car_name = row.car.name if row.car else row.car_name
        track_name = row.track.display_name if row.track else row.track_name
        dedup = f"up:{row.id}"
        if dedup in seen_keys:
            continue
        seen_keys.add(dedup)
        items.append({
            "id": make_lap_id(SOURCE_UPLOAD, str(row.id)),
            "lap_time": row.lap_time_ms,
            "car_name": car_name,
            "track_name": track_name,
            "car_id": make_car_key(SOURCE_UPLOAD, row.car_id or car_name),
            "track_id": make_track_key(SOURCE_UPLOAD, row.track_id or track_name),
            "recorded_at": row.recorded_at or row.created_at.isoformat(),
            "driver_name": row.driver_name,
            "file_name": row.file_name,
            "source": SOURCE_UPLOAD,
        })

    items.sort(key=lambda x: str(x.get("recorded_at") or ""), reverse=True)
    return items[:limit]


async def load_csv_for_lap_id(
    lap_id: str,
    *,
    user: User,
    db: AsyncSession,
    uploaded_telemetry: list[dict[str, Any]] | None = None,
) -> str:
    source, raw_id = parse_lap_id(lap_id)
    upload_map = {item["id"]: item for item in (uploaded_telemetry or [])}
    if lap_id in upload_map:
        return str(upload_map[lap_id]["csv_data"])
    if source == SOURCE_UPLOAD:
        try:
            upload_uuid = uuid.UUID(raw_id)
        except ValueError as exc:
            raise ValueError(f"Invalid uploaded lap id: {lap_id}") from exc
        result = await db.execute(
            select(UploadedTelemetry).where(
                UploadedTelemetry.id == upload_uuid,
                UploadedTelemetry.user_id == user.id,
            )
        )
        item = result.scalar_one_or_none()
        if item is None:
            raise ValueError(f"Uploaded telemetry not found: {lap_id}")
        return decompress_csv(item.csv_blob, item.compression)

    garage61 = await get_optional_garage61_client(user, db)
    if not garage61:
        raise ValueError(f"Garage61 not connected — cannot fetch lap {lap_id}. Upload CSV telemetry instead.")
    return await garage61.get_lap_csv(raw_id)
