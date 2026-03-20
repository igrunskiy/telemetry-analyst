## Telemetry Analysis Request

**Car:** {car_name}
**Track:** {track_name}

### Corner Map
{corner_summary}

### Per-Corner Telemetry (user vs. reference)
{corner_table}

### Gear Selection at Corner Apexes
{gear_table}

### Sector Times
{sector_table}

### Sector–Corner Map
{sector_corner_map}

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
  "sector_notes": ["note about sector 1", "note about sector 2", "note about sector 3"],
  "driving_scores": {{
    "braking_points": {{
      "score": 75,
      "comment": "1-2 sentence assessment of braking point consistency and accuracy across corners"
    }},
    "brake_application": {{
      "score": 68,
      "comment": "1-2 sentence assessment of brake pressure modulation, threshold braking, and trail braking into corners"
    }},
    "throttle_pickup": {{
      "score": 82,
      "comment": "1-2 sentence assessment of throttle application timing and progressiveness on corner exits"
    }},
    "steering": {{
      "score": 71,
      "comment": "1-2 sentence assessment of steering smoothness, correction frequency, and line accuracy"
    }}
  }},
  "sector_scores": [
    {{
      "sector": 1,
      "driving_scores": {{
        "braking_points": {{"score": 75, "comment": "sector 1 specific braking assessment based on corners in this sector"}},
        "brake_application": {{"score": 68, "comment": "sector 1 brake pressure and trail braking"}},
        "throttle_pickup": {{"score": 82, "comment": "sector 1 throttle timing and progressiveness"}},
        "steering": {{"score": 71, "comment": "sector 1 steering smoothness and line accuracy"}}
      }}
    }}
  ]
}}
```

Score meaning: 0 = very poor, 50 = average amateur, 75 = competent, 90+ = excellent.
Base scores on the telemetry evidence — braking points on brake zone distances vs reference, brake application on pressure trace shape, throttle pickup on throttle pickup distance vs reference, steering on mid-corner speed stability and correction events.
For sector_scores, produce one entry per sector (use the Sector–Corner Map to identify which corners belong to each sector) and score only the technique areas relevant to corners in that sector.

Return ONLY the JSON object. Do not include markdown code fences, explanations, or any other text.
