from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

import anthropic
from google import genai
from google.genai import types

from app.analysis.gemini import GEMINI_MODEL
from app.analysis.llm import CLAUDE_MODEL
from app.analysis.prompts_manager import resolve_prompt
from app.auth.crypto import decrypt
from app.config import settings
from app.models.analysis import AnalysisResult
from app.models.user import User

logger = logging.getLogger(__name__)

RETROSPECT_SYSTEM_PROMPT = """You are a staff-level LLM quality reviewer for a motorsport telemetry analysis system.

Your job is to perform a retrospective on an existing analysis result.
You will receive:
- the original system prompt used for the analysis
- the original analysis request payload
- the generated report/result
- optional admin feedback, comments, and areas to inspect

Your goals:
1. Understand where the original analysis may have gone wrong or underperformed.
2. Distinguish between prompt issues, missing context, ambiguous inputs, and model reasoning mistakes.
3. Produce a concise retrospective, not a long report.
4. Be specific, technical, and practical.

Return strict JSON only with this shape:
{
  "summary": "short concise paragraph",
  "root_causes": ["up to 4 items"],
  "feedback_alignment": ["up to 4 items"],
  "suggested_prompt_patch": "optional concise block of revised prompt text"
}

Constraints:
- Keep the whole response concise.
- Return at most 4 root causes.
- Return at most 4 feedback alignment items.
- Do not include prompt change suggestions.
- Do not include recommended checks.
"""


def _extract_json_object(raw_text: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw_text.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if not match:
            raise ValueError(f"Retrospective LLM returned invalid JSON: {cleaned[:500]}")
        return json.loads(match.group())


def _resolve_api_key(provider: str, admin_user: User) -> str:
    if provider == "gemini":
        if admin_user.gemini_api_key_enc:
            return decrypt(admin_user.gemini_api_key_enc)
        return settings.GEMINI_API_KEY.strip()
    if admin_user.claude_api_key_enc:
        return decrypt(admin_user.claude_api_key_enc)
    return settings.CLAUDE_API_KEY.strip()


def _build_retrospective_payload(
    *,
    record: AnalysisResult,
    llm_provider: str,
    prompt_version: str | None,
    feedback_text: str,
    focus_areas: str,
) -> str:
    system_prompt_used = resolve_prompt(prompt_version, llm_provider)
    payload = {
        "analysis_context": {
            "report_id": str(record.id),
            "status": record.status,
            "car_name": record.car_name,
            "track_name": record.track_name,
            "created_at": record.created_at.isoformat(),
            "llm_provider": llm_provider,
            "prompt_version": prompt_version or "default",
            "system_prompt_used": system_prompt_used,
        },
        "initial_analysis_payload": record.input_json or {},
        "generated_report": record.result_json or {},
        "user_feedback": {
            "comments": feedback_text,
            "specific_areas_to_analyze": focus_areas,
        },
        "instructions": [
            "Identify why the original analysis may have made mistakes or missed nuance.",
            "Use the feedback and generated report together.",
            "Be concise.",
            "Limit root causes to at most 4 items.",
            "Limit feedback alignment to at most 4 items.",
            "Do not include prompt change suggestions or recommended checks.",
            "If helpful, provide a short suggested prompt patch.",
        ],
    }
    return json.dumps(payload, indent=2, ensure_ascii=False)


async def generate_report_retrospective(
    *,
    record: AnalysisResult,
    admin_user: User,
    feedback_text: str,
    focus_areas: str,
) -> dict[str, Any]:
    result_json = record.result_json or {}
    input_json = record.input_json or {}
    llm_provider = str(input_json.get("llm_provider") or result_json.get("llm_provider") or "claude")
    prompt_version = result_json.get("prompt_version") or input_json.get("prompt_version")
    api_key = _resolve_api_key(llm_provider, admin_user)
    if not api_key:
      raise ValueError(f"No {llm_provider} API key available for admin retrospective")

    user_prompt = _build_retrospective_payload(
        record=record,
        llm_provider=llm_provider,
        prompt_version=prompt_version,
        feedback_text=feedback_text,
        focus_areas=focus_areas,
    )
    request_payload_bytes = len(RETROSPECT_SYSTEM_PROMPT.encode("utf-8")) + len(user_prompt.encode("utf-8"))
    started_at = time.perf_counter()

    if llm_provider == "gemini":
        client = genai.Client(api_key=api_key)
        response = await client.aio.models.generate_content(
            model=GEMINI_MODEL,
            contents=user_prompt,
            config=types.GenerateContentConfig(
                system_instruction=RETROSPECT_SYSTEM_PROMPT,
                max_output_tokens=min(settings.GEMINI_MAX_TOKENS, 4000),
            ),
        )
        raw_text = (response.text or "").strip()
        model_name = GEMINI_MODEL
    else:
        client = anthropic.AsyncAnthropic(api_key=api_key)
        response = await client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=min(settings.CLAUDE_MAX_TOKENS, 4000),
            system=RETROSPECT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw_text = "".join(
            block.text for block in response.content if getattr(block, "type", "") == "text"
        ).strip()
        model_name = CLAUDE_MODEL

    latency_ms = round((time.perf_counter() - started_at) * 1000, 1)
    response_bytes = len(raw_text.encode("utf-8"))
    logger.info(
        "LLM retrospective provider=%s model=%s latency_ms=%.1f request_bytes=%d response_bytes=%d prompt_version=%s",
        llm_provider,
        model_name,
        latency_ms,
        request_payload_bytes,
        response_bytes,
        prompt_version or "default",
    )

    parsed = _extract_json_object(raw_text)
    root_causes = parsed.get("root_causes")
    if isinstance(root_causes, list):
        parsed["root_causes"] = root_causes[:4]
    feedback_alignment = parsed.get("feedback_alignment")
    if isinstance(feedback_alignment, list):
        parsed["feedback_alignment"] = feedback_alignment[:4]
    parsed.pop("prompt_change_suggestions", None)
    parsed.pop("recommended_checks", None)
    parsed["_meta"] = {
        "llm_provider": llm_provider,
        "model_name": model_name,
        "prompt_version": prompt_version or "default",
        "request_payload_bytes": request_payload_bytes,
        "response_bytes": response_bytes,
    }
    return parsed
