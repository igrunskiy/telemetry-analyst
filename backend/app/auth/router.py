import secrets
import logging
from datetime import datetime, timezone

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.crypto import decrypt, encrypt
from app.config import settings
from app.auth.jwt import create_access_token, get_current_user
from app.auth.oauth import exchange_code, get_authorization_url, get_user_info
from app.auth.discord import (
    exchange_discord_code,
    get_discord_authorization_url,
    get_discord_user_info,
    get_discord_avatar_url,
)
from app.database import get_db
from app.llm_access import build_llm_access_state
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


def _has_usable_personal_token(value: str | None) -> bool:
    token = (value or "").strip()
    if not token:
        return False
    placeholders = {
        "your_personal_token_here",
        "changeme",
        "your_token_here",
    }
    return token.lower() not in placeholders


async def _resolve_user(request: Request, token: str | None, db):
    """Resolve the current user from either the Authorization header or a ?token= query param.
    The query param path exists for browser-redirect endpoints where headers can't be set."""
    import uuid as _uuid
    from jose import JWTError, jwt as _jwt
    from app.config import settings
    from app.models.user import User as _User
    from sqlalchemy import select as _select

    if token:
        try:
            payload = _jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
            user_id = _uuid.UUID(payload["sub"])
        except (JWTError, ValueError):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        result = await db.execute(_select(_User).where(_User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        return user

    return await get_current_user(request, db)


class UserMeResponse(BaseModel):
    id: str
    display_name: str
    avatar_url: str | None
    has_custom_claude_key: bool
    has_custom_gemini_key: bool
    has_garage61: bool
    role: str
    llm_access: dict


class LocalLoginRequest(BaseModel):
    username: str
    password: str


async def _upsert_user_from_token(
    db: AsyncSession,
    access_token: str,
    refresh_token: str | None = None,
) -> User:
    logger.info("Fetching user profile from Garage61")
    user_info = await get_user_info(access_token)
    logger.info(f"User info received, keys: {list(user_info.keys())}")

    garage61_user_id = str(
        user_info.get("id") or user_info.get("user_id") or user_info.get("sub", "")
    )
    logger.info(f"User ID: {garage61_user_id}")

    if not garage61_user_id:
        logger.error(f"Could not determine user ID from response: {user_info}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not determine user ID from Garage61",
        )

    display_name = (
        user_info.get("display_name")
        or user_info.get("displayName")
        or user_info.get("name")
        or user_info.get("username")
        or user_info.get("nickName")
        or user_info.get("slug")
        or "Unknown Driver"
    )
    if display_name == "Unknown Driver":
        first = user_info.get("firstName")
        last = user_info.get("lastName")
        if first or last:
            display_name = " ".join(filter(None, [first, last]))
    avatar_url = user_info.get("avatar_url") or user_info.get("avatar")
    logger.info(f"Display name: {display_name}")

    access_token_enc = encrypt(access_token)
    refresh_token_enc = encrypt(refresh_token) if refresh_token else None

    logger.info(f"Looking up user with garage61_user_id: {garage61_user_id}")
    result = await db.execute(
        select(User).where(User.garage61_user_id == garage61_user_id)
    )
    user = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if user is None:
        logger.info(f"Creating new user: {garage61_user_id}")
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
        logger.info(f"Updating existing user: {garage61_user_id}")
        user.display_name = display_name
        user.avatar_url = avatar_url
        user.access_token_enc = access_token_enc
        if refresh_token_enc:
            user.refresh_token_enc = refresh_token_enc
        user.last_login_at = now

    await db.flush()
    await db.refresh(user)
    logger.info(f"User {garage61_user_id} saved/updated")
    return user


@router.get("/login")
async def login(response: Response, db: AsyncSession = Depends(get_db)):
    """Initiate Garage61 OAuth2 flow. Stores CSRF state in a cookie and redirects."""
    if _has_usable_personal_token(settings.GARAGE61_PERSONAL_TOKEN):
        logger.info("Using Garage61 personal access token for login")
        try:
            user = await _upsert_user_from_token(db, settings.GARAGE61_PERSONAL_TOKEN)
            await db.commit()
            jwt_token = create_access_token(user.id)
            return RedirectResponse(
                url=f"/callback?access_token={jwt_token}",
                status_code=status.HTTP_302_FOUND,
            )
        except Exception:
            logger.warning(
                "Garage61 personal access token login failed; falling back to OAuth flow",
                exc_info=True,
            )

    state = secrets.token_urlsafe(32)
    auth_url, code_verifier = get_authorization_url(state)

    redirect = RedirectResponse(url=auth_url, status_code=status.HTTP_302_FOUND)
    redirect.set_cookie(
        key="oauth_state",
        value=state,
        httponly=True,
        samesite="lax",
        max_age=600,  # 10 minutes
        secure=False,  # set True in production with HTTPS
    )
    redirect.set_cookie(
        key="oauth_verifier",
        value=code_verifier,
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
    """Handle OAuth2 callback: verify state, exchange code, upsert user, set session.
    When connect_user_id cookie is present, links the Garage61 account to that user instead."""
    logger.info(f"OAuth callback received with code: {code[:20]}... and state: {state[:20]}...")

    stored_state = request.cookies.get("oauth_state")
    code_verifier = request.cookies.get("oauth_verifier")
    connect_user_id = request.cookies.get("connect_user_id")
    logger.info(f"Stored state: {stored_state[:20] if stored_state else 'NONE'}...")
    logger.info(f"Received state: {state[:20]}...")
    logger.info(f"PKCE verifier present: {bool(code_verifier)}")
    logger.info(f"Connect flow: {bool(connect_user_id)}")

    if not stored_state or stored_state != state:
        logger.error("State validation failed")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid OAuth state parameter",
        )

    logger.info("State validation passed, exchanging code for tokens")

    # Exchange code for tokens
    try:
        token_data = await exchange_code(code, code_verifier)
        logger.info(f"Token exchange succeeded, keys: {list(token_data.keys())}")
    except Exception as e:
        logger.error(f"Token exchange failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to exchange code: {str(e)}. Check GARAGE61_CLIENT_ID, GARAGE61_CLIENT_SECRET, and GARAGE61_REDIRECT_URI.",
        )

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")

    if not access_token:
        logger.error(f"No access token in response: {token_data}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to obtain access token from Garage61",
        )

    if connect_user_id:
        # Link flow: attach Garage61 tokens to the existing user
        try:
            redirect = await _link_garage61_to_user(
                db, connect_user_id, access_token, refresh_token
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to link Garage61 account: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to link Garage61 account: {str(e)}",
            )
        redirect.delete_cookie("oauth_state")
        redirect.delete_cookie("oauth_verifier")
        redirect.delete_cookie("connect_user_id")
        return redirect
    else:
        # Normal login flow: upsert user
        try:
            user = await _upsert_user_from_token(db, access_token, refresh_token)
        except Exception as e:
            logger.error(f"Failed to fetch user info: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Failed to fetch user info: {str(e)}",
            )

        logger.info(f"User {user.garage61_user_id} saved/updated, issuing JWT")

        await db.commit()
        jwt_token = create_access_token(user.id)

        redirect = RedirectResponse(
            url=f"/callback?access_token={jwt_token}",
            status_code=status.HTTP_302_FOUND,
        )
        redirect.delete_cookie("oauth_state")
        redirect.delete_cookie("oauth_verifier")
        return redirect


async def _link_garage61_to_user(
    db: AsyncSession,
    user_id: str,
    access_token: str,
    refresh_token: str | None,
) -> RedirectResponse:
    """Link a Garage61 account to an existing user by updating their tokens."""
    import uuid as _uuid
    try:
        uid = _uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid connect_user_id",
        )

    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Fetch Garage61 profile to get the garage61_user_id
    user_info = await get_user_info(access_token)
    garage61_user_id = str(
        user_info.get("id") or user_info.get("user_id") or user_info.get("sub", "")
    )
    if not garage61_user_id:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not determine user ID from Garage61",
        )

    # Ensure this garage61_user_id isn't already claimed by another user
    existing = await db.execute(
        select(User).where(
            User.garage61_user_id == garage61_user_id,
            User.id != uid,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This Garage61 account is already linked to another user",
        )

    user.garage61_user_id = garage61_user_id
    user.access_token_enc = encrypt(access_token)
    if refresh_token:
        user.refresh_token_enc = encrypt(refresh_token)
    await db.flush()
    await db.commit()

    logger.info(f"Linked Garage61 account {garage61_user_id} to user {user_id}")
    return RedirectResponse(url="/profile?garage61=connected", status_code=status.HTTP_302_FOUND)


@router.get("/garage61/connect")
async def garage61_connect(
    request: Request,
    token: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Initiate Garage61 OAuth2 flow to link an account to the current user.
    Accepts the JWT via ?token= query param because this endpoint is reached
    via browser redirect, not an XHR call that can set Authorization headers."""
    current_user = await _resolve_user(request, token, db)
    """Initiate Garage61 OAuth2 flow to link an account to the current user."""
    state = secrets.token_urlsafe(32)
    auth_url, code_verifier = get_authorization_url(state)

    redirect = RedirectResponse(url=auth_url, status_code=status.HTTP_302_FOUND)
    redirect.set_cookie(
        key="oauth_state",
        value=state,
        httponly=True,
        samesite="lax",
        max_age=600,
        secure=False,
    )
    redirect.set_cookie(
        key="oauth_verifier",
        value=code_verifier,
        httponly=True,
        samesite="lax",
        max_age=600,
        secure=False,
    )
    redirect.set_cookie(
        key="connect_user_id",
        value=str(current_user.id),
        httponly=True,
        samesite="lax",
        max_age=600,
        secure=False,
    )
    return redirect


@router.post("/local/login")
async def local_login(
    body: LocalLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate with username and password, returns a JWT."""
    result = await db.execute(select(User).where(User.username == body.username))
    user = result.scalar_one_or_none()

    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid username or password",
    )

    if user is None or not user.password_hash:
        raise invalid

    if not bcrypt.checkpw(body.password.encode(), user.password_hash.encode()):
        raise invalid

    if user.is_suspended:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account suspended",
        )

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()

    jwt_token = create_access_token(user.id)
    return {"access_token": jwt_token, "token_type": "bearer"}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout():
    """Log the user out (client should discard the access token)."""
    # With Bearer token auth, logout is client-side (discard the token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/discord/login")
async def discord_login():
    """Initiate Discord OAuth2 flow."""
    state = secrets.token_urlsafe(32)
    auth_url = get_discord_authorization_url(state)
    redirect = RedirectResponse(url=auth_url, status_code=status.HTTP_302_FOUND)
    redirect.set_cookie(
        key="discord_oauth_state",
        value=state,
        httponly=True,
        samesite="lax",
        max_age=600,
        secure=False,
    )
    return redirect


@router.get("/discord/callback")
async def discord_callback(
    request: Request,
    code: str,
    state: str,
    db: AsyncSession = Depends(get_db),
):
    """Handle Discord OAuth2 callback: verify state, exchange code, upsert user, issue JWT."""
    stored_state = request.cookies.get("discord_oauth_state")
    if not stored_state or stored_state != state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid OAuth state parameter",
        )

    try:
        token_data = await exchange_discord_code(code)
    except Exception as e:
        logger.error(f"Discord token exchange failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to exchange Discord code: {str(e)}",
        )

    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to obtain access token from Discord",
        )

    try:
        discord_user = await get_discord_user_info(access_token)
    except Exception as e:
        logger.error(f"Failed to fetch Discord user info: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch Discord user info: {str(e)}",
        )

    discord_user_id = str(discord_user["id"])
    display_name = discord_user.get("global_name") or discord_user.get("username", "Unknown")
    avatar_url = get_discord_avatar_url(discord_user_id, discord_user.get("avatar"))

    result = await db.execute(select(User).where(User.discord_user_id == discord_user_id))
    user = result.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if user is None:
        logger.info(f"Creating new Discord user: {discord_user_id}")
        user = User(
            discord_user_id=discord_user_id,
            display_name=display_name,
            avatar_url=avatar_url,
            created_at=now,
            last_login_at=now,
        )
        db.add(user)
    else:
        logger.info(f"Updating existing Discord user: {discord_user_id}")
        user.display_name = display_name
        user.avatar_url = avatar_url
        user.last_login_at = now

    await db.flush()
    await db.refresh(user)
    await db.commit()

    jwt_token = create_access_token(user.id)

    redirect = RedirectResponse(
        url=f"/callback?access_token={jwt_token}",
        status_code=status.HTTP_302_FOUND,
    )
    redirect.delete_cookie("discord_oauth_state")
    return redirect


@router.get("/me", response_model=UserMeResponse)
async def me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserMeResponse:
    """Return the current user's public profile info."""
    return UserMeResponse(
        id=str(current_user.id),
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
        has_custom_claude_key=bool(current_user.claude_api_key_enc),
        has_custom_gemini_key=bool(current_user.gemini_api_key_enc),
        has_garage61=bool(current_user.access_token_enc),
        role=current_user.role,
        llm_access=await build_llm_access_state(current_user, db),
    )
