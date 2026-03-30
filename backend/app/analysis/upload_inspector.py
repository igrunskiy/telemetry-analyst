from __future__ import annotations

import json
import os
import re
from difflib import get_close_matches
from typing import Any

from app.analysis.processor import TelemetryProcessor
from app.config import settings


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


def _empty_metadata() -> dict[str, Any]:
    return {
        "car_name": "",
        "track_name": "",
        "driver_name": "",
        "recorded_at": "",
        "lap_time": None,
    }


def _extract_header_metadata(content: str) -> dict[str, Any]:
    metadata = _empty_metadata()
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
            if key in aliases:
                metadata[target] = value
                break

    lap_time = metadata.get("lap_time")
    if isinstance(lap_time, str):
        metadata["lap_time"] = _parse_lap_time_to_ms(lap_time)
    return metadata


def _pick_candidate_subset(filename: str, candidates: list[str], limit: int = 40) -> list[str]:
    if not candidates:
        return []

    normalized_filename = _normalize_key(os.path.splitext(os.path.basename(filename))[0])
    scored: list[tuple[int, str]] = []
    for candidate in candidates:
        normalized_candidate = _normalize_key(candidate)
        score = 0
        if normalized_candidate and normalized_candidate in normalized_filename:
            score += 8
        if normalized_filename and normalized_filename in normalized_candidate:
            score += 4
        score += len(set(re.findall(r"[a-z0-9]+", normalized_candidate)) & set(re.findall(r"[a-z0-9]+", normalized_filename)))
        if score > 0:
            scored.append((score, candidate))

    close = get_close_matches(normalized_filename, [_normalize_key(c) for c in candidates], n=limit, cutoff=0.35)
    close_originals = [candidate for candidate in candidates if _normalize_key(candidate) in close]
    ordered = [candidate for _, candidate in sorted(scored, key=lambda item: (-item[0], item[1]))]
    merged: list[str] = []
    for candidate in ordered + close_originals + candidates[:limit]:
        if candidate not in merged:
            merged.append(candidate)
        if len(merged) >= limit:
            break
    return merged


def _coerce_llm_metadata(raw: dict[str, Any] | None, car_candidates: list[str], track_candidates: list[str]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return _empty_metadata()

    def match_candidate(value: Any, candidates: list[str]) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        if text in candidates:
            return text
        lookup = {_normalize_key(candidate): candidate for candidate in candidates}
        normalized = _normalize_key(text)
        if normalized in lookup:
            return lookup[normalized]
        close = get_close_matches(normalized, list(lookup.keys()), n=1, cutoff=0.4)
        return lookup[close[0]] if close else text

    lap_time = raw.get("lap_time")
    if isinstance(lap_time, (int, float)):
        normalized_lap_time = float(lap_time)
    elif isinstance(lap_time, str):
        normalized_lap_time = _parse_lap_time_to_ms(lap_time)
    else:
        normalized_lap_time = None

    return {
        "car_name": match_candidate(raw.get("car_name"), car_candidates),
        "track_name": match_candidate(raw.get("track_name"), track_candidates),
        "driver_name": str(raw.get("driver_name") or "").strip(),
        "recorded_at": "",
        "lap_time": normalized_lap_time,
    }


async def _extract_filename_metadata_with_llm(
    filename: str,
    *,
    car_candidates: list[str],
    track_candidates: list[str],
    claude_api_key: str = "",
    gemini_api_key: str = "",
) -> dict[str, Any]:
    try:
        candidate_cars = _pick_candidate_subset(filename, car_candidates)
        candidate_tracks = _pick_candidate_subset(filename, track_candidates)
        if not candidate_cars and not candidate_tracks:
            return _empty_metadata()

        prompt = (
            "Extract metadata from this telemetry CSV filename.\n"
            f"Filename: {filename}\n\n"
            "Return strict JSON with exactly these keys:\n"
            '{"driver_name": string|null, "car_name": string|null, "track_name": string|null, "lap_time": string|number|null}\n\n'
            "Rules:\n"
            "- car_name must be the closest exact match from the provided car candidates, or null if unsure.\n"
            "- track_name must be the closest exact match from the provided track candidates, or null if unsure.\n"
            "- driver_name should be the likely human driver name if present in the filename, else null.\n"
            "- lap_time should be the lap time found in the filename, preserving M:SS.mmm style when possible, else null.\n"
            "- Do not invent values.\n\n"
            f"Car candidates: {json.dumps(candidate_cars)}\n"
            f"Track candidates: {json.dumps(candidate_tracks)}"
        )

        effective_claude_key = claude_api_key.strip() if claude_api_key else settings.CLAUDE_API_KEY
        if effective_claude_key:
            import anthropic

            client = anthropic.AsyncAnthropic(api_key=effective_claude_key)
            response = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=300,
                temperature=0,
                messages=[{"role": "user", "content": prompt}],
            )
            text = "".join(
                block.text for block in response.content if getattr(block, "type", None) == "text"
            ).strip()
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
            return _coerce_llm_metadata(json.loads(text), candidate_cars, candidate_tracks)

        effective_gemini_key = gemini_api_key.strip() if gemini_api_key else settings.GEMINI_API_KEY
        if effective_gemini_key:
            from google import genai

            client = genai.Client(api_key=effective_gemini_key)
            response = await client.aio.models.generate_content(
                model="gemini-2.5-pro",
                contents=prompt,
            )
            text = (response.text or "").strip()
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
            return _coerce_llm_metadata(json.loads(text), candidate_cars, candidate_tracks)
    except Exception:
        return _empty_metadata()

    return _empty_metadata()


def extract_upload_metadata(filename: str, content: str) -> dict[str, Any]:
    metadata = _parse_filename_metadata(filename)
    header_metadata = _extract_header_metadata(content)
    for key, value in header_metadata.items():
        if value not in (None, "", []):
            metadata[key] = value
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


async def inspect_upload_with_llm(
    filename: str,
    content: str,
    *,
    car_candidates: list[str],
    track_candidates: list[str],
    claude_api_key: str = "",
    gemini_api_key: str = "",
) -> dict[str, Any]:
    inspection = inspect_upload(filename, content)
    header_metadata = _extract_header_metadata(content)
    llm_metadata = await _extract_filename_metadata_with_llm(
        filename,
        car_candidates=car_candidates,
        track_candidates=track_candidates,
        claude_api_key=claude_api_key,
        gemini_api_key=gemini_api_key,
    )

    metadata = dict(inspection.get("metadata") or {})
    for key in ("driver_name", "car_name", "track_name", "lap_time"):
        if header_metadata.get(key) not in (None, "", []):
            continue
        value = llm_metadata.get(key)
        if value not in (None, "", []):
            metadata[key] = value

    inspection["metadata"] = metadata
    return inspection
