"""
Garage61 lap, car and track browsing endpoints.
"""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query

from app.auth.jwt import get_current_user
from app.garage61.client import Garage61Client, get_garage61_client
from app.models.user import User

router = APIRouter(prefix="/api/laps", tags=["laps"])

def _first_value(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None

def _format_track_name(track: dict) -> str:
    name = track.get("name") or "Unknown track"
    variant = track.get("variant") or track.get("config")
    if variant and variant.strip() and variant != name:
        return f"{name} - {variant}"
    return name

def _coerce_int(value: Any) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return value
    return value

def _coerce_float(value: Any) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return value
    return value

def _normalize_lap(item: dict, fallback_id: str) -> dict:
    car = item.get("car") or {}
    track = item.get("track") or item.get("circuit") or {}
    driver = item.get("driver") or item.get("user") or {}
    driver_name = driver.get("firstName", "") + " " + driver.get("lastName", "")

    car_name = item.get("car_name") or item.get("carName") or car.get("name") or "Unknown car"
    track_name = item.get("track_name") or item.get("trackName") or track.get("name") or "Unknown track"
    if track and track_name == (track.get("name") or ""):
        track_name = _format_track_name(track)

    car_id = _coerce_int(_first_value(
        item.get("car_id"),
        item.get("carId"),
        car.get("id"),
        car.get("car_id"),
        car.get("carId"),
    ))
    track_id = _coerce_int(_first_value(
        item.get("track_id"),
        item.get("trackId"),
        track.get("id"),
        track.get("track_id"),
        track.get("trackId"),
    ))
    lap_time = _coerce_float(_first_value(
        item.get("lap_time"),
        item.get("lapTime"),
        item.get("lap_time_ms"),
        item.get("lapTimeMs"),
        0,
    ))
    if not isinstance(lap_time, (int, float)):
        lap_time = 0
    recorded_at = _first_value(
        item.get("startTime"),
        item.get("timestamp"),
        "",
    )
    lap_id = _first_value(item.get("id"), item.get("lapId"), item.get("lap_id"), fallback_id)

    irating = _coerce_int(_first_value(
        item.get("driverRating"),
    ))

    season = _first_value(
        item.get("season"),
        item.get("seasonName"),
        item.get("season_name"),
    )

    result: dict = {
        "id": str(lap_id),
        "lap_time": lap_time or 0,
        "car_name": car_name,
        "track_name": track_name,
        "car_id": car_id,
        "track_id": track_id,
        "driver_name": driver_name,
        "recorded_at": recorded_at,
    }
    if irating is not None:
        result["irating"] = irating
    if season is not None:
        result["season"] = str(season.get("shortName") if isinstance(season, dict) else season)
    return result


def _normalize_session(item: dict, fallback_id: str, laps: list[dict] | None = None) -> dict:
    car = item.get("car") or {}
    track = item.get("track") or item.get("circuit") or {}
    car_name = item.get("car_name") or item.get("carName") or car.get("name") or "Unknown car"
    track_name = item.get("track_name") or item.get("trackName") or track.get("name") or "Unknown track"
    if track and track_name == (track.get("name") or ""):
        track_name = _format_track_name(track)

    car_id = _coerce_int(_first_value(item.get("car_id"), item.get("carId"), car.get("id")))
    track_id = _coerce_int(_first_value(item.get("track_id"), item.get("trackId"), track.get("id")))
    session_id = str(_first_value(item.get("id"), item.get("sessionId"), item.get("session_id"), fallback_id))
    date = _first_value(item.get("startTime"), item.get("date"), item.get("timestamp"), "")

    if laps is not None:
        normalized_laps = laps
    else:
        normalized_laps = [
            _normalize_lap(l, f"{session_id}-lap-{i}")
            for i, l in enumerate(item.get("laps") or [])
            if isinstance(l, dict)
        ]

    lap_times = [l["lap_time"] for l in normalized_laps if l.get("lap_time")]
    best_lap_time = min(lap_times) if lap_times else 0
    return {
        "id": session_id,
        "date": date,
        "car_name": car_name,
        "track_name": track_name,
        "car_id": car_id,
        "track_id": track_id,
        "lap_count": len(normalized_laps),
        "best_lap_time": best_lap_time,
        "laps": normalized_laps,
    }


@router.get("/cars")
async def list_cars(
    client: Garage61Client = Depends(get_garage61_client),
    _current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Return the list of cars available in Garage61."""
    return await client.get_cars()


@router.get("/tracks")
async def list_tracks(
    client: Garage61Client = Depends(get_garage61_client),
    _current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Return the list of tracks available in Garage61."""
    return await client.get_tracks()


@router.get("/my-laps")
async def list_my_laps(
    car_id: int | None = Query(default=None, description="Filter by car ID"),
    track_id: int | None = Query(default=None, description="Filter by track ID"),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    client: Garage61Client = Depends(get_garage61_client),
    _current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Return the current user's laps, optionally filtered by car and/or track."""
    if car_id is None or track_id is None:
        return []
    laps = await client.get_my_laps(
        car_id=car_id,
        track_id=track_id,
        limit=limit,
        offset=offset,
    )
    return [
        _normalize_lap(item, f"my-{idx}")
        for idx, item in enumerate(laps)
        if isinstance(item, dict)
    ]

@router.get("/recent")
async def list_recent_laps(
    limit: int = Query(default=25, ge=1, le=50),
    client: Garage61Client = Depends(get_garage61_client),
    _current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Return recent laps for the current user, unique car+track combinations."""
    stats = await client.get_me_statistics()

    driving_stats = stats.get("drivingStatistics")
    if isinstance(driving_stats, list) and driving_stats:
        cars = await client.get_cars()
        tracks = await client.get_tracks()
        car_map = {c.get("id"): c.get("name") for c in cars if isinstance(c, dict)}
        track_map = {t.get("id"): _format_track_name(t) for t in tracks if isinstance(t, dict)}
        items = sorted(
            [d for d in driving_stats if isinstance(d, dict)],
            key=lambda d: d.get("day") or "",
            reverse=True,
        )
        normalized = []
        seen: set = set()
        for item in items:
            car_id = item.get("car")
            track_id = item.get("track")
            # Deduplicate by car+track combo only (keep most recent occurrence)
            key = (car_id, track_id)
            if key in seen:
                continue
            seen.add(key)
            normalized.append(
                {
                    "id": f"activity-{len(normalized)}",
                    "lap_time": 0,
                    "car_name": car_map.get(car_id, f"Car #{car_id}"),
                    "track_name": track_map.get(track_id, f"Track #{track_id}"),
                    "car_id": car_id,
                    "track_id": track_id,
                    "driver_name": "",
                    "recorded_at": item.get("day") or "",
                }
            )
            if len(normalized) >= limit:
                break
        if normalized:
            return normalized

    candidates: list[Any] = []
    for key in (
        "recentLaps",
        "recent_laps",
        "recentActivity",
        "recent_activity",
        "laps",
        "data",
        "results",
        "lastLap",
        "last_lap",
        "latestLap",
        "latest_lap",
        "mostRecentLap",
        "most_recent_lap",
    ):
        if key in stats and stats[key]:
            candidates.append(stats[key])

    items: list[dict] = []
    for candidate in candidates:
        if isinstance(candidate, list):
            items.extend([c for c in candidate if isinstance(c, dict)])
        elif isinstance(candidate, dict):
            items.append(candidate)

    normalized: list[dict] = []
    for idx, item in enumerate(items[:limit]):
        if not isinstance(item, dict):
            continue
        normalized.append(_normalize_lap(item, f"recent-{idx}"))

    if normalized:
        return normalized

    try:
        return await client.get_recent_laps(limit=limit)
    except Exception:
        return []




@router.get("/my-sessions")
async def list_my_sessions(
    car_id: int | None = Query(default=None, description="Filter by car ID"),
    track_id: int | None = Query(default=None, description="Filter by track ID"),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    client: Garage61Client = Depends(get_garage61_client),
    _current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Return the current user's sessions with embedded laps."""
    if car_id is None or track_id is None:
        return []

    # Try dedicated sessions endpoint first
    sessions = await client.get_my_sessions(car_id=car_id, track_id=track_id, limit=limit, offset=offset)
    if sessions:
        return [
            _normalize_session(item, f"session-{idx}")
            for idx, item in enumerate(sessions)
            if isinstance(item, dict)
        ]

    # Fallback: fetch laps and group by session ID or calendar day
    laps = await client.get_my_laps(car_id=car_id, track_id=track_id, limit=200, offset=0)

    session_map: dict[str, list[dict]] = {}
    session_order: list[str] = []

    for idx, lap in enumerate(laps):
        if not isinstance(lap, dict):
            continue

        session_obj = lap.get("session") or {}
        session_id: str | None = None
        if isinstance(session_obj, str):
            session_id = session_obj
        else:
            session_id = str(raw) if (raw := _first_value(
                lap.get("sessionId"),
                lap.get("session_id"),
                lap.get("subsessionId"),
                lap.get("subsession_id"),
                lap.get("raceId"),
                lap.get("race_id"),
                session_obj.get("id") if isinstance(session_obj, dict) else None,
            )) is not None else None

        if session_id is None:
            start_time = lap.get("startTime") or lap.get("timestamp") or ""
            try:
                if isinstance(start_time, (int, float)):
                    ts = float(start_time)
                    dt = datetime.fromtimestamp(ts / 1000 if ts > 1e10 else ts, tz=timezone.utc)
                    session_id = dt.strftime("%Y-%m-%d")
                elif start_time:
                    s = str(start_time).strip()
                    if s.lstrip("-").isdigit():
                        # Numeric string — Unix seconds or milliseconds
                        ts = float(s)
                        dt = datetime.fromtimestamp(ts / 1000 if ts > 1e10 else ts, tz=timezone.utc)
                        session_id = dt.strftime("%Y-%m-%d")
                    else:
                        # ISO-ish string — first 10 chars are YYYY-MM-DD
                        session_id = s[:10]
                else:
                    session_id = f"unknown-{idx}"
            except Exception:
                session_id = str(start_time)[:10] if start_time else f"unknown-{idx}"

        if session_id not in session_map:
            session_map[session_id] = []
            session_order.append(session_id)
        session_map[session_id].append(lap)

    result: list[dict] = []
    for sid in session_order:
        sess_laps = session_map[sid]
        if not sess_laps:
            continue
        first_lap = sess_laps[0]
        normalized_laps = [_normalize_lap(l, f"{sid}-lap-{i}") for i, l in enumerate(sess_laps)]
        lap_times = [l["lap_time"] for l in normalized_laps if l.get("lap_time")]
        best_lap_time = min(lap_times) if lap_times else 0

        car = first_lap.get("car") or {}
        track = first_lap.get("track") or first_lap.get("circuit") or {}
        car_name = first_lap.get("car_name") or first_lap.get("carName") or car.get("name") or "Unknown car"
        track_name = first_lap.get("track_name") or first_lap.get("trackName") or track.get("name") or "Unknown track"
        if track:
            track_name = _format_track_name(track)

        car_id_val = _coerce_int(_first_value(first_lap.get("car_id"), first_lap.get("carId"), car.get("id")))
        track_id_val = _coerce_int(_first_value(first_lap.get("track_id"), first_lap.get("trackId"), track.get("id")))
        date = first_lap.get("startTime") or first_lap.get("timestamp") or sid

        result.append({
            "id": sid,
            "date": date,
            "car_name": car_name,
            "track_name": track_name,
            "car_id": car_id_val,
            "track_id": track_id_val,
            "lap_count": len(normalized_laps),
            "best_lap_time": best_lap_time,
            "laps": normalized_laps,
        })

    return result[offset: offset + limit]


@router.get("/reference-laps")
async def list_reference_laps(
    car_id: int = Query(..., description="Car ID to filter reference laps"),
    track_id: int = Query(..., description="Track ID to filter reference laps"),
    limit: int = Query(default=5, ge=1, le=20),
    client: Garage61Client = Depends(get_garage61_client),
    _current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Return top reference laps (fastest, excluding current user) for a car+track combo."""
    laps = await client.get_reference_laps(car_id=car_id, track_id=track_id, limit=limit)
    return [
        _normalize_lap(item, f"ref-{idx}")
        for idx, item in enumerate(laps)
        if isinstance(item, dict)
    ]

