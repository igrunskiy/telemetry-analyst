"""
Garage61 lap, car and track browsing endpoints.
"""

from typing import Any

from fastapi import APIRouter, Depends, Query

from app.auth.jwt import get_current_user
from app.garage61.client import Garage61Client, get_garage61_client
from app.models.user import User

router = APIRouter(prefix="/api/laps", tags=["laps"])


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
    limit: int = Query(default=20, ge=1, le=100),
    client: Garage61Client = Depends(get_garage61_client),
    _current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Return the current user's laps, optionally filtered by car and/or track."""
    return await client.get_my_laps(car_id=car_id, track_id=track_id, limit=limit)


@router.get("/reference-laps")
async def list_reference_laps(
    car_id: int = Query(..., description="Car ID to filter reference laps"),
    track_id: int = Query(..., description="Track ID to filter reference laps"),
    limit: int = Query(default=5, ge=1, le=20),
    client: Garage61Client = Depends(get_garage61_client),
    _current_user: User = Depends(get_current_user),
) -> list[dict]:
    """Return top reference laps (fastest, excluding current user) for a car+track combo."""
    return await client.get_reference_laps(car_id=car_id, track_id=track_id, limit=limit)
