import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.crypto import decrypt, encrypt
from app.auth.jwt import create_access_token, get_current_user
from app.auth.oauth import exchange_code, get_authorization_url, get_user_info
from app.database import get_db
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])


class UserMeResponse(BaseModel):
    id: str
    display_name: str
    avatar_url: str | None
    has_custom_claude_key: bool


@router.get("/login")
async def login(response: Response):
    """Initiate Garage61 OAuth2 flow. Stores CSRF state in a cookie and redirects."""
    state = secrets.token_urlsafe(32)
    auth_url = get_authorization_url(state)

    redirect = RedirectResponse(url=auth_url, status_code=status.HTTP_302_FOUND)
    redirect.set_cookie(
        key="oauth_state",
        value=state,
        httponly=True,
        samesite="lax",
        max_age=600,  # 10 minutes
        secure=False,  # set True in production with HTTPS
    )
    return redirect


@router.get("/callback")
async def callback(
    request: Request,
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
):
    """Handle OAuth2 callback: verify state, exchange code, upsert user, set session."""
    stored_state = request.cookies.get("oauth_state")
    if not stored_state or stored_state != state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid OAuth state parameter",
        )

    # Exchange code for tokens
    token_data = await exchange_code(code)
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")

    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to obtain access token from Garage61",
        )

    # Fetch user profile
    user_info = await get_user_info(access_token)
    garage61_user_id = str(
        user_info.get("id") or user_info.get("user_id") or user_info.get("sub", "")
    )
    if not garage61_user_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not determine user ID from Garage61",
        )

    display_name = (
        user_info.get("display_name")
        or user_info.get("name")
        or user_info.get("username")
        or "Unknown Driver"
    )
    avatar_url = user_info.get("avatar_url") or user_info.get("avatar")

    # Encrypt tokens for storage
    access_token_enc = encrypt(access_token)
    refresh_token_enc = encrypt(refresh_token) if refresh_token else None

    # Upsert user
    result = await db.execute(
        select(User).where(User.garage61_user_id == garage61_user_id)
    )
    user = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if user is None:
        user = User(
            garage61_user_id=garage61_user_id,
            display_name=display_name,
            avatar_url=avatar_url,
            access_token_enc=access_token_enc,
            refresh_token_enc=refresh_token_enc,
            created_at=now,
            last_login_at=now,
        )
        db.add(user)
    else:
        user.display_name = display_name
        user.avatar_url = avatar_url
        user.access_token_enc = access_token_enc
        if refresh_token_enc:
            user.refresh_token_enc = refresh_token_enc
        user.last_login_at = now

    await db.flush()
    await db.refresh(user)

    # Create JWT session
    jwt_token = create_access_token(str(user.id))

    redirect = RedirectResponse(url="/", status_code=status.HTTP_302_FOUND)
    # Clear the oauth_state cookie
    redirect.delete_cookie("oauth_state")
    # Set the session cookie
    redirect.set_cookie(
        key="session",
        value=jwt_token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 7,  # 1 week
        secure=False,  # set True in production with HTTPS
    )
    return redirect


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout():
    """Clear the session cookie and log the user out."""
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie("session")
    return response


@router.get("/me", response_model=UserMeResponse)
async def me(current_user: User = Depends(get_current_user)) -> UserMeResponse:
    """Return the current user's public profile info."""
    return UserMeResponse(
        id=str(current_user.id),
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
        has_custom_claude_key=bool(current_user.claude_api_key_enc),
    )
