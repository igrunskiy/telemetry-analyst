from urllib.parse import urlencode

import httpx

from app.config import settings


def get_authorization_url(state: str) -> str:
    """Build the Garage61 OAuth2 authorization URL."""
    params = {
        "client_id": settings.GARAGE61_CLIENT_ID,
        "redirect_uri": settings.GARAGE61_REDIRECT_URI,
        "response_type": "code",
        "scope": "driving_data",
        "state": state,
    }
    return f"{settings.GARAGE61_AUTH_URL}?{urlencode(params)}"


async def exchange_code(code: str) -> dict:
    """Exchange authorization code for access + refresh tokens."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            settings.GARAGE61_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": settings.GARAGE61_CLIENT_ID,
                "client_secret": settings.GARAGE61_CLIENT_SECRET,
                "redirect_uri": settings.GARAGE61_REDIRECT_URI,
            },
            headers={"Accept": "application/json"},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()


async def refresh_access_token(refresh_token: str) -> dict:
    """Use a refresh token to obtain a new access token."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            settings.GARAGE61_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": settings.GARAGE61_CLIENT_ID,
                "client_secret": settings.GARAGE61_CLIENT_SECRET,
            },
            headers={"Accept": "application/json"},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()


async def get_user_info(access_token: str) -> dict:
    """Fetch the authenticated user's profile from Garage61 /me."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{settings.GARAGE61_API_BASE}/me",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            },
            timeout=30,
        )
        response.raise_for_status()
        return response.json()
