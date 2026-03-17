from datetime import datetime, timedelta, timezone
import logging
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.auth.oauth import get_user_info

logger = logging.getLogger(__name__)


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """FastAPI dependency: validates OAuth2 Bearer token from Garage61, returns User."""
    # Import here to avoid circular import at module load time
    from app.models.user import User

    # Extract Bearer token from Authorization header
    auth_header = request.headers.get("Authorization")
    logger.info(f"Authorization header present: {bool(auth_header)}")
    
    if not auth_header or not auth_header.startswith("Bearer "):
        logger.warning("Missing or invalid Authorization header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = auth_header[7:]  # Remove "Bearer " prefix
    logger.info(f"Bearer token extracted: {token[:20]}...")

    # Validate token with Garage61 API
    try:
        logger.info("Validating token with Garage61")
        user_info = await get_user_info(token)
        logger.info(f"Token validation succeeded, user_info keys: {list(user_info.keys())}")
    except Exception as exc:
        logger.error(f"Token validation failed: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    garage61_user_id = str(
        user_info.get("id") or user_info.get("user_id") or user_info.get("sub", "")
    )
    logger.info(f"User ID from token: {garage61_user_id}")
    
    if not garage61_user_id:
        logger.error(f"Could not extract user ID from user_info: {user_info}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not determine user ID from token",
        )

    # Look up user in database by Garage61 ID
    logger.info(f"Looking up user in database with garage61_user_id: {garage61_user_id}")
    result = await db.execute(
        select(User).where(User.garage61_user_id == garage61_user_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        logger.error(f"User {garage61_user_id} not found in database")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    logger.info(f"User {garage61_user_id} loaded from database: {user.display_name}")
    return user
