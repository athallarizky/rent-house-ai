"""GET/PUT /settings + POST /settings/test — LLM provider config.

Settings are persisted to data/settings.json. The RAG engine reads the key/model
from this file via config.py. GET requires authentication; PUT + POST /test require admin.
"""

import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from .auth import get_current_user, require_admin

ROOT = Path(__file__).resolve().parent.parent.parent
SETTINGS_PATH = ROOT / "data" / "settings.json"

# Default to the Z.AI coding-plan endpoint (this project's plan).
# PAYG users switch base_url to https://api.z.ai/api/paas/v4/ in the form.
DEFAULT_BASE_URL = "https://api.z.ai/api/coding/paas/v4/"
DEFAULT_MODEL = "glm-4.5-air"
DEFAULT_PROVIDER = "Z.AI"

router = APIRouter(prefix="/settings", tags=["settings"])


class Settings(BaseModel):
    provider: str = DEFAULT_PROVIDER
    model: str = DEFAULT_MODEL
    api_key: str = ""
    base_url: str = DEFAULT_BASE_URL


class SettingsTestRequest(BaseModel):
    api_key: str
    model: str = DEFAULT_MODEL
    base_url: str = DEFAULT_BASE_URL


class ModelsRequest(BaseModel):
    api_key: Optional[str] = None
    base_url: str = DEFAULT_BASE_URL


def _read() -> Settings:
    if SETTINGS_PATH.exists():
        try:
            data = json.loads(SETTINGS_PATH.read_text())
            return Settings(
                provider=data.get("provider", DEFAULT_PROVIDER),
                model=data.get("model", DEFAULT_MODEL),
                api_key=data.get("api_key", ""),
                base_url=data.get("base_url", DEFAULT_BASE_URL),
            )
        except Exception:
            pass
    return Settings()


def _write(s: Settings) -> None:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(s.model_dump_json(indent=2))


@router.get("")
async def get_settings(user: dict = Depends(get_current_user)):
    s = _read()
    # Don't echo the full key back to the client — return a masked hint.
    masked = ""
    if s.api_key:
        masked = s.api_key[:4] + "…" + s.api_key[-4:] if len(s.api_key) > 8 else "••••"
    return {
        "provider": s.provider,
        "model": s.model,
        "base_url": s.base_url,
        "api_key_set": bool(s.api_key),
        "api_key_hint": masked,
    }


@router.put("")
async def update_settings(req: Settings, user: dict = Depends(require_admin)):
    # Empty api_key means "keep existing" (client sends masked/no key).
    if not req.api_key:
        existing = _read()
        req.api_key = existing.api_key
    _write(req)
    return {"ok": True, "provider": req.provider, "model": req.model}


@router.post("/test")
async def test_settings(req: SettingsTestRequest, user: dict = Depends(require_admin)):
    """Ping Z.AI with a trivial message to validate the key/model server-side.

    Done server-side to avoid browser CORS against the Z.AI endpoint.
    """
    key = req.api_key or _read().api_key
    if not key:
        return {"ok": False, "error": "API key kosong."}
    try:
        import openai

        client = openai.OpenAI(api_key=key, base_url=req.base_url)
        resp = client.chat.completions.create(
            model=req.model,
            messages=[{"role": "user", "content": "hi"}],
            max_tokens=8,
            temperature=0,
        )
        reply = (resp.choices[0].message.content or "").strip() if resp.choices else ""
        return {"ok": True, "reply": reply[:120]}
    except Exception as e:
        return {"ok": False, "error": str(e)[:300]}


@router.post("/models")
async def list_models(req: ModelsRequest):
    """Fetch the list of available model ids from Z.AI (proxied server-side).

    Used by the settings form to populate the model input dynamically so the
    suggestions are always accurate (no hardcoded list to drift out of date).
    """
    key = req.api_key or _read().api_key
    if not key:
        return {"models": []}
    try:
        import openai

        client = openai.OpenAI(api_key=key, base_url=req.base_url)
        resp = client.models.list()
        return {"models": sorted([m.id for m in resp.data])}
    except Exception as e:
        return {"models": [], "error": str(e)[:200]}
