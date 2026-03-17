from urllib.parse import urlencode
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def get_authorization_url(state: str) -> str:
    """Build the Garage61 OAuth2 authorization URL."""
    params = {
        "client_id": settings.GARAGE61_CLIENT_ID,
        "redirect_uri": settings.GARAGE61_REDIRECT_URI,
        "response_type": "code",
        "scope": "driving_data",
        "state": state,
    }
    auth_url = f"{settings.GARAGE61_AUTH_URL}?{urlencode(params)}"
    logger.info(f"Authorization URL: {auth_url}")
    return auth_url


async def exchange_code(code: str) -> dict:
    """Exchange authorization code for access + refresh tokens."""
    import base64
    
    logger.info(f"Exchanging code: {code}")
    logger.info(f"Token endpoint: {settings.GARAGE61_TOKEN_URL}")
    logger.info(f"Client ID: {settings.GARAGE61_CLIENT_ID}")
    logger.info(f"Client Secret present: {bool(settings.GARAGE61_CLIENT_SECRET)}")
    logger.info(f"Client Secret value: '{settings.GARAGE61_CLIENT_SECRET}'")
    logger.info(f"Redirect URI: {settings.GARAGE61_REDIRECT_URI}")
    
    async with httpx.AsyncClient() as client:
        payload = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.GARAGE61_REDIRECT_URI,
        }
        logger.info(f"Request payload: {payload}")
        
        # Create basic auth header if secret is present
        auth_header = None
        if settings.GARAGE61_CLIENT_SECRET:
            credentials = f"{settings.GARAGE61_CLIENT_ID}:{settings.GARAGE61_CLIENT_SECRET}"
            auth_header = base64.b64encode(credentials.encode()).decode()
            logger.info(f"Using HTTP Basic Auth (with secret)")
        else:
            # If no secret, try just client_id in payload OR no auth
            logger.info(f"No client secret, trying approach 1: adding client_id to payload")
            payload["client_id"] = settings.GARAGE61_CLIENT_ID
        
        try:
            headers = {"Accept": "application/json"}
            if auth_header:
                headers["Authorization"] = f"Basic {auth_header}"
            
            logger.info(f"Request headers: {headers}")
            logger.info(f"Request payload: {payload}")
            
            response = await client.post(
                settings.GARAGE61_TOKEN_URL,
                data=payload,
                headers=headers,
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
        logger.info(f"Refresh request payload: {payload}")
        logger.info(f"Using HTTP Basic auth with client_id: {settings.GARAGE61_CLIENT_ID}")
        
        try:
            # Use HTTP Basic Authentication for client credentials
            response = await client.post(
                settings.GARAGE61_TOKEN_URL,
                data=payload,
                headers={"Accept": "application/json"},
                auth=(settings.GARAGE61_CLIENT_ID, settings.GARAGE61_CLIENT_SECRET or ""),
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
