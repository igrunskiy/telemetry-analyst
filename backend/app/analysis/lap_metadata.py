from __future__ import annotations

from typing import Any


def canonical_driver_name(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(value.split()).strip()


def driver_key(value: str | None) -> str:
    name = canonical_driver_name(value).lower()
    return "".join(ch for ch in name if ch.isalnum())


def normalize_lap_meta_dict(item: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(item)
    display_name = canonical_driver_name(str(item.get("driver_name") or item.get("source_driver_name") or ""))
    source_name = canonical_driver_name(str(item.get("source_driver_name") or item.get("driver_name") or ""))
    normalized["driver_name"] = display_name
    normalized["source_driver_name"] = source_name or None
    normalized["driver_key"] = str(
        item.get("driver_key") or driver_key(display_name) or driver_key(source_name) or ""
    ) or None
    conditions = item.get("conditions")
    if isinstance(conditions, dict):
        normalized_conditions = {
            key: value
            for key, value in conditions.items()
            if value not in (None, "", [])
        }
        normalized["conditions"] = normalized_conditions or None
    else:
        normalized["conditions"] = None
    return normalized
