"""
LLM-powered telemetry analysis using Anthropic Claude.

Builds a motorsport-expert system prompt and a structured data prompt,
then returns a parsed JSON analysis result.
"""

from __future__ import annotations

import json
import re
from typing import Any

import anthropic

from app.config import settings

# Model to use for analysis
CLAUDE_MODEL = "claude-sonnet-4-6"

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are an expert motorsport driving coach and data engineer with deep knowledge of:

**Racing Line Theory**
- Geometric apex vs. late apex vs. early apex selection depending on corner type and what follows
- The importance of sacrificing corner entry for a clean, fast exit on long straights
- How track layout (single apex, double apex, chicane) affects the ideal line
- Vision points, reference points, and turn-in markers

**Threshold & Trail Braking**
- Threshold braking: maintaining maximum deceleration right at the limit of adhesion
- Trail braking: progressively releasing brake pressure while turning in to transfer weight and aid rotation
- When trail braking helps (slow, technical corners) vs. when it's risky (high-speed sweepers)
- Left-foot braking and ABS interaction in sim racing

**Throttle Application & Traction Circle**
- The concept of the "traction circle" — combined lateral + longitudinal grip
- Why early throttle application sacrifices corner exit speed (understeer/oversteer)
- Progressive vs. snap throttle techniques depending on car balance
- Minimum speed / throttle pickup point discipline

**Weight Transfer & Car Balance**
- How brake, throttle, and steering inputs shift weight front-to-rear and side-to-side
- Understeer vs. oversteer identification from throttle/steering data
- How to balance a car through a corner using smooth, overlapping inputs

**iRacing-Specific Tips**
- iRacing's tyre model rewards smooth, progressive inputs over aggressive steering corrections
- Force feedback interpretation: understand what the wheel is telling you about grip
- Track surface changes, marbles, and rubber-in areas on various circuits
- The importance of consistent reference points across laps

**Telemetry Interpretation**
- How to read speed traces, throttle overlays, and brake traces
- Identifying where time is lost: late braking, slow corner minimum, late throttle, poor exit
- Understanding sector times and their relationship to lap time
- Delta time: what positive and negative delta means and how to act on it

When given telemetry data, provide coaching that is:
1. Specific and actionable — tell the driver exactly what to change and where
2. Evidence-based — reference the telemetry numbers to justify each point
3. Prioritised — the highest time-gain improvements come first
4. Encouraging — acknowledge strengths before pointing out weaknesses
5. Educational — explain the "why" behind each recommendation

**Data Units (important)**
- All speeds are in **km/h**
- All distances are in **metres** (m)
- All times are in **milliseconds** (ms) unless labelled otherwise
- Positive delta time = user is slower; negative = user is faster

Always return your analysis as a single valid JSON object with no additional text before or after it."""


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

    return f"""## Solo Lap Analysis Request

**Car:** {car_name}
**Track:** {track_name}

**Context:** These are all laps from the SAME driver. The "best lap" is compared against the driver's own other laps to find consistency patterns and recurring mistakes. There is no external benchmark — focus entirely on the driver's own variance and recurring weak spots.

### Corner Map
{corner_summary or "No corners detected."}

### Per-Corner Telemetry (best lap vs. driver's other laps)
{corner_table}

### Sector Times
{sector_table}

### Variance Zones (corners where the driver loses time on non-best laps)
{weak_table}

### Task
Analyse these laps and identify the driver's own patterns, inconsistencies, and areas where they could be more consistent or improve their technique. Do NOT mention "reference lap" or "reference driver" — these are all the same driver's laps.

Return your analysis as a valid JSON object matching EXACTLY this schema:
```json
{{
  "summary": "2-3 sentence overall assessment of the driver's consistency and patterns",
  "estimated_time_gain_seconds": 1.2,
  "improvement_areas": [
    {{
      "rank": 1,
      "title": "short descriptive title",
      "corner_refs": [3, 4],
      "issue_type": "braking_point|throttle_pickup|racing_line|corner_speed|exit_speed",
      "severity": "high|medium|low",
      "time_loss_ms": 450,
      "description": "detailed explanation of the inconsistency or pattern and its impact",
      "technique": "specific actionable technique advice for achieving consistency here",
      "telemetry_evidence": "what the telemetry numbers specifically show about the variance"
    }}
  ],
  "strengths": ["area where the driver is consistent lap-to-lap", "another consistent strength"],
  "sector_notes": ["note about sector 1 consistency", "note about sector 2", "note about sector 3"]
}}
```

Return ONLY the JSON object. Do not include markdown code fences, explanations, or any other text."""


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

    prompt = f"""## Telemetry Analysis Request

**Car:** {car_name}
**Track:** {track_name}

### Corner Map
{corner_summary or "No corners detected."}

### Per-Corner Telemetry (user vs. reference)
{corner_table}

### Sector Times
{sector_table}

### Weak Zones (sorted by severity)
{weak_table}

### Strongest Sectors (user faster than reference)
{strength_bullets}

### Task
Analyse this telemetry data and provide specific, actionable coaching feedback.
The driver wants to close the gap to the reference lap.

Return your analysis as a valid JSON object matching EXACTLY this schema:
```json
{{
  "summary": "2-3 sentence overall assessment of the lap",
  "estimated_time_gain_seconds": 1.8,
  "improvement_areas": [
    {{
      "rank": 1,
      "title": "short descriptive title",
      "corner_refs": [3, 4],
      "issue_type": "braking_point|throttle_pickup|racing_line|corner_speed|exit_speed",
      "severity": "high|medium|low",
      "time_loss_ms": 450,
      "description": "detailed explanation of the problem and its impact",
      "technique": "specific actionable technique advice for this corner/zone",
      "telemetry_evidence": "what the telemetry numbers specifically show"
    }}
  ],
  "strengths": ["strength 1", "strength 2"],
  "sector_notes": ["note about sector 1", "note about sector 2", "note about sector 3"]
}}
```

Return ONLY the JSON object. Do not include markdown code fences, explanations, or any other text."""

    return prompt


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
        max_tokens=6000,
        system=SYSTEM_PROMPT,
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
