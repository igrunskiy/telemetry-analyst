"""
LLM-powered telemetry analysis using OpenAI.

Reuses the same prompts as the Claude implementation and returns
an identical result dict.
"""

from __future__ import annotations

import json
import logging
import re
import time

from app.analysis.llm import _build_solo_prompt, _build_user_prompt
from app.analysis.prompts_manager import resolve_prompt
from app.config import settings

OPENAI_MODEL = "gpt-4.1"
logger = logging.getLogger(__name__)


async def analyze_with_openai(
    processed: dict,
    weak_zones: list[dict],
    car_name: str,
    track_name: str,
    openai_api_key: str,
    analysis_mode: str = "vs_reference",
    prompt_version: str | None = None,
    laps_metadata: list[dict] | None = None,
) -> dict:
    effective_key = openai_api_key.strip() if openai_api_key else settings.OPENAI_API_KEY.strip()

    if not effective_key:
        raise ValueError(
            "No OpenAI API key available. Add a personal OpenAI API key in Profile or configure a shared OPENAI_API_KEY."
        )

    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=effective_key)

    if analysis_mode == "solo":
        user_prompt = _build_solo_prompt(processed, weak_zones, car_name, track_name, laps_metadata)
    else:
        user_prompt = _build_user_prompt(processed, weak_zones, car_name, track_name, laps_metadata)
    system_prompt = resolve_prompt(prompt_version, "openai")
    request_payload_bytes = len(system_prompt.encode("utf-8")) + len(user_prompt.encode("utf-8"))

    started_at = time.perf_counter()
    response = await client.chat.completions.create(
        model=OPENAI_MODEL,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_completion_tokens=settings.OPENAI_MAX_TOKENS,
    )
    latency_ms = round((time.perf_counter() - started_at) * 1000, 1)

    raw_text = (response.choices[0].message.content or "").strip()
    response_bytes = len(raw_text.encode("utf-8"))
    logger.info(
        "LLM openai model=%s latency_ms=%.1f request_bytes=%d response_bytes=%d prompt_version=%s",
        OPENAI_MODEL,
        latency_ms,
        request_payload_bytes,
        response_bytes,
        prompt_version or "default",
    )

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
                    f"OpenAI returned invalid JSON. Raw response: {raw_text[:500]}"
                ) from exc
        else:
            raise ValueError(
                f"OpenAI returned invalid JSON. Raw response: {raw_text[:500]}"
            ) from exc

    result["_request_payload_bytes"] = request_payload_bytes
    return result
