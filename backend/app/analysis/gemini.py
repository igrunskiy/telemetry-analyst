"""
LLM-powered telemetry analysis using Google Gemini.

Reuses the same prompts as the Claude implementation and returns
an identical result dict.
"""

from __future__ import annotations

import json
import logging
import re
import time

from google import genai
from google.genai import types

from app.config import settings
from app.analysis.llm import _build_user_prompt, _build_solo_prompt
from app.analysis.prompts_manager import resolve_prompt

GEMINI_MODEL = "gemini-2.5-pro"
logger = logging.getLogger(__name__)


async def analyze_with_gemini(
    processed: dict,
    weak_zones: list[dict],
    car_name: str,
    track_name: str,
    gemini_api_key: str,
    analysis_mode: str = "vs_reference",
    prompt_version: str | None = None,
    laps_metadata: list[dict] | None = None,
) -> dict:
    """
    Call Gemini to produce a structured coaching analysis.
    Returns the same dict shape as analyze_with_claude().
    """
    effective_key = gemini_api_key.strip() if gemini_api_key else settings.GEMINI_API_KEY.strip()

    if not effective_key:
        raise ValueError(
            "No Gemini API key available. Add a personal Google AI API key in Profile or configure a shared GEMINI_API_KEY."
        )

    client = genai.Client(api_key=effective_key)

    if analysis_mode == "solo":
        user_prompt = _build_solo_prompt(processed, weak_zones, car_name, track_name, laps_metadata)
    else:
        user_prompt = _build_user_prompt(processed, weak_zones, car_name, track_name, laps_metadata)
    system_prompt = resolve_prompt(prompt_version, "gemini")
    request_payload_bytes = len(system_prompt.encode("utf-8")) + len(user_prompt.encode("utf-8"))

    started_at = time.perf_counter()
    response = await client.aio.models.generate_content(
        model=GEMINI_MODEL,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            max_output_tokens=settings.GEMINI_MAX_TOKENS,
        ),
    )
    latency_ms = round((time.perf_counter() - started_at) * 1000, 1)

    raw_text = response.text.strip()
    response_bytes = len(raw_text.encode("utf-8"))
    logger.info(
        "LLM gemini model=%s latency_ms=%.1f request_bytes=%d response_bytes=%d prompt_version=%s",
        GEMINI_MODEL,
        latency_ms,
        request_payload_bytes,
        response_bytes,
        prompt_version or "default",
    )

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

    result["_request_payload_bytes"] = request_payload_bytes
    return result
