from datetime import datetime, timezone
from typing import Any
import logging

import httpx
from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.crypto import decrypt, encrypt
from app.auth.jwt import get_current_user
from app.auth.oauth import refresh_access_token
from app.config import settings
from app.database import get_db
from app.models.user import User


logger = logging.getLogger(__name__)


class Garage61Client:
    """
    Async HTTP client for the Garage61 API.

    Automatically retries once after refreshing tokens on 401 responses.
    """

    def __init__(
        self,
        access_token: str,
        refresh_token: str | None,
        user_id: str,
        db: AsyncSession,
    ) -> None:
        self._access_token = access_token
        self._refresh_token = refresh_token
        self._user_id = user_id
        self._db = db

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _make_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=settings.GARAGE61_API_BASE,
            headers={
                "Authorization": f"Bearer {self._access_token}",
                "Accept": "application/json",
            },
            timeout=60,
        )

    async def _refresh_and_update(self) -> None:
        """Refresh the access token and persist the new tokens to the DB."""
        if not self._refresh_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Garage61 session expired and no refresh token available",
            )

        token_data = await refresh_access_token(self._refresh_token)
        new_access = token_data.get("access_token")
        new_refresh = token_data.get("refresh_token", self._refresh_token)

        if not new_access:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Failed to refresh Garage61 access token",
            )

        self._access_token = new_access
        self._refresh_token = new_refresh

        # Update encrypted tokens in the DB
        from sqlalchemy import select
        from app.models.user import User as UserModel

        result = await self._db.execute(
            select(UserModel).where(UserModel.id == self._user_id)
        )
        user = result.scalar_one_or_none()
        if user:
            user.access_token_enc = encrypt(new_access)
            user.refresh_token_enc = encrypt(new_refresh) if new_refresh else None
            await self._db.flush()

    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        """
        Make an authenticated API request with automatic token refresh on 401.
        Returns parsed JSON.
        """
        async with self._make_client() as client:
            response = await client.request(method, path, **kwargs)

            if response.status_code == 401 and self._refresh_token:
                # Refresh and retry once
                await self._refresh_and_update()
                # Update the Authorization header for the retry
                async with self._make_client() as retry_client:
                    response = await retry_client.request(method, path, **kwargs)

            if response.status_code == 401:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Garage61 authentication failed",
                )

            response.raise_for_status()
            return response.json()

    async def _get_raw(self, path: str, **kwargs: Any) -> httpx.Response:
        """
        Make a GET request and return the raw httpx.Response (for CSV text etc.).
        Handles token refresh on 401.
        """
        async with self._make_client() as client:
            response = await client.get(path, **kwargs)

            if response.status_code == 401 and self._refresh_token:
                await self._refresh_and_update()
                async with self._make_client() as retry_client:
                    response = await retry_client.get(path, **kwargs)

            if response.status_code == 401:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Garage61 authentication failed",
                )

            response.raise_for_status()
            return response

    # ------------------------------------------------------------------
    # Public API methods
    # ------------------------------------------------------------------

    async def get_me(self) -> dict:
        """GET /me — return current user info."""
        return await self._request("GET", "/me")

    async def get_cars(self) -> list[dict]:
        """GET /cars — return list of cars."""
        data = await self._request("GET", "/cars")
        if isinstance(data, list):
            logger.info(f"Garage61 /cars list count: {len(data)}")
            return data
        if isinstance(data, dict):
            for key in ("cars", "data", "results", "items"):
                if key in data and isinstance(data[key], list):
                    logger.info(f"Garage61 /cars {key} count: {len(data[key])}")
                    return data[key]
            logger.info(f"Garage61 /cars dict keys: {list(data.keys())}")
        else:
            logger.info(f"Garage61 /cars unexpected type: {type(data)}")
        return []

    async def get_tracks(self) -> list[dict]:
        """GET /tracks — return list of tracks."""
        data = await self._request("GET", "/tracks")
        if isinstance(data, list):
            logger.info(f"Garage61 /tracks list count: {len(data)}")
            return data
        if isinstance(data, dict):
            for key in ("tracks", "data", "results", "items"):
                if key in data and isinstance(data[key], list):
                    logger.info(f"Garage61 /tracks {key} count: {len(data[key])}")
                    return data[key]
            logger.info(f"Garage61 /tracks dict keys: {list(data.keys())}")
        else:
            logger.info(f"Garage61 /tracks unexpected type: {type(data)}")
        return []

    async def get_my_laps(
        self,
        car_id: int | None = None,
        track_id: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """GET /laps filtered to the current user's laps, ungrouped (one row per lap)."""
        params: dict[str, Any] = {
            "limit": limit,
            "offset": offset,
            "drivers": "me",
            "clean": 1,
            "group": "none",
        }
        if car_id is not None:
            params["cars"] = car_id
        if track_id is not None:
            params["tracks"] = track_id

        try:
            data = await self._request("GET", "/laps", params=params)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 400:
                raise
            # API rejected group=none — retry without it
            params.pop("group")
            data = await self._request("GET", "/laps", params=params)

        if isinstance(data, list):
            return data
        return data.get("items") or data.get("laps") or data.get("data") or data.get("results") or []

    async def get_reference_laps(
        self,
        car_id: int,
        track_id: int,
        limit: int = 10,
    ) -> list[dict]:
        """GET /laps sorted by fastest time, excluding the current user."""
        params: dict[str, Any] = {
            "cars": car_id,
            "tracks": track_id,
            "limit": limit,
            "clean": 1,
        }
        data = await self._request("GET", "/laps", params=params)
        if isinstance(data, list):
            return data
        return data.get("items") or data.get("data") or data.get("results") or []

    async def get_my_sessions(
        self,
        car_id: int | None = None,
        track_id: int | None = None,
        limit: int = 20,
        offset: int = 0,
    ) -> list[dict]:
        """GET /sessions filtered to the current user's sessions."""
        params: dict[str, Any] = {
            "limit": limit,
            "offset": offset,
            "drivers": "me",
        }
        if car_id is not None:
            params["cars"] = car_id
        if track_id is not None:
            params["tracks"] = track_id

        try:
            data = await self._request("GET", "/sessions", params=params)
            if isinstance(data, list):
                return data
            return data.get("items") or data.get("sessions") or data.get("data") or data.get("results") or []
        except Exception:
            logger.info("Garage61 /sessions endpoint not available, will fall back to laps grouping")
            return []

    async def get_me_statistics(self) -> dict:
        """GET /me/statistics — return aggregate stats for the current user."""
        data = await self._request("GET", "/me/statistics")
        if isinstance(data, dict):
            logger.info(f"Garage61 /me/statistics keys: {list(data.keys())}")
            driving_stats = data.get("drivingStatistics")
            if isinstance(driving_stats, dict):
                logger.info(
                    "Garage61 /me/statistics drivingStatistics keys: "
                    f"{list(driving_stats.keys())}"
                )
            return data
        logger.info(f"Garage61 /me/statistics unexpected type: {type(data)}")
        return {}

    async def get_lap(self, lap_id: str) -> dict:
        """GET /laps/{lap_id} — return lap metadata (best-effort, returns {} on failure)."""
        try:
            data = await self._request("GET", f"/laps/{lap_id}")
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    async def get_lap_csv(self, lap_id: str) -> str:
        """GET /laps/{lap_id}/csv — return raw CSV text."""
        response = await self._get_raw(
            f"/laps/{lap_id}/csv",
            headers={"Accept": "text/csv, text/plain;q=0.9, */*;q=0.8"},
        )
        text = response.text or ""
        stripped = text.lstrip("\ufeff").strip()
        content_type = response.headers.get("content-type", "")

        if not stripped:
            raise ValueError(f"Garage61 returned an empty CSV body for lap {lap_id}")

        lower = stripped.lower()
        if lower.startswith("<!doctype html") or lower.startswith("<html"):
            raise ValueError(
                "Garage61 returned HTML instead of CSV "
                f"for lap {lap_id} (content-type={content_type or 'unknown'})"
            )

        return text


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------


async def get_garage61_client(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Garage61Client:
    """Dependency that decrypts the user's Garage61 tokens and returns a client."""
    if not current_user.access_token_enc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Garage61 not connected",
        )
    access_token = decrypt(current_user.access_token_enc)
    refresh_token = (
        decrypt(current_user.refresh_token_enc)
        if current_user.refresh_token_enc
        else None
    )
    return Garage61Client(
        access_token=access_token,
        refresh_token=refresh_token,
        user_id=str(current_user.garage61_user_id),
        db=db,
    )
