"""Unified lap, car, and track browsing endpoints across telemetry sources."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import get_current_user
from app.database import get_db
from app.models.user import User
from app.telemetry.catalog import (
    list_combined_cars,
    list_combined_my_laps,
    list_combined_my_sessions,
    list_combined_recent_laps,
    list_combined_reference_laps,
    list_combined_tracks,
)

router = APIRouter(prefix="/api/laps", tags=["laps"])


@router.get("/cars")
async def list_cars(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Return the list of available cars across Garage61 and imported telemetry."""
    return await list_combined_cars(current_user, db)


@router.get("/tracks")
async def list_tracks(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Return the list of available tracks across Garage61 and imported telemetry."""
    return await list_combined_tracks(current_user, db)


@router.get("/my-laps")
async def list_my_laps(
    car_id: str | None = Query(default=None, description="Filter by car key"),
    track_id: str | None = Query(default=None, description="Filter by track key"),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Return the current user's laps across all telemetry sources."""
    return await list_combined_my_laps(
        current_user,
        db,
        car_key=car_id,
        track_key=track_id,
        limit=limit,
        offset=offset,
    )

@router.get("/recent")
async def list_recent_laps(
    limit: int = Query(default=25, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Return recent laps for the current user across telemetry sources."""
    return await list_combined_recent_laps(current_user, db, limit)




@router.get("/my-sessions")
async def list_my_sessions(
    car_id: str | None = Query(default=None, description="Filter by car key"),
    track_id: str | None = Query(default=None, description="Filter by track key"),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Return sessions across Garage61 and imported telemetry."""
    return await list_combined_my_sessions(current_user, db, car_id, track_id, limit, offset)


@router.get("/reference-laps")
async def list_reference_laps(
    car_id: str = Query(..., description="Car key to filter reference laps"),
    track_id: str = Query(..., description="Track key to filter reference laps"),
    limit: int = Query(default=5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Return top laps for a car+track combo across telemetry sources."""
    return await list_combined_reference_laps(current_user, db, car_id, track_id, limit)
