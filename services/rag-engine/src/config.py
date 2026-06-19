"""Configuration for RAG engine."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent

CHROMA_PATH = str(ROOT / "data" / "chroma_db")
COLLECTION_NAME = "kos_indonesia"

EMBED_MODEL = os.environ.get("EMBED_MODEL", "BAAI/bge-m3")

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.z.ai/api/paas/v4/")
LLM_API_KEY = os.environ.get("ZAI_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "glm-air")

SEARCH_TOP_K = int(os.environ.get("SEARCH_TOP_K", "20"))
