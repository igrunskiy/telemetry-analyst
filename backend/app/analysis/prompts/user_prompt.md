## Telemetry Analysis Request

**Car:** {car_name}
**Track:** {track_name}

### Corner Map
{corner_summary}

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

Return ONLY the JSON object. Do not include markdown code fences, explanations, or any other text.
