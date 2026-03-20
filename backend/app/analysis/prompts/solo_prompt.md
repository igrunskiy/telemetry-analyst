## Solo Lap Analysis Request

**Car:** {car_name}
**Track:** {track_name}

**Context:** These are all laps from the SAME driver. The "best lap" is compared against the point-by-point **median** of the driver's other laps to find consistency patterns and recurring mistakes. There is no external benchmark — focus entirely on the driver's own variance and recurring weak spots. Use the word "median" (not "average") when referring to the reference.

### Corner Map
{corner_summary}

### Per-Corner Telemetry (best lap vs. driver's other laps)
{corner_table}

### Gear Selection at Corner Apexes
{gear_table}

### Sector Times
{sector_table}

### Sector–Corner Map
{sector_corner_map}

### Variance Zones (corners where the driver loses time on non-best laps)
{weak_table}

### Task
Analyse these laps and identify the driver's own patterns, inconsistencies, and areas where they could be more consistent or improve their technique. Do NOT mention "reference lap" or "reference driver" — these are all the same driver's laps.

Return your analysis as a valid JSON object matching EXACTLY this schema:
```json
{{
  "summary": "3-5 sentence overall assessment of the driver's consistency and patterns",
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
  "sector_notes": ["note about sector 1 consistency", "note about sector 2", "note about sector 3"],
  "driving_scores": {{
    "braking_points": {{
      "score": 75,
      "comment": "1-2 sentence assessment of braking point consistency lap-to-lap"
    }},
    "brake_application": {{
      "score": 68,
      "comment": "1-2 sentence assessment of brake pressure consistency, trail braking repeatability"
    }},
    "throttle_pickup": {{
      "score": 82,
      "comment": "1-2 sentence assessment of throttle pickup point consistency and application smoothness"
    }},
    "steering": {{
      "score": 71,
      "comment": "1-2 sentence assessment of steering input consistency and correction frequency across laps"
    }}
  }},
  "sector_scores": [
    {{
      "sector": 1,
      "driving_scores": {{
        "braking_points": {{"score": 75, "comment": "sector 1 braking point lap-to-lap consistency based on corners in this sector"}},
        "brake_application": {{"score": 68, "comment": "sector 1 brake pressure repeatability"}},
        "throttle_pickup": {{"score": 82, "comment": "sector 1 throttle pickup consistency"}},
        "steering": {{"score": 71, "comment": "sector 1 steering consistency across laps"}}
      }}
    }}
  ]
}}
```

Score meaning: 0 = very inconsistent, 50 = moderate lap-to-lap variance, 75 = good consistency, 90+ = very consistent.
Base scores on actual lap-to-lap variance shown in the data — braking points on variance in brake zone distances, brake application on pressure trace repeatability, throttle pickup on variation in pickup point distances, steering on mid-corner speed stability.
For sector_scores, produce one entry per sector (use the Sector–Corner Map to identify which corners belong to each sector) and score only the consistency areas relevant to corners in that sector.

Return ONLY the JSON object. Do not include markdown code fences, explanations, or any other text.
