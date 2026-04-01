from urllib.parse import urlencode
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

DISCORD_AUTH_URL = "https://discord.com/api/oauth2/authorize"
DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token"
DISCORD_API_BASE = "https://discord.com/api/v10"


def get_discord_authorization_url(state: str) -> str:
    params = {
        "client_id": settings.DISCORD_CLIENT_ID,
        "redirect_uri": settings.DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope": "identify",
        "state": state,
    }
    return f"{DISCORD_AUTH_URL}?{urlencode(params)}"


async def exchange_discord_code(code: str) -> dict:
    async with httpx.AsyncClient() as client:
        payload = {
            "client_id": settings.DISCORD_CLIENT_ID,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.DISCORD_REDIRECT_URI,
        }
        if settings.DISCORD_CLIENT_SECRET:
            payload["client_secret"] = settings.DISCORD_CLIENT_SECRET
        response = await client.post(
            DISCORD_TOKEN_URL,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()


async def get_discord_user_info(access_token: str) -> dict:
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{DISCORD_API_BASE}/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()


def get_discord_avatar_url(user_id: str, avatar_hash: str | None) -> str | None:
    if not avatar_hash:
        return None
    return f"https://cdn.discordapp.com/avatars/{user_id}/{avatar_hash}.png?size=256"
