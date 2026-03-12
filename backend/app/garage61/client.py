from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.crypto import decrypt, encrypt
from app.auth.jwt import get_current_user
from app.auth.oauth import refresh_access_token
from app.config import settings
from app.database import get_db
from app.models.user import User


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
        # Handle both direct list and wrapped response
        if isinstance(data, list):
            return data
        return data.get("cars") or data.get("data") or data.get("results") or []

    async def get_tracks(self) -> list[dict]:
        """GET /tracks — return list of tracks."""
        data = await self._request("GET", "/tracks")
        if isinstance(data, list):
            return data
        return data.get("tracks") or data.get("data") or data.get("results") or []

    async def get_my_laps(
        self,
        car_id: int | None = None,
        track_id: int | None = None,
        limit: int = 20,
    ) -> list[dict]:
        """GET /laps filtered to the current user's laps."""
        params: dict[str, Any] = {"limit": limit, "driver": self._user_id}
        if car_id is not None:
            params["car_id"] = car_id
        if track_id is not None:
            params["track_id"] = track_id

        data = await self._request("GET", "/laps", params=params)
        if isinstance(data, list):
            return data
        return data.get("laps") or data.get("data") or data.get("results") or []

    async def get_reference_laps(
        self,
        car_id: int,
        track_id: int,
        limit: int = 5,
    ) -> list[dict]:
        """GET /laps sorted by fastest time, excluding the current user."""
        params: dict[str, Any] = {
            "car_id": car_id,
            "track_id": track_id,
            "limit": limit,
            "sort": "laptime",
            "order": "asc",
            "exclude_driver": self._user_id,
        }
        data = await self._request("GET", "/laps", params=params)
        if isinstance(data, list):
            return data
        return data.get("laps") or data.get("data") or data.get("results") or []

    async def get_lap_csv(self, lap_id: str) -> str:
        """GET /laps/{lap_id}/csv — return raw CSV text."""
        response = await self._get_raw(f"/laps/{lap_id}/csv")
        return response.text


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------


async def get_garage61_client(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Garage61Client:
    """Dependency that decrypts the user's Garage61 tokens and returns a client."""
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
