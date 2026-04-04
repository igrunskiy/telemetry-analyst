from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select

from app.config import settings

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

SUPPORTED_LLM_PROVIDERS = ("claude", "gemini", "openai")

_PROVIDER_LABELS = {
    "claude": "Claude",
    "gemini": "Gemini",
    "openai": "OpenAI",
}

_CUSTOM_KEY_ATTRS = {
    "claude": "claude_api_key_enc",
    "gemini": "gemini_api_key_enc",
    "openai": "openai_api_key_enc",
}

def get_shared_report_limit() -> int:
    raw = os.getenv("DEFAULT_SHARED_REPORTS_PER_DAY", str(settings.DEFAULT_SHARED_REPORTS_PER_DAY))
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        return max(0, settings.DEFAULT_SHARED_REPORTS_PER_DAY)


def has_custom_llm_key(user: Any, provider: str) -> bool:
    attr = _CUSTOM_KEY_ATTRS.get(provider)
    if not attr:
        return False
    return bool(getattr(user, attr, None))


def has_shared_llm_key(provider: str) -> bool:
    if provider == "claude":
        return bool((settings.CLAUDE_API_KEY or "").strip())
    if provider == "gemini":
        return bool((settings.GEMINI_API_KEY or "").strip())
    if provider == "openai":
        return bool((settings.OPENAI_API_KEY or "").strip())
    return False


async def get_shared_reports_used_last_24h(user: Any, db: Any) -> int:
    if db is None or getattr(user, "id", None) is None:
        return 0
    from app.models.analysis import AnalysisResult

    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    result = await db.execute(
        select(func.count())
        .select_from(AnalysisResult)
        .where(
            AnalysisResult.user_id == user.id,
            AnalysisResult.created_at >= cutoff,
            AnalysisResult.input_json["used_shared_provider"].as_boolean() == True,
        )
    )
    return int(result.scalar() or 0)


async def build_llm_access_state(user: Any, db: Any) -> dict[str, Any]:
    shared_reports_per_day = get_shared_report_limit()
    shared_reports_used_today = await get_shared_reports_used_last_24h(user, db)
    shared_reports_remaining_today = max(0, shared_reports_per_day - shared_reports_used_today)

    providers: dict[str, Any] = {}
    for provider in SUPPORTED_LLM_PROVIDERS:
        has_custom = has_custom_llm_key(user, provider)
        has_shared = has_shared_llm_key(provider)
        if has_custom:
            key_source = "custom"
            can_generate = True
            disabled_reason: str | None = None
            uses_shared_quota = False
        elif has_shared:
            key_source = "shared"
            can_generate = shared_reports_remaining_today > 0
            disabled_reason = None if can_generate else "shared_quota_exhausted"
            uses_shared_quota = True
        else:
            key_source = "none"
            can_generate = False
            disabled_reason = "no_key_configured"
            uses_shared_quota = False

        providers[provider] = {
            "provider": provider,
            "label": _PROVIDER_LABELS[provider],
            "has_custom_key": has_custom,
            "has_shared_key": has_shared,
            "key_source": key_source,
            "uses_shared_quota": uses_shared_quota,
            "can_generate": can_generate,
            "disabled_reason": disabled_reason,
            "shared_reports_remaining_today": shared_reports_remaining_today,
        }

    return {
        "shared_reports_per_day": shared_reports_per_day,
        "shared_reports_used_today": shared_reports_used_today,
        "shared_reports_remaining_today": shared_reports_remaining_today,
        "providers": providers,
    }


async def require_llm_provider_access(user: Any, provider: str, db: AsyncSession) -> dict[str, Any]:
    if provider not in SUPPORTED_LLM_PROVIDERS:
        raise ValueError(f"Unsupported LLM provider: {provider}")

    access = await build_llm_access_state(user, db)
    provider_access = access["providers"][provider]
    if provider_access["can_generate"]:
        return provider_access

    label = provider_access["label"]
    if provider_access["disabled_reason"] == "shared_quota_exhausted":
        raise PermissionError(
            f"The free shared {label} report quota has been reached for the last 24 hours. "
            "Add your own API key in Profile or wait for quota to refresh."
        )
    raise PermissionError(
        f"{label} is not configured for your account, and no shared free reports are currently available. "
        "Add your own API key in Profile before generating reports."
    )
