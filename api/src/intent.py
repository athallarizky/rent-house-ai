"""POST /intent — LLM-powered query intent extraction.

Delegates to rag-engine via subprocess so it shares the same Z.AI key/model config.
"""

import json
import subprocess
import sys
from pathlib import Path
from typing import Optional, Any, Dict, List

from fastapi import APIRouter
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent.parent
RAG_DIR = ROOT / "services" / "rag-engine"

router = APIRouter(prefix="/intent", tags=["intent"])


class IntentRequest(BaseModel):
    query: str


class IntentResponse(BaseModel):
    area: Optional[str] = None
    poi: Optional[str] = None
    tags: List[str] = []
    gender: Optional[str] = None
    budget_min: Optional[int] = None
    budget_max: Optional[int] = None
    keywords: List[str] = []


@router.post("", response_model=IntentResponse)
async def extract_intent(req: IntentRequest):
    intent = _extract_intent_subprocess(req.query)
    return IntentResponse(**intent)


def _extract_intent_subprocess(query: str) -> Dict[str, Any]:
    proc = subprocess.run(
        [sys.executable, "-c",
         f"import json; from src.intent import extract_intent; "
         f"result = extract_intent({json.dumps(query)}); "
         f"print(json.dumps(result))"],
        cwd=str(RAG_DIR),
        timeout=45,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return {"area": None, "tags": [], "gender": None, "budget_min": None, "budget_max": None, "keywords": []}
    try:
        return json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        return {"area": None, "tags": [], "gender": None, "budget_min": None, "budget_max": None, "keywords": []}
