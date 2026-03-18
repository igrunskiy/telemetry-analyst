from urllib.parse import urlencode
import base64
import hashlib
import logging
import secrets

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


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
        }
        if code_verifier:
            payload["code_verifier"] = code_verifier
        logger.info(f"Request payload keys: {list(payload.keys())}")
        
        auth = None
        if settings.GARAGE61_CLIENT_SECRET:
            auth = (settings.GARAGE61_CLIENT_ID, settings.GARAGE61_CLIENT_SECRET)
            logger.info("Using HTTP Basic Auth (with secret)")
            payload["client_id"] = settings.GARAGE61_CLIENT_ID
            payload["client_secret"] = settings.GARAGE61_CLIENT_SECRET
        else:
            payload["client_id"] = settings.GARAGE61_CLIENT_ID
            payload["client_secret"] = ""
            logger.info("Public client: no Authorization header")
        
        try:
            headers = {"Accept": "application/json"}
            
            logger.info(f"Request headers keys: {list(headers.keys())}")
            logger.info(f"Request payload keys: {list(payload.keys())}")
            
            response = await client.post(
                settings.GARAGE61_TOKEN_URL,
                data=payload,
                headers=headers,
                auth=auth,
                timeout=30,
            )
            if (
                response.status_code == 401
                and not settings.GARAGE61_CLIENT_SECRET
                and "invalid_client" in response.text
            ):
                logger.info("Retrying token exchange with empty Basic Auth")
                response = await client.post(
                    settings.GARAGE61_TOKEN_URL,
                    data=payload,
                    headers=headers,
                    auth=(settings.GARAGE61_CLIENT_ID, ""),
                    timeout=30,
                )
            logger.info(f"Response status: {response.status_code}")
            logger.info(f"Response headers: {dict(response.headers)}")
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
        }
        logger.info(f"Refresh request payload keys: {list(payload.keys())}")
        logger.info(f"Using HTTP Basic auth: {bool(settings.GARAGE61_CLIENT_SECRET)}")
        
        try:
            headers = {"Accept": "application/json"}
            auth = None
            if settings.GARAGE61_CLIENT_SECRET:
                auth = (settings.GARAGE61_CLIENT_ID, settings.GARAGE61_CLIENT_SECRET)
                payload["client_id"] = settings.GARAGE61_CLIENT_ID
                payload["client_secret"] = settings.GARAGE61_CLIENT_SECRET
            else:
                payload["client_id"] = settings.GARAGE61_CLIENT_ID
                payload["client_secret"] = ""

            response = await client.post(
                settings.GARAGE61_TOKEN_URL,
                data=payload,
                headers=headers,
                auth=auth,
                timeout=30,
            )
            if (
                response.status_code == 401
                and not settings.GARAGE61_CLIENT_SECRET
                and "invalid_client" in response.text
            ):
                logger.info("Retrying refresh with empty Basic Auth")
                response = await client.post(
                    settings.GARAGE61_TOKEN_URL,
                    data=payload,
                    headers=headers,
                    auth=(settings.GARAGE61_CLIENT_ID, ""),
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
    """Fetch the authenticated user's profile from Garage61 /me."""
    logger.info(f"Fetching user info with token: {access_token[:20]}...")
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                f"{settings.GARAGE61_API_BASE}/me",
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
