"""POST /poi/resolve — convert POI query to coordinates + nearest area.

Geocodes a Point of Interest (e.g., 'stasiun poris') via Nominatim and finds
the nearest regency/districts via the geo-router so the frontend can load the
right area for a radius-based kos search.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .geocode import geocode
from .orchestrator import resolve_area

router = APIRouter(prefix="/poi", tags=["poi"])


class PoiResolveRequest(BaseModel):
    query: str  # e.g., "stasiun poris tangerang"


@router.post("/resolve")
async def poi_resolve(req: PoiResolveRequest):
    geo = geocode(req.query)
    if not geo:
        raise HTTPException(404, f"Could not geocode: {req.query}")

    regency = geo.get("regency", "")
    province = geo.get("province", "")

    # Try to resolve the regency to get districts
    districts = []
    if regency:
        area = resolve_area(regency)
        if area.get("districts"):
            districts = area.get("districts", [])
            province = province or area.get("province", "")

    return {
        "lat": geo["lat"],
        "lon": geo["lon"],
        "display_name": geo["display_name"],
        "regency": regency or province,
        "province": province,
        "districts": districts,
    }
