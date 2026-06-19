"""POST /search — full kos search pipeline."""

import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .orchestrator import (
    resolve_area,
    ensure_scraped,
    ensure_processed,
    ensure_indexed,
    search_and_rank,
    format_results,
)

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    area: Optional[str] = None
    min_rating: Optional[float] = None
    gender: Optional[str] = None
    top_k: int = 5
    force_scrape: bool = False
    stream: bool = False


@router.post("/search")
async def search(req: SearchRequest):
    area = req.area or _extract_area(req.query)
    if not area:
        raise HTTPException(400, "Could not determine area. Provide 'area' field.")

    geo = resolve_area(area)
    if geo.get("type") == "POI":
        raise HTTPException(400, f"'{area}' is a Point of Interest, not an area.")

    districts = geo.get("districts", [])
    if not districts and not req.area:
        raise HTTPException(400, f"Area '{area}' not found.")

    postal_codes: list = []
    for d in districts:
        postal_codes.extend(d.get("postalCodes", []))

    if not postal_codes:
        raise HTTPException(400, f"No postal codes found for '{area}'")

    pipeline_status = {
        "area": area,
        "regency": geo.get("regency", ""),
        "province": geo.get("province", ""),
    }

    scrape_result = ensure_scraped(area, postal_codes, req.force_scrape)
    if scrape_result["status"] == "error":
        raise HTTPException(500, f"Scrape failed: {scrape_result.get('message')}")
    pipeline_status["scrape"] = scrape_result["status"]

    proc_result = ensure_processed(area)
    if proc_result["status"] == "error":
        raise HTTPException(500, f"Processing failed: {proc_result.get('message')}")
    pipeline_status["process"] = proc_result["status"]

    idx_result = ensure_indexed(area)
    if idx_result["status"] == "error":
        raise HTTPException(500, f"Indexing failed: {idx_result.get('message')}")
    pipeline_status["index"] = f"{idx_result.get('new', 0)} new, {idx_result.get('skipped', 0)} skipped"

    results = search_and_rank(req.query, area, req.top_k)

    if req.stream:
        return StreamingResponse(
            _stream_response(req.query, results),
            media_type="text/event-stream",
        )

    items = []
    for r in results:
        meta = r["metadata"]
        items.append({
            "name": meta["name"],
            "place_id": meta["place_id"],
            "rating": meta["rating"],
            "review_count": meta["review_count"],
            "tags": meta.get("tags", "").split("|") if meta.get("tags") else [],
            "gender": meta.get("gender", ""),
            "phone": meta.get("phone", ""),
            "lat": meta.get("lat", 0),
            "lon": meta.get("lon", 0),
            "kecamatan": meta.get("kecamatan", ""),
            "score": r.get("score", 0),
            "text": r.get("text", ""),
        })

    return {
        "success": True,
        "query": req.query,
        "pipeline": pipeline_status,
        "results": items,
        "summary": format_results(results, req.query),
    }


async def _stream_response(query: str, results):
    summary = format_results(results, query)
    yield f"data: {json.dumps({'type': 'summary', 'content': summary})}\n\n"
    yield "data: [DONE]\n\n"


def _extract_area(query: str) -> Optional[str]:
    areas = [
        "cengkareng", "jakarta barat", "jakarta selatan", "jakarta timur",
        "jakarta pusat", "jakarta utara", "bandung", "surabaya", "yogyakarta",
        "tangerang", "bekasi", "depok", "bogor", "semarang",
    ]
    lower = query.lower()
    for a in areas:
        if a in lower:
            return a
    return None
