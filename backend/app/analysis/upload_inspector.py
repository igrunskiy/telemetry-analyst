from __future__ import annotations

import os
import re
from typing import Any

from app.analysis.processor import TelemetryProcessor


_KEY_ALIASES = {
    "car_name": {"car", "carname", "vehicle"},
    "track_name": {"track", "trackname", "circuit", "venue"},
    "driver_name": {"driver", "drivername", "name"},
    "recorded_at": {"date", "time", "datetime", "recordedat", "sessiondate", "sessiontime"},
    "lap_time": {"laptime", "laptimems", "bestlap", "time"},
}


def _normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _parse_lap_time_to_ms(value: str) -> float | None:
    text = value.strip()
    if not text:
        return None

    match = re.match(r"^(?:(\d+):)?(\d{1,2})(?:\.(\d{1,3}))?$", text)
    if match:
        minutes = int(match.group(1) or 0)
        seconds = int(match.group(2))
        millis = int((match.group(3) or "0").ljust(3, "0"))
        return float((minutes * 60 + seconds) * 1000 + millis)

    try:
        numeric = float(text)
    except ValueError:
        return None
    return numeric * 1000.0 if numeric < 1000 else numeric


def _parse_filename_metadata(filename: str) -> dict[str, Any]:
    stem = os.path.splitext(os.path.basename(filename))[0]
    lap_time_match = re.search(r"(\d+[:_]\d{2}[._]\d{1,3})", stem)
    lap_time = None
    if lap_time_match:
        lap_time = _parse_lap_time_to_ms(
            lap_time_match.group(1).replace("_", ":")
        )

    metadata = {
        "car_name": "",
        "track_name": "",
        "driver_name": "",
        "recorded_at": "",
        "lap_time": lap_time,
    }

    stem_without_lap_time = stem
    if lap_time_match:
        stem_without_lap_time = stem.replace(lap_time_match.group(1), " ")

    compact_stem = re.sub(r"[._]+", " ", stem_without_lap_time).strip(" -_")
    patterns = [
        (
            r"(?:^|[\s_-])car[\s_-]+(?P<car>.+?)(?:[\s_-]+(?:track|circuit)[\s_-]+(?P<track>.+))?$",
            ("car", "track"),
        ),
        (
            r"(?:^|[\s_-])(?:track|circuit)[\s_-]+(?P<track>.+?)(?:[\s_-]+car[\s_-]+(?P<car>.+))?$",
            ("car", "track"),
        ),
        (
            r"^(?P<car>.+?)\s+(?:at|@)\s+(?P<track>.+)$",
            ("car", "track"),
        ),
    ]

    for pattern, groups in patterns:
        match = re.search(pattern, compact_stem, flags=re.IGNORECASE)
        if not match:
            continue
        car = (match.groupdict().get("car") or "").strip(" -_")
        track = (match.groupdict().get("track") or "").strip(" -_")
        if "car" in groups and car and not metadata["car_name"]:
            metadata["car_name"] = car
        if "track" in groups and track and not metadata["track_name"]:
            metadata["track_name"] = track
        if metadata["car_name"] or metadata["track_name"]:
            break

    return metadata


def extract_upload_metadata(filename: str, content: str) -> dict[str, Any]:
    metadata = _parse_filename_metadata(filename)

    for raw_line in content.splitlines()[:40]:
        line = raw_line.strip().strip("\ufeff")
        if not line or "," in line:
            continue

        match = re.match(r"^\s*([^:=\-]+?)\s*[:=\-]\s*(.+?)\s*$", line)
        if not match:
            continue

        raw_key, raw_value = match.groups()
        key = _normalize_key(raw_key)
        value = raw_value.strip()
        if not value:
            continue

        for target, aliases in _KEY_ALIASES.items():
            if key in aliases and not metadata.get(target):
                metadata[target] = value
                break

    lap_time = metadata.get("lap_time")
    if isinstance(lap_time, str):
        metadata["lap_time"] = _parse_lap_time_to_ms(lap_time)

    return metadata


def inspect_upload(filename: str, content: str) -> dict[str, Any]:
    processor = TelemetryProcessor()
    metadata = extract_upload_metadata(filename, content)

    try:
        df = processor.parse_csv(content)
        sample_count = len(df)
        columns = [str(c) for c in df.columns]
        track_length_m = processor.detect_track_length(df)
        return {
            "file_name": filename,
            "valid": True,
            "error": None,
            "metadata": metadata,
            "sample_count": sample_count,
            "columns": columns,
            "track_length_m": track_length_m,
        }
    except Exception as exc:
        return {
            "file_name": filename,
            "valid": False,
            "error": str(exc),
            "metadata": metadata,
            "sample_count": 0,
            "columns": [],
            "track_length_m": None,
        }
