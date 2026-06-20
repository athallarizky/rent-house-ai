"""POST /poi/resolve — convert POI query to coordinates + nearest area.

Geocodes a Point of Interest (e.g., 'stasiun poris') via Nominatim and finds
the nearest regency/districts via the geo-router so the frontend can load the
right area for a radius-based kos search.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .geocode import geocode
from .locations import _load_regencies
from .orchestrator import resolve_area

router = APIRouter(prefix="/poi", tags=["poi"])

_PROVINCE_REGENCIES=None


def _province_regencies():
    """province (lower) -> {display, regencies:set} built lazily from kodepos."""
    global _PROVINCE_REGENCIES
    if _PROVINCE_REGENCIES is None:
        idx = {}
        for r in _load_regencies():
            prov = r.get("province", "")
            if not prov:
                continue
            entry = idx.setdefault(prov.lower(), {"display": prov, "regencies": set()})
            entry["regencies"].add(r.get("regency", ""))
        _PROVINCE_REGENCIES = idx
    return _PROVINCE_REGENCIES


class PoiResolveRequest(BaseModel):
    query: str  # e.g., "stasiun poris tangerang"


@router.post("/resolve")
async def poi_resolve(req: PoiResolveRequest):
    geo = geocode(req.query)
    if not geo:
        raise HTTPException(404, f"Could not geocode: {req.query}")

    regency = geo.get("regency", "")
    province = geo.get("province", "")
    district = geo.get("district", "")

    # Try to resolve the regency to get districts
    districts = []
    if regency:
        area = resolve_area(regency)
        if area.get("districts"):
            districts = area.get("districts", [])
            province = province or area.get("province", "")

    # Find the district that matches the geocoded location
    matched_district = None
    if district:
        for d in districts:
            if d.get("name", "").lower() == district.lower():
                matched_district = d.get("name")
                break

    result = {
        "lat": geo["lat"],
        "lon": geo["lon"],
        "display_name": geo["display_name"],
        "regency": regency or province,
        "province": province,
        "district": matched_district or district,
        "districts": districts,
    }

    # Province-level geocode (e.g. "Gorontalo"/"Maluku" resolves to the province
    # point, regency is empty) -> offer the province's regencies as a drill-down
    # instead of returning empty districts / "not found".
    if not districts and province:
        pe = _province_regencies().get(province.lower())
        if pe:
            result["broad_region"] = True
            result["region_type"] = "province"
            result["region"] = pe["display"]
            result["regions"] = sorted(r for r in pe["regencies"] if r)
    return result
