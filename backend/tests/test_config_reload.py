from __future__ import annotations

from app.config import reload_settings, settings


def test_reload_settings_updates_timeout_from_process_env(monkeypatch) -> None:
    original_timeout = settings.ANALYSIS_WORKER_TIMEOUT
    original_pool_size = settings.ANALYSIS_WORKER_POOL_SIZE
    try:
        monkeypatch.setenv("ANALYSIS_WORKER_TIMEOUT", "37")
        monkeypatch.setenv("ANALYSIS_WORKER_POOL_SIZE", "9")

        reload_settings()

        assert settings.ANALYSIS_WORKER_TIMEOUT == 37
        assert settings.ANALYSIS_WORKER_POOL_SIZE == 9
    finally:
        monkeypatch.setenv("ANALYSIS_WORKER_TIMEOUT", str(original_timeout))
        monkeypatch.setenv("ANALYSIS_WORKER_POOL_SIZE", str(original_pool_size))
        reload_settings()
