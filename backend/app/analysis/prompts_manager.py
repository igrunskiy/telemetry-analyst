"""
Manages named system-prompt versions stored as .md files in the prompts/ directory.
A metadata.json file records which prompt is the default for each LLM provider.
"""

from __future__ import annotations

import json
from pathlib import Path

_PROMPTS_DIR = Path(__file__).parent / "prompts"
_METADATA_FILE = _PROMPTS_DIR / "metadata.json"


def _load_metadata() -> dict:
    if _METADATA_FILE.exists():
        return json.loads(_METADATA_FILE.read_text(encoding="utf-8"))
    return {"defaults": {"claude": "system", "gemini": "system"}}


def _save_metadata(meta: dict) -> None:
    _METADATA_FILE.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")


def list_prompts() -> list[dict]:
    """Return all .md prompts with their content and which models they are default for."""
    meta = _load_metadata()
    defaults = meta.get("defaults", {})
    prompts = []
    for f in sorted(_PROMPTS_DIR.glob("*.md")):
        name = f.stem
        content = f.read_text(encoding="utf-8")
        default_for = [model for model, pname in defaults.items() if pname == name]
        prompts.append({"name": name, "content": content, "default_for": default_for})
    return prompts


def get_prompt(name: str) -> str | None:
    path = _PROMPTS_DIR / f"{name}.md"
    return path.read_text(encoding="utf-8") if path.exists() else None


def save_prompt(name: str, content: str) -> None:
    (_PROMPTS_DIR / f"{name}.md").write_text(content, encoding="utf-8")


def delete_prompt(name: str) -> bool:
    path = _PROMPTS_DIR / f"{name}.md"
    if path.exists():
        path.unlink()
        return True
    return False


def get_defaults() -> dict[str, str]:
    return _load_metadata().get("defaults", {"claude": "system", "gemini": "system"})


def set_defaults(defaults: dict[str, str]) -> None:
    meta = _load_metadata()
    meta["defaults"] = defaults
    _save_metadata(meta)


def get_default_prompt_name(model: str) -> str:
    return get_defaults().get(model, "system")


def resolve_prompt(name: str | None, model: str) -> str:
    """Return prompt content for the given name (or model's default if name is None)."""
    effective = name or get_default_prompt_name(model)
    content = get_prompt(effective)
    if content is None:
        content = get_prompt("system") or ""
    return content.strip()
