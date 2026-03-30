"""
Admin API router.

All endpoints require the 'admin' role.
"""

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import List

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.jwt import require_admin
from app.database import get_db, AsyncSessionLocal
from app.models.user import User
from app.models.analysis import AnalysisResult
from app.analysis import prompts_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

# Path to the .env file (one level up from the app package)
_ENV_PATH = Path(__file__).parent.parent.parent / ".env"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class AdminUserItem(BaseModel):
    id: str
    display_name: str
    username: str | None
    email: str | None
    role: str
    is_suspended: bool
    garage61_user_id: str | None
    discord_user_id: str | None
    created_at: str
    last_login_at: str


class SuspendRequest(BaseModel):
    suspended: bool


class CreateUserRequest(BaseModel):
    username: str
    password: str
    display_name: str
    email: str | None = None
    role: str = "user"


class AdminReportItem(BaseModel):
    id: str
    user_id: str
    username: str | None
    display_name: str
    car_name: str
    track_name: str
    analysis_mode: str
    status: str
    llm_provider: str | None
    model_name: str | None
    prompt_version: str | None
    created_at: str
    enqueued_at: str | None
    error_message: str | None


class ConfigUpdateRequest(BaseModel):
    content: str


class PoolSizeRequest(BaseModel):
    pool_size: int


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

@router.get("/users", response_model=List[AdminUserItem])
async def list_users(
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return all users."""
    result = await db.execute(select(User).order_by(User.created_at))
    users = result.scalars().all()
    return [
        AdminUserItem(
            id=str(u.id),
            display_name=u.display_name,
            username=u.username,
            email=u.email,
            role=u.role,
            is_suspended=u.is_suspended,
            garage61_user_id=u.garage61_user_id,
            discord_user_id=u.discord_user_id,
            created_at=u.created_at.isoformat(),
            last_login_at=u.last_login_at.isoformat(),
        )
        for u in users
    ]


@router.patch("/users/{user_id}/suspend")
async def set_user_suspended(
    user_id: str,
    body: SuspendRequest,
    admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Suspend or unsuspend a user account."""
    import uuid
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user ID")

    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if str(user.id) == str(admin.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot suspend your own account",
        )

    user.is_suspended = body.suspended
    await db.commit()
    action = "suspended" if body.suspended else "unsuspended"
    logger.info(f"Admin {admin.username} {action} user {user_id}")
    return {"id": user_id, "is_suspended": body.suspended}


@router.post("/users", response_model=AdminUserItem, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: CreateUserRequest,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new local user account."""
    # Check uniqueness
    result = await db.execute(select(User).where(User.username == body.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")

    password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    now = datetime.now(timezone.utc)
    user = User(
        username=body.username,
        password_hash=password_hash,
        display_name=body.display_name,
        email=body.email,
        role=body.role,
        created_at=now,
        last_login_at=now,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    await db.commit()

    return AdminUserItem(
        id=str(user.id),
        display_name=user.display_name,
        username=user.username,
        email=user.email,
        role=user.role,
        is_suspended=user.is_suspended,
        garage61_user_id=user.garage61_user_id,
        discord_user_id=user.discord_user_id,
        created_at=user.created_at.isoformat(),
        last_login_at=user.last_login_at.isoformat(),
    )


@router.patch("/users/{user_id}/role")
async def set_user_role(
    user_id: str,
    body: dict,
    admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Change a user's role (admin or user)."""
    import uuid
    role = body.get("role")
    if role not in ("admin", "user"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Role must be 'admin' or 'user'")

    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user ID")

    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if str(user.id) == str(admin.id) and role != "admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove admin role from your own account",
        )

    user.role = role
    await db.commit()
    return {"id": user_id, "role": role}


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

@router.get("/reports", response_model=List[AdminReportItem])
async def list_all_reports(
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Return all analysis reports across all users, newest first."""
    result = await db.execute(
        select(AnalysisResult, User)
        .join(User, AnalysisResult.user_id == User.id)
        .order_by(desc(AnalysisResult.created_at))
        .limit(30)
    )
    rows = result.all()
    items = []
    for record, user in rows:
        rj = record.result_json or {}
        input_data = record.input_json or {}
        analysis_mode = rj.get("analysis_mode") or input_data.get("analysis_mode", "vs_reference")
        items.append(AdminReportItem(
            id=str(record.id),
            user_id=str(record.user_id),
            username=user.username,
            display_name=user.display_name,
            car_name=record.car_name,
            track_name=record.track_name,
            analysis_mode=analysis_mode,
            status=record.status,
            llm_provider=input_data.get("llm_provider") or rj.get("llm_provider"),
            model_name=rj.get("model_name"),
            prompt_version=rj.get("prompt_version") or input_data.get("prompt_version"),
            created_at=record.created_at.isoformat(),
            enqueued_at=record.enqueued_at.isoformat() if record.enqueued_at else None,
            error_message=record.error_message,
        ))
    return items


@router.post("/reports/{report_id}/fail", status_code=status.HTTP_200_OK)
async def fail_report(
    report_id: str,
    _admin=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Manually mark an enqueued or processing report as failed."""
    import uuid
    try:
        uid = uuid.UUID(report_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid report ID")

    result = await db.execute(select(AnalysisResult).where(AnalysisResult.id == uid))
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    if record.status not in ("enqueued", "processing"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot fail a report with status '{record.status}'",
        )

    record.status = "failed"
    record.error_message = "Manually cancelled by admin"
    await db.commit()
    logger.info("Admin manually failed report %s", report_id)
    return {"id": report_id, "status": "failed"}


# ---------------------------------------------------------------------------
# Prompt versions
# ---------------------------------------------------------------------------

class PromptCreateRequest(BaseModel):
    name: str
    content: str


class PromptDefaultsRequest(BaseModel):
    claude: str
    gemini: str


@router.get("/prompts")
async def list_prompts(_admin=Depends(require_admin)):
    """List all named prompt versions with their content and default-for info."""
    return prompts_manager.list_prompts()


@router.get("/prompts/defaults")
async def get_prompt_defaults(_admin=Depends(require_admin)):
    """Return the default prompt name for each model."""
    return prompts_manager.get_defaults()


@router.put("/prompts/defaults")
async def set_prompt_defaults(body: PromptDefaultsRequest, _admin=Depends(require_admin)):
    """Set the default prompt for each model."""
    prompts_manager.set_defaults({"claude": body.claude, "gemini": body.gemini})
    logger.info("Admin updated prompt defaults: %s", body.model_dump())
    return {"ok": True}


@router.post("/prompts")
async def create_prompt(body: PromptCreateRequest, _admin=Depends(require_admin)):
    """Create a new named prompt version."""
    import re
    if not re.match(r"^[a-z0-9_-]{1,64}$", body.name):
        raise HTTPException(status_code=422, detail="Name must be lowercase alphanumeric, dashes, or underscores (max 64 chars)")
    path = Path(__file__).parent.parent / "analysis" / "prompts" / f"{body.name}.md"
    if path.exists():
        raise HTTPException(status_code=409, detail=f"Prompt '{body.name}' already exists")
    prompts_manager.save_prompt(body.name, body.content)
    logger.info("Admin created prompt '%s'", body.name)
    return {"ok": True, "name": body.name}


@router.get("/prompts/{name}")
async def get_prompt(name: str, _admin=Depends(require_admin)):
    """Return the content of a named prompt."""
    content = prompts_manager.get_prompt(name)
    if content is None:
        raise HTTPException(status_code=404, detail=f"Prompt '{name}' not found")
    return {"name": name, "content": content}


@router.put("/prompts/{name}")
async def update_prompt(name: str, body: ConfigUpdateRequest, _admin=Depends(require_admin)):
    """Overwrite a named prompt file."""
    if prompts_manager.get_prompt(name) is None:
        raise HTTPException(status_code=404, detail=f"Prompt '{name}' not found")
    prompts_manager.save_prompt(name, body.content)
    logger.info("Admin updated prompt '%s'", name)
    return {"ok": True}


@router.delete("/prompts/{name}")
async def delete_prompt(name: str, _admin=Depends(require_admin)):
    """Delete a named prompt. Refuses if it is currently a default for any model."""
    defaults = prompts_manager.get_defaults()
    in_use_by = [model for model, pname in defaults.items() if pname == name]
    if in_use_by:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete '{name}': it is the default for {', '.join(in_use_by)}. Change the default first.",
        )
    if not prompts_manager.delete_prompt(name):
        raise HTTPException(status_code=404, detail=f"Prompt '{name}' not found")
    logger.info("Admin deleted prompt '%s'", name)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Server config (.env)
# ---------------------------------------------------------------------------

_REDACTED = "***"

# Keys whose values are redacted in the API response
_SENSITIVE_PATTERNS = ("KEY", "SECRET", "PASSWORD", "TOKEN", "DATABASE_URL")


def _is_sensitive(key: str) -> bool:
    upper = key.upper()
    return any(p in upper for p in _SENSITIVE_PATTERNS)


def _redact_env(content: str) -> str:
    """Replace sensitive values with *** while preserving comments and structure."""
    lines = []
    for line in content.splitlines(keepends=True):
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            lines.append(line)
            continue
        key, _, _val = stripped.partition("=")
        key = key.strip()
        if _is_sensitive(key) and _val.strip():
            lines.append(f"{key}={_REDACTED}\n")
        else:
            lines.append(line)
    return "".join(lines)


def _merge_env(submitted: str, original: str) -> str:
    """Restore redacted values from the original file before saving."""
    original_values: dict[str, str] = {}
    for line in original.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, val = stripped.partition("=")
        original_values[key.strip()] = val

    lines = []
    for line in submitted.splitlines(keepends=True):
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            lines.append(line)
            continue
        key, _, val = stripped.partition("=")
        key = key.strip()
        if val.strip() == _REDACTED and key in original_values:
            lines.append(f"{key}={original_values[key]}\n")
        else:
            lines.append(line)
    return "".join(lines)


@router.get("/config")
async def get_config(_admin=Depends(require_admin)):
    """Return the .env file content with sensitive values redacted."""
    if not _ENV_PATH.exists():
        return {"content": ""}
    return {"content": _redact_env(_ENV_PATH.read_text(encoding="utf-8"))}


@router.put("/config")
async def update_config(
    body: ConfigUpdateRequest,
    _admin=Depends(require_admin),
):
    """Overwrite the .env file, restoring any redacted (***) values from the original."""
    original = _ENV_PATH.read_text(encoding="utf-8") if _ENV_PATH.exists() else ""
    merged = _merge_env(body.content, original)
    _ENV_PATH.write_text(merged, encoding="utf-8")
    logger.info("Admin updated .env config")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Database health
# ---------------------------------------------------------------------------

@router.get("/db/health")
async def get_db_health(_admin=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Run a lightweight DB health check and return latency + basic stats."""
    import time
    from sqlalchemy import text

    t0 = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        ok = True
        error = None
    except Exception as exc:
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)
        ok = False
        error = str(exc)
        return {"ok": ok, "latency_ms": latency_ms, "error": error}

    # Gather lightweight stats
    result = await db.execute(
        select(func.count(AnalysisResult.id))
    )
    total_analyses = result.scalar_one()

    result = await db.execute(
        select(func.count(User.id))
    )
    total_users = result.scalar_one()

    # Count per-status
    status_counts: dict[str, int] = {}
    for s in ("enqueued", "processing", "completed", "failed"):
        r = await db.execute(
            select(func.count(AnalysisResult.id)).where(AnalysisResult.status == s)
        )
        status_counts[s] = r.scalar_one()

    return {
        "ok": ok,
        "latency_ms": latency_ms,
        "error": error,
        "total_users": total_users,
        "total_analyses": total_analyses,
        "analyses_by_status": status_counts,
    }


# ---------------------------------------------------------------------------
# Worker pool monitoring
# ---------------------------------------------------------------------------

@router.get("/worker/status")
async def get_worker_status(_admin=Depends(require_admin)):
    """Return current worker pool status and queue depth."""
    from app.analysis.worker import get_pool

    pool = get_pool()
    if pool is None:
        return {"pool_size": 0, "active_workers": 0, "queue_depth": 0, "tasks": []}

    status = pool.get_status()

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(func.count(AnalysisResult.id)).where(
                AnalysisResult.status == "enqueued"
            )
        )
        status["queue_depth"] = result.scalar_one()

    return status


@router.patch("/worker/pool-size")
async def set_pool_size(body: PoolSizeRequest, _admin=Depends(require_admin)):
    """Resize the worker pool at runtime (1–20 workers)."""
    from app.analysis.worker import get_pool

    if body.pool_size < 1 or body.pool_size > 20:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="pool_size must be between 1 and 20",
        )

    pool = get_pool()
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Worker pool is not running",
        )

    await pool.resize(body.pool_size)
    logger.info("Admin resized worker pool to %d", body.pool_size)
    return {"pool_size": body.pool_size}
