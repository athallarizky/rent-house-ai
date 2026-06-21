"""GET /locations/* — proxy to geo-router + area list."""

import json
import os
import urllib.request
import urllib.parse
from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/locations", tags=["locations"])

GEO_ROUTER_URL = os.environ.get("GEO_ROUTER_URL", "http://localhost:3001")
KODEPOS_PATH = Path(__file__).resolve().parent.parent.parent / "services" / "geo-router" / "kodepos" / "data" / "kodepos.json"

_regencies_cache: List[dict] = []


def _load_regencies() -> List[dict]:
    global _regencies_cache
    if _regencies_cache:
        return _regencies_cache

    if not KODEPOS_PATH.exists():
        return []

    import collections

    groups: dict = collections.defaultdict(list)
    with open(KODEPOS_PATH) as f:
        data = json.load(f)

    for entry in data:
        reg = entry.get("regency", "")
        prov = entry.get("province", "")
        if reg and prov:
            key = f"{reg}|{prov}"
            if not groups[key]:
                groups[key].append({"regency": reg, "province": prov})

    _regencies_cache = sorted(
        [v[0] for v in groups.values()],
        key=lambda x: (x["province"], x["regency"]),
    )
    return _regencies_cache


@router.get("/areas")
async def list_areas(q: str = Query(default="", description="Filter by name")):
    regencies = _load_regencies()
    if not q:
        return {"areas": regencies}

    lower = q.lower()
    filtered = [
        r for r in regencies
        if lower in r["regency"].lower() or lower in r["province"].lower()
    ]
    return {"areas": filtered[:50]}


@router.get("/resolve")
async def resolve_location(q: str = Query(..., description="Location name")):
    try:
        url = f"{GEO_ROUTER_URL}/resolve?q={urllib.parse.quote(q)}"
        resp = urllib.request.urlopen(url, timeout=5)
        return json.loads(resp.read())
    except Exception as e:
        raise HTTPException(502, f"Geo-router unavailable: {e}")


@router.get("/expand")
async def expand_location(q: str = Query(..., description="Regency name")):
    try:
        url = f"{GEO_ROUTER_URL}/expand?q={urllib.parse.quote(q)}"
        resp = urllib.request.urlopen(url, timeout=5)
        return json.loads(resp.read())
    except Exception as e:
        raise HTTPException(502, f"Geo-router unavailable: {e}")
