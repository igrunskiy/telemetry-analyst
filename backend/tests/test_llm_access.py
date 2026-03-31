from __future__ import annotations

import asyncio
from types import SimpleNamespace

from app.config import settings
from app.llm_access import build_llm_access_state, has_custom_llm_key, has_shared_llm_key


def test_has_custom_llm_key_detects_encrypted_user_key() -> None:
    user = SimpleNamespace(claude_api_key_enc="enc", gemini_api_key_enc=None)

    assert has_custom_llm_key(user, "claude") is True
    assert has_custom_llm_key(user, "gemini") is False


def test_has_shared_llm_key_detects_operator_key() -> None:
    original = settings.CLAUDE_API_KEY
    settings.CLAUDE_API_KEY = "shared-key"
    try:
        assert has_shared_llm_key("claude") is True
    finally:
        settings.CLAUDE_API_KEY = original


def test_build_llm_access_state_allows_shared_access() -> None:
    original_claude = settings.CLAUDE_API_KEY
    original_gemini = settings.GEMINI_API_KEY
    settings.CLAUDE_API_KEY = "shared-claude"
    settings.GEMINI_API_KEY = ""
    try:
        user = SimpleNamespace(id=None, claude_api_key_enc=None, gemini_api_key_enc="enc")
        access = asyncio.run(build_llm_access_state(user, None))

        assert access["shared_reports_per_day"] >= 0
        assert access["providers"]["claude"]["has_shared_key"] is True
        assert access["providers"]["claude"]["can_generate"] is True
        assert access["providers"]["claude"]["key_source"] == "shared"
        assert access["providers"]["gemini"]["can_generate"] is True
        assert access["providers"]["gemini"]["key_source"] == "custom"
    finally:
        settings.CLAUDE_API_KEY = original_claude
        settings.GEMINI_API_KEY = original_gemini
