"""
User profile management endpoints.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.crypto import encrypt
from app.auth.jwt import get_current_user
from app.database import get_db
from app.models.user import User

router = APIRouter(prefix="/api/profile", tags=["profile"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class UpdateClaudeKeyRequest(BaseModel):
    api_key: str


class UserProfileResponse(BaseModel):
    id: str
    garage61_user_id: str
    display_name: str
    avatar_url: str | None
    has_custom_claude_key: bool
    created_at: datetime
    last_login_at: datetime


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.put("/claude-key", status_code=status.HTTP_204_NO_CONTENT)
async def update_claude_key(
    body: UpdateClaudeKeyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """
    Store (or remove) the user's personal Anthropic API key.
    Send an empty string to remove the override and fall back to the operator key.
    Returns 204 No Content on success.
    """
    if body.api_key.strip():
        current_user.claude_api_key_enc = encrypt(body.api_key.strip())
    else:
        current_user.claude_api_key_enc = None

    await db.flush()


@router.get("/", response_model=UserProfileResponse)
async def get_profile(
    current_user: User = Depends(get_current_user),
) -> UserProfileResponse:
    """Return the current user's profile information."""
    return UserProfileResponse(
        id=str(current_user.id),
        garage61_user_id=current_user.garage61_user_id,
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
        has_custom_claude_key=bool(current_user.claude_api_key_enc),
        created_at=current_user.created_at,
        last_login_at=current_user.last_login_at,
    )
