"""GET /locations/* — proxy to geo-router."""

import json
import urllib.request
import urllib.parse

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/locations", tags=["locations"])

GEO_ROUTER_URL = "http://localhost:3001"


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
