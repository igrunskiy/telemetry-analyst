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
_PROMPT_TEMPLATES_DIR = Path(__file__).parent / "prompt_templates"

_ANALYSIS_PROMPT_TEMPLATE = (_PROMPT_TEMPLATES_DIR / "analysis_request.md").read_text(encoding="utf-8")

# Backward-compat constant (tests / other modules that import SYSTEM_PROMPT directly)
SYSTEM_PROMPT = resolve_prompt(None, "claude")


def get_system_prompt(name: str | None = None) -> str:
    """Return the system prompt for the given named version (or Claude's default)."""
    return resolve_prompt(name, "claude")


def _corner_ref(corner: dict[str, Any] | None) -> str:
    if not corner:
        return "Straight"
    label = str(corner.get("label") or "").strip()
    if label:
        return label
    corner_num = corner.get("corner_num")
    return f"T{corner_num}" if corner_num else "Straight"


def _corner_ref_from_num(corner_num: int | None, corners: list[dict[str, Any]] | None) -> str:
    if corner_num is None:
        return "Straight"
    for corner in corners or []:
        if corner.get("corner_num") == corner_num:
            return _corner_ref(corner)
    return f"T{corner_num}"


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
        corner_ref = _corner_ref(c)

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

        rows.append(f"| {corner_ref} | {d_apex:.0f}m | {u_min} | {r_min} | {spd_delta} | {brake_str} | {throttle_str} |")

    header = (
        "| Corner | Apex dist | User min spd (km/h) | Ref min spd (km/h) | Δ spd | Braking | Throttle |\n"
        "|--------|-----------|--------------------|--------------------|-------|---------|----------|\n"
    )
    return header + "\n".join(rows)

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
        corner_ref = _corner_ref(c)

        u_gears = [int(round(v)) for v, d in zip(user_gear, dist_grid) if d is not None and abs(d - d_apex) <= 30 and v is not None]
        r_gears = [int(round(v)) for v, d in zip(ref_gear, dist_grid) if d is not None and abs(d - d_apex) <= 30 and v is not None] if ref_gear else []

        u_apex_gear = max(set(u_gears), key=u_gears.count) if u_gears else None
        r_apex_gear = max(set(r_gears), key=r_gears.count) if r_gears else None

        u_str = str(u_apex_gear) if u_apex_gear is not None else "—"
        r_str = str(r_apex_gear) if r_apex_gear is not None else "—"
        diff = ""
        if u_apex_gear is not None and r_apex_gear is not None and u_apex_gear != r_apex_gear:
            diff = f" ⚠ {u_apex_gear - r_apex_gear:+d}"

        rows.append(f"| {corner_ref} | {d_apex:.0f}m | {u_str} | {r_str} |{diff} |")

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
            _corner_ref(c)
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


def _format_conditions_for_prompt(conditions: dict[str, Any] | None) -> str:
    if not conditions:
        return "No conditions recorded"

    parts: list[str] = []
    if conditions.get("summary"):
        parts.append(str(conditions["summary"]))
    if conditions.get("weather"):
        parts.append(f"weather: {conditions['weather']}")
    if conditions.get("track_state"):
        parts.append(f"track: {conditions['track_state']}")
    if conditions.get("air_temp_c") is not None:
        parts.append(f"air {float(conditions['air_temp_c']):.1f}C")
    if conditions.get("track_temp_c") is not None:
        parts.append(f"track temp {float(conditions['track_temp_c']):.1f}C")
    if conditions.get("humidity_pct") is not None:
        parts.append(f"humidity {float(conditions['humidity_pct']):.0f}%")
    if conditions.get("wind_kph") is not None:
        wind = f"wind {float(conditions['wind_kph']):.1f} kph"
        if conditions.get("wind_direction"):
            wind += f" {conditions['wind_direction']}"
        parts.append(wind)
    elif conditions.get("wind_direction"):
        parts.append(f"wind {conditions['wind_direction']}")
    if conditions.get("time_of_day"):
        parts.append(f"time: {conditions['time_of_day']}")
    return "; ".join(parts) if parts else "No conditions recorded"


def _build_lap_conditions_table(laps_metadata: list[dict[str, Any]] | None) -> str:
    if not laps_metadata:
        return "No lap conditions metadata available."

    rows = []
    for lap in laps_metadata:
        role = "User" if lap.get("role") == "user" else "Reference"
        driver = str(lap.get("driver_name") or "Unknown").strip() or "Unknown"
        conditions = _format_conditions_for_prompt(lap.get("conditions"))
        rows.append(f"| {role} | {driver} | {conditions} |")

    header = "| Role | Driver | Conditions |\n|------|--------|------------|\n"
    return header + "\n".join(rows)


def _build_corner_names_table(processed: dict) -> str:
    corners = processed.get("corners", [])
    if not corners:
        return "No corner names available."

    rows = []
    for corner in corners[:20]:
        corner_num = corner.get("corner_num")
        corner_ref = _corner_ref(corner)
        rows.append(
            f"| T{corner_num} | {corner_ref} | {corner['dist_apex']:.0f}m |"
        )

    header = "| Turn | Corner name | Apex dist |\n|------|-------------|-----------|\n"
    return header + "\n".join(rows)


def _build_solo_prompt(
    processed: dict,
    weak_zones: list[dict],
    car_name: str,
    track_name: str,
    laps_metadata: list[dict[str, Any]] | None = None,
) -> str:
    """Construct the analysis prompt for solo (own-laps) mode."""

    if weak_zones:
        table_rows = []
        for z in weak_zones[:15]:
            corner = _corner_ref_from_num(z.get("corner_num"), processed.get("corners", []))
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
        f"{_corner_ref(c)} @ {c['dist_apex']:.0f}m (min {c['min_speed']:.0f} km/h)"
        for c in corners[:12]
    )

    corner_names_table = _build_corner_names_table(processed)
    corner_table = _build_corner_table(processed, weak_zones)
    sector_table = _build_sector_table(processed)
    gear_table = _build_gear_table(processed)
    sector_corner_map = _build_sector_corner_map(processed)
    lap_conditions = _build_lap_conditions_table(laps_metadata)

    return _ANALYSIS_PROMPT_TEMPLATE.format_map({
        "title": "Solo Lap Analysis Request",
        "car_name": car_name,
        "track_name": track_name,
        "context_block": (
            '**Context:** These are all laps from the SAME driver. The "best lap" is compared '
            'against the point-by-point **median** of the driver\'s other laps to find consistency '
            'patterns and recurring mistakes. There is no external benchmark — focus entirely on '
            'the driver\'s own variance and recurring weak spots. Use the word "median" (not '
            '"average") when referring to the reference. When lap conditions differ, account for '
            'those differences and avoid over-attributing losses that are plausibly explained by conditions.'
        ),
        "lap_conditions_block": lap_conditions,
        "corner_summary": corner_summary or "No corners detected.",
        "corner_names_table": corner_names_table,
        "corner_table_heading": "best lap vs. driver's other laps",
        "corner_table": corner_table,
        "sector_table": sector_table,
        "gear_table": gear_table,
        "sector_corner_map": sector_corner_map,
        "weak_section_title": "Variance Zones (corners where the driver loses time on non-best laps)",
        "weak_table": weak_table,
        "strengths_section": "",
        "task_block": (
            "Analyse these laps and identify the driver's own patterns, inconsistencies, and areas "
            'where they could be more consistent or improve their technique. Do NOT mention '
            '"reference lap" or "reference driver" — these are all the same driver\'s laps. '
            "Use the lap conditions metadata as context when deciding whether a gap looks driver-caused "
            "versus condition-influenced."
        ),
        "summary_schema": "3-5 sentence overall assessment of the driver's consistency and patterns",
        "description_schema": "detailed explanation of the inconsistency or pattern and its impact",
        "technique_schema": "specific actionable technique advice for achieving consistency here",
        "telemetry_evidence_schema": "what the telemetry numbers specifically show about the variance",
        "strengths_schema": '["area where the driver is consistent lap-to-lap", "another consistent strength"]',
        "sector_notes_schema": '["note about sector 1 consistency", "note about sector 2", "note about sector 3"]',
        "braking_points_comment": "1-2 sentence assessment of braking point consistency lap-to-lap",
        "brake_application_comment": "1-2 sentence assessment of brake pressure consistency, trail braking repeatability",
        "throttle_pickup_comment": "1-2 sentence assessment of throttle pickup point consistency and application smoothness",
        "steering_comment": "1-2 sentence assessment of steering input consistency and correction frequency across laps",
        "sector_braking_points_comment": "sector 1 braking point lap-to-lap consistency based on corners in this sector",
        "sector_brake_application_comment": "sector 1 brake pressure repeatability",
        "sector_throttle_pickup_comment": "sector 1 throttle pickup consistency",
        "sector_steering_comment": "sector 1 steering consistency across laps",
        "score_meaning": "Score meaning: 0 = very inconsistent, 50 = moderate lap-to-lap variance, 75 = good consistency, 90+ = very consistent.",
        "score_guidance": (
            "Base scores on actual lap-to-lap variance shown in the data — braking points on "
            "variance in brake zone distances, brake application on pressure trace repeatability, "
            "throttle pickup on variation in pickup point distances, steering on mid-corner speed "
            "stability.\n"
        ),
        "sector_score_focus": "consistency areas",
    })


def _build_user_prompt(
    processed: dict,
    weak_zones: list[dict],
    car_name: str,
    track_name: str,
    laps_metadata: list[dict[str, Any]] | None = None,
) -> str:
    """Construct the analysis prompt with telemetry context."""
    corners = processed.get("corners", [])

    # Summarise weak zones in a markdown table
    if weak_zones:
        table_rows = []
        for z in weak_zones[:15]:  # cap to top 15
            corner = _corner_ref_from_num(z.get("corner_num"), corners)
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

    strengths: list[str] = []
    for corner in corners:
        region_speed = [
            v
            for v, d in zip(speed_delta, dist_grid)
            if corner["dist_start"] <= d <= corner["dist_end"] and v is not None
        ]
        if region_speed:
            avg_delta = sum(region_speed) / len(region_speed)
            if avg_delta < -1.5:  # user faster by >1.5 km/h on average
                strengths.append(
                    f"{_corner_ref(corner)} (avg {abs(avg_delta):.1f} km/h faster than reference)"
                )
        if len(strengths) >= 3:
            break

    if not strengths:
        strengths = ["Consistent lap pacing", "Smooth brake application (minimal lock-up)"]

    strength_bullets = "\n".join(f"- {s}" for s in strengths[:3])

    # Corner summary
    corner_summary = ", ".join(
        f"{_corner_ref(c)} @ {c['dist_apex']:.0f}m (min {c['min_speed']:.0f} km/h)"
        for c in corners[:12]
    )

    corner_names_table = _build_corner_names_table(processed)
    corner_table = _build_corner_table(processed, weak_zones)
    sector_table = _build_sector_table(processed)
    gear_table = _build_gear_table(processed)
    sector_corner_map = _build_sector_corner_map(processed)
    lap_conditions = _build_lap_conditions_table(laps_metadata)

    strengths_section = "### Strongest Sectors (user faster than reference)\n" + strength_bullets

    return _ANALYSIS_PROMPT_TEMPLATE.format_map({
        "title": "Telemetry Analysis Request",
        "car_name": car_name,
        "track_name": track_name,
        "context_block": (
            "Use lap conditions as supporting context when interpreting pace differences. "
            "If conditions differ materially between laps, note that and be careful not to frame every gap as pure driver execution."
        ),
        "lap_conditions_block": lap_conditions,
        "corner_summary": corner_summary or "No corners detected.",
        "corner_names_table": corner_names_table,
        "corner_table_heading": "user vs. reference",
        "corner_table": corner_table,
        "sector_table": sector_table,
        "gear_table": gear_table,
        "sector_corner_map": sector_corner_map,
        "weak_section_title": "Weak Zones (sorted by severity)",
        "weak_table": weak_table,
        "strengths_section": strengths_section,
        "task_block": (
            "Analyse this telemetry data and provide specific, actionable coaching feedback.\n"
            "The driver wants to close the gap to the reference lap. Consider the lap conditions metadata when separating likely driver losses from likely environmental differences."
        ),
        "summary_schema": "2-3 sentence overall assessment of the lap",
        "description_schema": "detailed explanation of the problem and its impact",
        "technique_schema": "specific actionable technique advice for this corner/zone",
        "telemetry_evidence_schema": "what the telemetry numbers specifically show",
        "strengths_schema": '["strength 1", "strength 2"]',
        "sector_notes_schema": '["note about sector 1", "note about sector 2", "note about sector 3"]',
        "braking_points_comment": "1-2 sentence assessment of braking point consistency and accuracy across corners",
        "brake_application_comment": "1-2 sentence assessment of brake pressure modulation, threshold braking, and trail braking into corners",
        "throttle_pickup_comment": "1-2 sentence assessment of throttle application timing and progressiveness on corner exits",
        "steering_comment": "1-2 sentence assessment of steering smoothness, correction frequency, and line accuracy",
        "sector_braking_points_comment": "sector 1 specific braking assessment based on corners in this sector",
        "sector_brake_application_comment": "sector 1 brake pressure and trail braking",
        "sector_throttle_pickup_comment": "sector 1 throttle timing and progressiveness",
        "sector_steering_comment": "sector 1 steering smoothness and line accuracy",
        "score_meaning": "Score meaning: 0 = very poor, 50 = average amateur, 75 = competent, 90+ = excellent.",
        "score_guidance": (
            "Base scores on the telemetry evidence — braking points on brake zone distances vs "
            "reference, brake application & abs on pressure trace shape, throttle pickup on "
            "throttle pickup distance vs reference, steering on mid-corner speed stability and "
            "correction events.\n"
        ),
        "sector_score_focus": "technique areas",
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
    laps_metadata: list[dict[str, Any]] | None = None,
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
        user_prompt = _build_solo_prompt(processed, weak_zones, car_name, track_name, laps_metadata)
    else:
        user_prompt = _build_user_prompt(processed, weak_zones, car_name, track_name, laps_metadata)

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
