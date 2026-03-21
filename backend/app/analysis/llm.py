"""
LLM-powered telemetry analysis using Anthropic Claude.

Builds a motorsport-expert system prompt and a structured data prompt,
then returns a parsed JSON analysis result.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import anthropic

from app.config import settings
from app.analysis.prompts_manager import resolve_prompt

# Model to use for analysis
CLAUDE_MODEL = "claude-sonnet-4-6"

# ---------------------------------------------------------------------------
# Prompts — loaded from external files at import time
# ---------------------------------------------------------------------------

_PROMPTS_DIR = Path(__file__).parent / "prompts"

_USER_PROMPT_TEMPLATE = (_PROMPTS_DIR / "user_prompt.md").read_text(encoding="utf-8")
_SOLO_PROMPT_TEMPLATE = (_PROMPTS_DIR / "solo_prompt.md").read_text(encoding="utf-8")

# Backward-compat constant (tests / other modules that import SYSTEM_PROMPT directly)
SYSTEM_PROMPT = resolve_prompt(None, "claude")


def get_system_prompt(name: str | None = None) -> str:
    """Return the system prompt for the given named version (or Claude's default)."""
    return resolve_prompt(name, "claude")


def _build_corner_table(processed: dict, weak_zones: list[dict]) -> str:
    """Build a per-corner telemetry data table for the LLM prompt."""
    corners = processed.get("corners", [])
    user_lap = processed.get("user_lap", {})
    ref_laps = processed.get("reference_laps", [])
    if not corners:
        return "No corner data available."

    user_speed = user_lap.get("speed", [])
    ref_speed = ref_laps[0].get("speed", []) if ref_laps else []
    dist_grid = user_lap.get("dist", [])

    zone_by_corner: dict[int, list] = {}
    for z in weak_zones:
        cn = z.get("corner_num")
        if cn is not None:
            zone_by_corner.setdefault(cn, []).append(z)

    rows = []
    for c in corners[:15]:
        c_num = c["corner_num"]
        d_apex = c["dist_apex"]

        u_apex_speeds = [v for v, d in zip(user_speed, dist_grid) if d is not None and abs(d - d_apex) <= 50 and v is not None]
        r_apex_speeds = [v for v, d in zip(ref_speed, dist_grid) if d is not None and abs(d - d_apex) <= 50 and v is not None]

        u_min = f"{min(u_apex_speeds):.0f}" if u_apex_speeds else "—"
        r_min = f"{min(r_apex_speeds):.0f}" if r_apex_speeds else "—"
        spd_delta = f"{min(r_apex_speeds) - min(u_apex_speeds):+.0f}" if u_apex_speeds and r_apex_speeds else "—"

        zones = zone_by_corner.get(c_num, [])
        brake_z = next((z for z in zones if z["zone_type"] == "braking_point"), None)
        throttle_z = next((z for z in zones if z["zone_type"] == "throttle_pickup"), None)
        brake_str = f"{abs(brake_z['delta']):.0f}m early" if brake_z else "ok"
        throttle_str = f"{abs(throttle_z['delta']):.0f}m late" if throttle_z else "ok"

        rows.append(f"| T{c_num} | {d_apex:.0f}m | {u_min} | {r_min} | {spd_delta} | {brake_str} | {throttle_str} |")

    header = (
        "| Corner | Apex dist | User min spd (km/h) | Ref min spd (km/h) | Δ spd | Braking | Throttle |\n"
        "|--------|-----------|--------------------|--------------------|-------|---------|----------|\n"
    )
    return header + "\n".join(rows)


def _build_sector_corner_map(processed: dict) -> str:
    """Build a mapping of which corners belong to each sector."""
    sectors = processed.get("sectors", [])
    corners = processed.get("corners", [])
    track_length = processed.get("track_length_m", 3000.0)
    if not sectors or not corners:
        return ""

    n = len(sectors)
    sector_size = track_length / n
    rows = []
    for s in sectors:
        s_num = s["sector"]
        s_start = (s_num - 1) * sector_size
        s_end = s_num * sector_size
        sector_corners = [
            f"T{c['corner_num']} ({c['dist_apex']:.0f}m)"
            for c in corners
            if s_start <= c["dist_apex"] < s_end
        ]
        rows.append(f"Sector {s_num} ({s_start:.0f}–{s_end:.0f}m): {', '.join(sector_corners) or 'no corners'}")
    return "\n".join(rows)


def _build_gear_table(processed: dict) -> str:
    """Build a per-corner gear table for the LLM prompt."""
    corners = processed.get("corners", [])
    user_lap = processed.get("user_lap", {})
    ref_laps = processed.get("reference_laps", [])
    if not corners:
        return "No corner data available."

    user_gear = user_lap.get("gear", [])
    ref_gear = ref_laps[0].get("gear", []) if ref_laps else []
    dist_grid = user_lap.get("dist", [])

    if not user_gear:
        return "No gear data available."

    rows = []
    for c in corners[:15]:
        d_apex = c["dist_apex"]
        c_num = c["corner_num"]

        u_gears = [int(round(v)) for v, d in zip(user_gear, dist_grid) if d is not None and abs(d - d_apex) <= 30 and v is not None]
        r_gears = [int(round(v)) for v, d in zip(ref_gear, dist_grid) if d is not None and abs(d - d_apex) <= 30 and v is not None] if ref_gear else []

        u_apex_gear = max(set(u_gears), key=u_gears.count) if u_gears else None
        r_apex_gear = max(set(r_gears), key=r_gears.count) if r_gears else None

        u_str = str(u_apex_gear) if u_apex_gear is not None else "—"
        r_str = str(r_apex_gear) if r_apex_gear is not None else "—"
        diff = ""
        if u_apex_gear is not None and r_apex_gear is not None and u_apex_gear != r_apex_gear:
            diff = f" ⚠ {u_apex_gear - r_apex_gear:+d}"

        rows.append(f"| T{c_num} | {d_apex:.0f}m | {u_str} | {r_str} |{diff} |")

    header = (
        "| Corner | Apex dist | User gear | Ref gear | Note |\n"
        "|--------|-----------|-----------|----------|------|\n"
    )
    return header + "\n".join(rows)


def _build_sector_corner_map(processed: dict) -> str:
    """Build a table mapping sectors to the corners they contain."""
    corners = processed.get("corners", [])
    sectors = processed.get("sectors", [])
    if not corners or not sectors:
        return "No sector–corner mapping available."

    track_length_m = float(processed.get("track_length_m", 3000.0))
    n_sectors = len(sectors)
    sector_size_m = track_length_m / n_sectors

    rows = []
    for s_idx in range(n_sectors):
        s_start = s_idx * sector_size_m
        s_end = (s_idx + 1) * sector_size_m
        in_sector = [
            f"T{c['corner_num']}"
            for c in corners
            if s_start <= c["dist_apex"] < s_end
        ]
        corners_str = ", ".join(in_sector) if in_sector else "—"
        rows.append(f"| S{s_idx + 1} | {corners_str} |")

    header = "| Sector | Corners |\n|--------|--------|\n"
    return header + "\n".join(rows)


def _build_sector_table(processed: dict) -> str:
    """Build a sector time comparison table for the LLM prompt."""
    sectors = processed.get("sectors", [])
    if not sectors:
        return "No sector data available."

    rows = []
    for s in sectors:
        u_s = s["user_time_ms"] / 1000
        r_s = s["ref_time_ms"] / 1000
        d_s = s["delta_ms"] / 1000
        sign = "+" if d_s >= 0 else ""
        rows.append(f"| S{s['sector']} | {u_s:.3f}s | {r_s:.3f}s | {sign}{d_s:.3f}s |")

    header = "| Sector | Your time | Ref time | Delta |\n|--------|-----------|----------|-------|\n"
    return header + "\n".join(rows)


def _build_solo_prompt(
    processed: dict,
    weak_zones: list[dict],
    car_name: str,
    track_name: str,
) -> str:
    """Construct the analysis prompt for solo (own-laps) mode."""

    if weak_zones:
        table_rows = []
        for z in weak_zones[:15]:
            corner = f"T{z['corner_num']}" if z.get("corner_num") else "Straight"
            table_rows.append(
                f"| {corner} | {z['zone_type']} | {z['metric']} "
                f"| Best: {z['ref_value']} vs Other: {z['user_value']} "
                f"| Δ {z['delta']} | {z['severity']} |"
            )
        weak_table = (
            "| Corner | Type | Metric | Values | Delta | Severity |\n"
            "|--------|------|--------|--------|-------|----------|\n"
            + "\n".join(table_rows)
        )
    else:
        weak_table = "No significant variance detected — very consistent across laps."

    corners = processed.get("corners", [])
    corner_summary = ", ".join(
        f"T{c['corner_num']} @ {c['dist_apex']:.0f}m (min {c['min_speed']:.0f} km/h)"
        for c in corners[:12]
    )

    corner_table = _build_corner_table(processed, weak_zones)
    sector_table = _build_sector_table(processed)
    gear_table = _build_gear_table(processed)
    sector_corner_map = _build_sector_corner_map(processed)

    return _SOLO_PROMPT_TEMPLATE.format_map({
        "car_name": car_name,
        "track_name": track_name,
        "corner_summary": corner_summary or "No corners detected.",
        "corner_table": corner_table,
        "sector_table": sector_table,
        "gear_table": gear_table,
        "sector_corner_map": sector_corner_map,
        "weak_table": weak_table,
    })


def _build_user_prompt(
    processed: dict,
    weak_zones: list[dict],
    car_name: str,
    track_name: str,
) -> str:
    """Construct the analysis prompt with telemetry context."""

    # Summarise weak zones in a markdown table
    if weak_zones:
        table_rows = []
        for z in weak_zones[:15]:  # cap to top 15
            corner = f"T{z['corner_num']}" if z.get("corner_num") else "Straight"
            table_rows.append(
                f"| {corner} | {z['zone_type']} | {z['metric']} "
                f"| User: {z['user_value']} vs Ref: {z['ref_value']} "
                f"| Δ {z['delta']} | {z['severity']} |"
            )
        weak_table = (
            "| Corner | Type | Metric | Values | Delta | Severity |\n"
            "|--------|------|--------|--------|-------|----------|\n"
            + "\n".join(table_rows)
        )
    else:
        weak_table = "No significant weak zones detected — driver is very close to reference."

    # Find top 3 strengths (zones where user is faster than reference)
    delta = processed.get("delta", {})
    speed_delta = delta.get("speed_delta", [])
    dist_grid = delta.get("dist", [])
    corners = processed.get("corners", [])

    strengths: list[str] = []
    for corner in corners:
        c_num = corner["corner_num"]
        region_speed = [
            v
            for v, d in zip(speed_delta, dist_grid)
            if corner["dist_start"] <= d <= corner["dist_end"] and v is not None
        ]
        if region_speed:
            avg_delta = sum(region_speed) / len(region_speed)
            if avg_delta < -1.5:  # user faster by >1.5 km/h on average
                strengths.append(
                    f"T{c_num} (avg {abs(avg_delta):.1f} km/h faster than reference)"
                )
        if len(strengths) >= 3:
            break

    if not strengths:
        strengths = ["Consistent lap pacing", "Smooth brake application (minimal lock-up)"]

    strength_bullets = "\n".join(f"- {s}" for s in strengths[:3])

    # Corner summary
    corner_summary = ", ".join(
        f"T{c['corner_num']} @ {c['dist_apex']:.0f}m (min {c['min_speed']:.0f} km/h)"
        for c in corners[:12]
    )

    corner_table = _build_corner_table(processed, weak_zones)
    sector_table = _build_sector_table(processed)
    gear_table = _build_gear_table(processed)
    sector_corner_map = _build_sector_corner_map(processed)

    return _USER_PROMPT_TEMPLATE.format_map({
        "car_name": car_name,
        "track_name": track_name,
        "corner_summary": corner_summary or "No corners detected.",
        "corner_table": corner_table,
        "sector_table": sector_table,
        "gear_table": gear_table,
        "sector_corner_map": sector_corner_map,
        "weak_table": weak_table,
        "strength_bullets": strength_bullets,
    })


# ---------------------------------------------------------------------------
# Main analysis function
# ---------------------------------------------------------------------------

async def analyze_with_claude(
    processed: dict,
    weak_zones: list[dict],
    car_name: str,
    track_name: str,
    claude_api_key: str,
    analysis_mode: str = "vs_reference",
    prompt_version: str | None = None,
) -> dict:
    """
    Call Claude to produce a structured coaching analysis.

    Parameters
    ----------
    processed : dict
        Output of TelemetryProcessor.process_laps()
    weak_zones : list[dict]
        Output of detect_weak_zones()
    car_name : str
    track_name : str
    claude_api_key : str
        User-supplied key; falls back to settings.CLAUDE_API_KEY if empty.

    Returns
    -------
    dict
        Parsed JSON analysis result matching the schema above.
    """
    effective_key = claude_api_key.strip() if claude_api_key else ""
    if not effective_key:
        effective_key = settings.CLAUDE_API_KEY

    if not effective_key:
        raise ValueError(
            "No Claude API key available. Please add your Anthropic API key in profile settings."
        )

    client = anthropic.AsyncAnthropic(api_key=effective_key)

    if analysis_mode == "solo":
        user_prompt = _build_solo_prompt(processed, weak_zones, car_name, track_name)
    else:
        user_prompt = _build_user_prompt(processed, weak_zones, car_name, track_name)

    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=settings.CLAUDE_MAX_TOKENS,
        system=get_system_prompt(prompt_version),
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw_text = message.content[0].text.strip()

    # Strip markdown fences if Claude added them despite instructions
    raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
    raw_text = re.sub(r"\s*```$", "", raw_text.strip())

    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        # Attempt to extract a JSON block if there's surrounding text
        json_match = re.search(r"\{[\s\S]*\}", raw_text)
        if json_match:
            try:
                result = json.loads(json_match.group())
            except json.JSONDecodeError:
                raise ValueError(
                    f"Claude returned invalid JSON. Raw response: {raw_text[:500]}"
                ) from exc
        else:
            raise ValueError(
                f"Claude returned invalid JSON. Raw response: {raw_text[:500]}"
            ) from exc

    return result
