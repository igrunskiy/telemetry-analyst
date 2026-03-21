"""
LLM-powered telemetry analysis using Google Gemini.

Reuses the same prompts as the Claude implementation and returns
an identical result dict.
"""

from __future__ import annotations

import json
import re

from google import genai
from google.genai import types

from app.config import settings
from app.analysis.llm import _build_user_prompt, _build_solo_prompt
from app.analysis.prompts_manager import resolve_prompt

GEMINI_MODEL = "gemini-2.5-pro"


async def analyze_with_gemini(
    processed: dict,
    weak_zones: list[dict],
    car_name: str,
    track_name: str,
    gemini_api_key: str,
    analysis_mode: str = "vs_reference",
    prompt_version: str | None = None,
) -> dict:
    """
    Call Gemini to produce a structured coaching analysis.
    Returns the same dict shape as analyze_with_claude().
    """
    effective_key = gemini_api_key.strip() if gemini_api_key else ""
    if not effective_key:
        effective_key = settings.GEMINI_API_KEY

    if not effective_key:
        raise ValueError(
            "No Gemini API key available. Please add your Google AI API key in profile settings."
        )

    client = genai.Client(api_key=effective_key)

    if analysis_mode == "solo":
        user_prompt = _build_solo_prompt(processed, weak_zones, car_name, track_name)
    else:
        user_prompt = _build_user_prompt(processed, weak_zones, car_name, track_name)

    response = await client.aio.models.generate_content(
        model=GEMINI_MODEL,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=resolve_prompt(prompt_version, "gemini"),
            max_output_tokens=settings.GEMINI_MAX_TOKENS,
        ),
    )

    raw_text = response.text.strip()

    # Strip markdown fences if present
    raw_text = re.sub(r"^```(?:json)?\s*", "", raw_text)
    raw_text = re.sub(r"\s*```$", "", raw_text.strip())

    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        json_match = re.search(r"\{[\s\S]*\}", raw_text)
        if json_match:
            try:
                result = json.loads(json_match.group())
            except json.JSONDecodeError:
                raise ValueError(
                    f"Gemini returned invalid JSON. Raw response: {raw_text[:500]}"
                ) from exc
        else:
            raise ValueError(
                f"Gemini returned invalid JSON. Raw response: {raw_text[:500]}"
            ) from exc

    return result
