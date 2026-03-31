from __future__ import annotations

import pytest

from app.garage61.client import Garage61Client


class _FakeResponse:
    def __init__(self, text: str, headers: dict[str, str] | None = None) -> None:
        self.text = text
        self.headers = headers or {}


@pytest.mark.asyncio
async def test_get_lap_csv_requests_text_csv(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Garage61Client("token", None, "user-id", db=None)
    captured: dict[str, object] = {}

    async def fake_get_raw(path: str, **kwargs: object) -> _FakeResponse:
        captured["path"] = path
        captured["headers"] = kwargs.get("headers")
        return _FakeResponse("LapDistPct,Speed\n0,100\n1,120\n", {"content-type": "text/csv"})

    monkeypatch.setattr(client, "_get_raw", fake_get_raw)

    csv_text = await client.get_lap_csv("lap-123")

    assert csv_text.startswith("LapDistPct")
    assert captured["path"] == "/laps/lap-123/csv"
    assert captured["headers"] == {"Accept": "text/csv, text/plain;q=0.9, */*;q=0.8"}


@pytest.mark.asyncio
async def test_get_lap_csv_rejects_empty_body(monkeypatch: pytest.MonkeyPatch) -> None:
    client = Garage61Client("token", None, "user-id", db=None)

    async def fake_get_raw(path: str, **kwargs: object) -> _FakeResponse:
        return _FakeResponse("", {"content-type": "text/csv"})

    monkeypatch.setattr(client, "_get_raw", fake_get_raw)

    with pytest.raises(ValueError, match="empty CSV body"):
        await client.get_lap_csv("lap-123")
