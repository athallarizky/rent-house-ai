"""Configuration for RAG engine."""

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent

CHROMA_PATH = str(ROOT / "data" / "chroma_db")
COLLECTION_NAME = "kos_indonesia"

EMBED_MODEL = os.environ.get("EMBED_MODEL", "intfloat/multilingual-e5-small")

_SETTINGS_PATH = ROOT / "data" / "settings.json"


def _load_settings() -> dict:
    if not _SETTINGS_PATH.exists():
        return {}
    try:
        return json.loads(_SETTINGS_PATH.read_text())
    except Exception:
        return {}


_settings = _load_settings()

LLM_BASE_URL = _settings.get("base_url") or os.environ.get(
    "LLM_BASE_URL", "https://api.z.ai/api/coding/paas/v4/"
)
LLM_API_KEY = _settings.get("api_key") or os.environ.get("ZAI_API_KEY", "")
LLM_MODEL = _settings.get("model") or os.environ.get("LLM_MODEL", "glm-4.5-air")

SEARCH_TOP_K = int(os.environ.get("SEARCH_TOP_K", "20"))
