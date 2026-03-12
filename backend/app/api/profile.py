"""
User profile management endpoints.
"""

from fastapi import APIRouter, Depends
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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.put("/claude-key")
async def update_claude_key(
    body: UpdateClaudeKeyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Store (or remove) the user's personal Anthropic API key.
    Send an empty string to remove the override and fall back to the operator key.
    """
    if body.api_key.strip():
        current_user.claude_api_key_enc = encrypt(body.api_key.strip())
    else:
        current_user.claude_api_key_enc = None

    await db.flush()

    return {
        "message": "Claude API key updated successfully",
        "has_custom_claude_key": bool(current_user.claude_api_key_enc),
    }


@router.get("/")
async def get_profile(
    current_user: User = Depends(get_current_user),
) -> dict:
    """Return the current user's profile information."""
    return {
        "id": str(current_user.id),
        "garage61_user_id": current_user.garage61_user_id,
        "display_name": current_user.display_name,
        "avatar_url": current_user.avatar_url,
        "has_custom_claude_key": bool(current_user.claude_api_key_enc),
        "created_at": current_user.created_at.isoformat(),
        "last_login_at": current_user.last_login_at.isoformat(),
    }
