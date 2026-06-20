"""POST /search — RAG refinement over an already-loaded district.
   POST /area/load — load the full kos dataset for a district (session browse set).
"""

import asyncio
import json
import threading
from queue import Queue
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from .auth import get_current_user

from .orchestrator import (
    resolve_area,
    ensure_scraped,
    ensure_processed,
    ensure_indexed,
    search_and_rank,
    format_results,
    format_results_stream,
    load_area,
    run_pipeline_background,
    is_area_cached,
)
from .pipeline_state import get_pipeline_state

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    area: Optional[str] = None
    regency: Optional[str] = None
    min_rating: Optional[float] = None
    gender: Optional[str] = None
    top_k: int = 8
    force_scrape: bool = False
    stream: bool = False
    # Rev-001: by default /search is a lightweight refine over an already-indexed
    # district. Set ensure_pipeline=true to run scrape/process/index inline
    # (backward-compat / fallback when /area/load hasn't been called).
    ensure_pipeline: bool = False
    chat_history: Optional[List[dict]] = None
    mode: str = "ai"  # "ai" = full LLM pipeline, "rag" = results only (no LLM)


class AreaLoadRequest(BaseModel):
    district: str
    regency: Optional[str] = None
    load_all: bool = False


@router.post("/area/load")
async def area_load(req: AreaLoadRequest, user: dict = Depends(get_current_user)):
    """Load the full kos dataset for a district + sibling districts (switcher)."""
    result = load_area(req.district, req.regency, load_all=req.load_all)
    if not result.get("success"):
        raise HTTPException(400, result.get("error", "Failed to load area"))
    return result


@router.get("/pipeline/status")
async def pipeline_status(user: dict = Depends(get_current_user)):
    """Return current pipeline state (idle, running, queued, progress)."""
    return get_pipeline_state().snapshot()


@router.post("/search")
async def search(req: SearchRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    area = req.area or _extract_area(req.query)
    if not area:
        raise HTTPException(400, "Could not determine area. Provide 'area' field.")

    pipeline_status: Optional[dict] = None

    if req.ensure_pipeline:
        # ================================================================
        # 3-layer check: cache → dedup → queue → background
        # ================================================================
        state = get_pipeline_state()

        # Layer 1: Cache hit — skip pipeline entirely
        if is_area_cached(area):
            # Area already indexed — search directly
            results = search_and_rank(req.query, area, req.top_k, regency=req.regency)
            items = _format_items(results)
            if req.stream:
                return StreamingResponse(
                    _stream_response(req.query, area, {"status": "cached"}, items, results, req.chat_history, req.mode),
                    media_type="text/event-stream",
                )
            return {
                "success": True,
                "query": req.query,
                "pipeline": {"status": "cached"},
                "results": items,
            }

        # Resolve geo for postal codes (needed regardless of path)
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

        # Layer 2: Same area already running
        if state.running == area:
            return {
                "success": False,
                "pipeline_blocked": True,
                "message": f"Pipeline for '{area}' is already running.",
                "pipeline": state.snapshot(),
            }

        # Layer 3: Another pipeline running → queue
        if state.running is not None:
            ok = state.queue(area)
            if ok:
                return {
                    "success": False,
                    "pipeline_queued": True,
                    "message": f"Pipeline for '{state.running}' is running. '{area}' queued.",
                    "pipeline": state.snapshot(),
                }
            else:
                return {
                    "success": False,
                    "pipeline_blocked": True,
                    "message": f"Pipeline for '{area}' is already running (dedup).",
                    "pipeline": state.snapshot(),
                }

        # Start pipeline in background
        ok = state.start(area)
        if not ok:
            return {
                "success": False,
                "pipeline_blocked": True,
                "message": "Another pipeline is already running.",
                "pipeline": state.snapshot(),
            }

        background_tasks.add_task(run_pipeline_background, area, postal_codes, req.force_scrape)

        return {
            "success": False,
            "pipeline_started": True,
            "message": f"Pipeline started for '{area}'. Poll /pipeline/status for progress.",
            "pipeline": state.snapshot(),
        }

    # No pipeline — lightweight search (existing behavior)
    results = search_and_rank(req.query, area, req.top_k, regency=req.regency)

    if req.stream:
        formatted = _format_items(results)
        return StreamingResponse(
            _stream_response(req.query, area, pipeline_status, formatted, results, req.chat_history, req.mode),
            media_type="text/event-stream",
        )

    items = _format_items(results)

    if req.mode == "rag":
        return {
            "success": True,
            "query": req.query,
            "pipeline": pipeline_status,
            "results": items,
        }

    return {
        "success": True,
        "query": req.query,
        "pipeline": pipeline_status,
        "results": items,
        "summary": format_results(results, req.query, req.chat_history),
    }


def _format_items(results: List[dict]) -> List[dict]:
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
    return items


async def _stream_response(query: str, area: str, pipeline: dict, items: List[dict], results: List[dict], chat_history: Optional[List[dict]] = None, mode: str = "ai"):
    """Emit SSE events: progress → results → token... → done.

    LLM tokens are produced by a sync subprocess generator and bridged to the
    async event loop via a queue + thread, so tokens reach the client as they
    arrive instead of being buffered.
    """
    yield _sse({"type": "progress", "stage": "search", "message": f"Mencari kos di {area}…"})
    if pipeline:
        yield _sse({"type": "pipeline", "pipeline": pipeline})
    yield _sse({"type": "results", "results": items, "query": query, "mode": mode})

    if mode == "rag":
        yield _sse({"type": "done"})
        return

    loop = asyncio.get_event_loop()
    queue: "Queue[object]" = Queue()
    SENTINEL = object()

    def producer():
        try:
            for token in format_results_stream(results, query, chat_history):
                queue.put(token)
        except Exception as exc:  # noqa: BLE001 — surfaced to client
            queue.put(exc)
        finally:
            queue.put(SENTINEL)

    thread = threading.Thread(target=producer, daemon=True)
    thread.start()

    while True:
        item = await loop.run_in_executor(None, queue.get)
        if item is SENTINEL:
            break
        if isinstance(item, Exception):
            yield _sse({"type": "token", "token": f"\n\n_(error: {item})_"})
            break
        if item:
            yield _sse({"type": "token", "token": item})

    thread.join(timeout=2)
    yield _sse({"type": "done"})


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


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
