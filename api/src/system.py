"""GET /health/services — aggregate health of the backend stack.

Returns the status of the three services the app depends on:
  - fastapi    (self — the API you're talking to)
  - geo_router (Fastify :3001 — area resolution)
  - rag        (ChromaDB vector index — kos search)
"""

import os
import subprocess
import sys
import urllib.request
from pathlib import Path

from fastapi import APIRouter

ROOT = Path(__file__).resolve().parent.parent.parent
GEO_ROUTER_URL = os.environ.get("GEO_ROUTER_URL", "http://localhost:3001")

router = APIRouter(tags=["system"])


@router.get("/health/services")
async def services_health():
    # FastAPI (self) is up by definition if this responds.
    fastapi = {"ok": True, "url": "http://localhost:8080"}

    # Geo-router
    geo = {"ok": False, "url": GEO_ROUTER_URL}
    try:
        resp = urllib.request.urlopen(f"{GEO_ROUTER_URL}/health", timeout=3)
        geo["ok"] = resp.status == 200
    except Exception:
        geo["ok"] = False

    # RAG / ChromaDB — count entries in the kos collection (lightweight).
    rag: dict = {"ok": False}
    try:
        proc = subprocess.run(
            [sys.executable, "-c",
             "from src.config import CHROMA_PATH, COLLECTION_NAME; "
             "import chromadb; "
             "c = chromadb.PersistentClient(path=CHROMA_PATH); "
             "print(c.get_collection(COLLECTION_NAME).count())"],
            cwd=str(ROOT / "services" / "rag-engine"),
            timeout=10,
            capture_output=True,
            text=True,
        )
        if proc.returncode == 0:
            rag["ok"] = True
            rag["entries"] = int(proc.stdout.strip() or "0")
    except Exception:
        rag["ok"] = False

    return {
        "fastapi": fastapi,
        "geo_router": geo,
        "rag": rag,
        "all_ok": fastapi["ok"] and geo["ok"] and rag["ok"],
    }
