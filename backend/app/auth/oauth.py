from urllib.parse import urlencode
import base64
import hashlib
import logging
import secrets

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def _is_public_local_client() -> bool:
    redirect_uri = (settings.GARAGE61_REDIRECT_URI or "").strip().lower()
    return redirect_uri.startswith("http://localhost") or redirect_uri.startswith("http://127.0.0.1")


def get_authorization_url(state: str) -> tuple[str, str]:
    """Build the Garage61 OAuth2 authorization URL."""
    code_verifier = secrets.token_urlsafe(64)
    code_challenge = _code_challenge(code_verifier)
    params = {
        "client_id": settings.GARAGE61_CLIENT_ID,
        "redirect_uri": settings.GARAGE61_REDIRECT_URI,
        "response_type": "code",
        "scope": "driving_data",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    auth_url = f"{settings.GARAGE61_AUTH_URL}?{urlencode(params)}"
    logger.info(f"Authorization URL: {auth_url}")
    return auth_url, code_verifier


def _code_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


async def exchange_code(code: str, code_verifier: str | None) -> dict:
    """Exchange authorization code for access + refresh tokens."""
    logger.info(f"Exchanging code: {code[:6]}... (redacted)")
    logger.info(f"Token endpoint: {settings.GARAGE61_TOKEN_URL}")
    logger.info(f"Client ID: {settings.GARAGE61_CLIENT_ID}")
    logger.info(f"Client Secret present: {bool(settings.GARAGE61_CLIENT_SECRET)}")
    logger.info(f"Redirect URI: {settings.GARAGE61_REDIRECT_URI}")

    async with httpx.AsyncClient() as client:
        payload = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.GARAGE61_REDIRECT_URI,
            "client_id": settings.GARAGE61_CLIENT_ID,
        }
        if code_verifier:
            payload["code_verifier"] = code_verifier
        if settings.GARAGE61_CLIENT_SECRET:
            payload["client_secret"] = settings.GARAGE61_CLIENT_SECRET
            logger.info("Confidential client: sending client_secret")
        elif _is_public_local_client():
            payload["client_secret"] = ""
            logger.info("Public localhost client: sending empty client_secret")
        else:
            raise RuntimeError(
                "GARAGE61_CLIENT_SECRET is required for non-localhost Garage61 OAuth token exchange"
            )
        logger.info(f"Request payload keys: {list(payload.keys())}")

        try:
            headers = {"Accept": "application/json"}
            response = await client.post(
                settings.GARAGE61_TOKEN_URL,
                data=payload,
                headers=headers,
                timeout=30,
            )
            logger.info(f"Response status: {response.status_code}")
            logger.info(f"Response body: {response.text}")
            
            response.raise_for_status()
            result = response.json()
            logger.info(f"Token exchange successful, keys: {list(result.keys())}")
            return result
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error: {e}")
            logger.error(f"Response text: {e.response.text}")
            raise


async def refresh_access_token(refresh_token: str) -> dict:
    """Use a refresh token to obtain a new access token."""
    logger.info(f"Refreshing token with refresh_token: {refresh_token[:20]}...")

    async with httpx.AsyncClient() as client:
        payload = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": settings.GARAGE61_CLIENT_ID,
        }
        if settings.GARAGE61_CLIENT_SECRET:
            payload["client_secret"] = settings.GARAGE61_CLIENT_SECRET
            logger.info("Confidential client: sending client_secret for refresh")
        elif _is_public_local_client():
            payload["client_secret"] = ""
            logger.info("Public localhost client: sending empty client_secret for refresh")
        else:
            raise RuntimeError(
                "GARAGE61_CLIENT_SECRET is required for non-localhost Garage61 OAuth token refresh"
            )
        logger.info(f"Refresh request payload keys: {list(payload.keys())}")

        try:
            headers = {"Accept": "application/json"}
            response = await client.post(
                settings.GARAGE61_TOKEN_URL,
                data=payload,
                headers=headers,
                timeout=30,
            )
            logger.info(f"Refresh response status: {response.status_code}")
            logger.info(f"Refresh response body: {response.text}")
            response.raise_for_status()
            result = response.json()
            logger.info(f"Token refresh successful")
            return result
        except httpx.HTTPStatusError as e:
            logger.error(f"Refresh error: {e}")
            logger.error(f"Response text: {e.response.text}")
            raise


async def get_user_info(access_token: str) -> dict:
    """Fetch the authenticated user's profile from Garage61 OAuth userinfo."""
    logger.info(f"Fetching user info with token: {access_token[:20]}...")
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                settings.GARAGE61_USERINFO_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json",
                },
                timeout=30,
            )
            logger.info(f"User info response status: {response.status_code}")
            logger.info(f"User info response body: {response.text}")
            response.raise_for_status()
            result = response.json()
            logger.info(f"User info fetched successfully")
            return result
        except httpx.HTTPStatusError as e:
            logger.error(f"User info error: {e}")
            logger.error(f"Response text: {e.response.text}")
            raise
