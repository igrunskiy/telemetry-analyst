## {title}

**Car:** {car_name}
**Track:** {track_name}

{context_block}

### Lap Conditions
{lap_conditions_block}

### Corner Map
{corner_summary}

### Corner Names
{corner_names_table}

### Per-Corner Telemetry ({corner_table_heading})
{corner_table}

### Gear Selection at Corner Apexes
{gear_table}

### Sector Times
{sector_table}

### Sector–Corner Map
{sector_corner_map}

### {weak_section_title}
{weak_table}

{strengths_section}

### Task
{task_block}

Corner naming requirement:
- Use the real track corner names from the `Corner Names` section whenever they are available.
- In all natural-language JSON fields such as `summary`, `title`, `description`, `technique`, `telemetry_evidence`, `strengths`, and `sector_notes`, prefer names like `(T1) Andretti Hairpin` or ` (T2) Rainey Curve` over plain `T1` or `T2`.
- If a corner has both a turn number and a real name, you may write them together on first mention, for example `(T1) Andretti Hairpin`, then use the real name after that.
- Keep `corner_refs` numeric only. Do not put names inside `corner_refs`.
- Only fall back to plain `T1`, `T2`, etc. if no real corner name is available in the provided data.

Return your analysis as a valid JSON object matching EXACTLY this schema:
```json
{{
  "summary": "{summary_schema}",
  "estimated_time_gain_seconds": 1.8,
  "improvement_areas": [
    {{
      "rank": 1,
      "title": "short descriptive title",
      "corner_refs": [3, 4],
      "issue_type": "braking_point|throttle_pickup|racing_line|corner_speed|exit_speed",
      "severity": "high|medium|low",
      "time_loss_ms": 450,
      "description": "{description_schema}",
      "technique": "{technique_schema}",
      "telemetry_evidence": "{telemetry_evidence_schema}"
    }}
  ],
  "strengths": {strengths_schema},
  "sector_notes": {sector_notes_schema},
  "driving_scores": {{
    "braking_points": {{
      "score": 75,
      "comment": "{braking_points_comment}"
    }},
    "brake_application": {{
      "score": 68,
      "comment": "{brake_application_comment}"
    }},
    "throttle_pickup": {{
      "score": 82,
      "comment": "{throttle_pickup_comment}"
    }},
    "steering": {{
      "score": 71,
      "comment": "{steering_comment}"
    }}
  }},
  "sector_scores": [
    {{
      "sector": 1,
      "driving_scores": {{
        "braking_points": {{"score": 75, "comment": "{sector_braking_points_comment}"}},
        "brake_application": {{"score": 68, "comment": "{sector_brake_application_comment}"}},
        "throttle_pickup": {{"score": 82, "comment": "{sector_throttle_pickup_comment}"}},
        "steering": {{"score": 71, "comment": "{sector_steering_comment}"}}
      }}
    }}
  ]
}}
```

{score_meaning}
{score_guidance}
For sector_scores, produce one entry per sector (use the Sector–Corner Map to identify which corners belong to each sector) and score only the {sector_score_focus} relevant to corners in that sector.

Return ONLY the JSON object. Do not include markdown code fences, explanations, or any other text.
