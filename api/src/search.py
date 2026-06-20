"""POST /search — RAG refinement over an already-loaded district.
   POST /area/load — load the full kos dataset for a district (session browse set).
"""

import asyncio
import json
import re
import threading
from queue import Queue
from typing import Dict, List, Optional

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
async def area_load(req: AreaLoadRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    """Load the full kos dataset for a district + sibling districts (switcher).

    With Sprint-6: if area is not cached, pipeline runs in background.
    Frontend polls GET /pipeline/status for progress.
    """
    area = req.district

    # Check cache first — fast path
    if is_area_cached(area):
        result = load_area(area, req.regency, load_all=req.load_all)
        if not result.get("success"):
            raise HTTPException(400, result.get("error", "Failed to load area"))
        return result

    # Not cached — use 3-layer check
    state = get_pipeline_state()

    if state.running == area:
        raise HTTPException(409, f"Pipeline for '{area}' is already running.")

    geo = resolve_area(area)
    districts = geo.get("districts", [])
    postal_codes = []
    for d in districts:
        postal_codes.extend(d.get("postalCodes", []))
    if not postal_codes:
        raise HTTPException(400, f"No postal codes found for '{area}'")

    if state.running is not None:
        ok = state.queue(area)
        if ok:
            return {
                "success": False,
                "pipeline_queued": True,
                "message": f"Pipeline queued behind '{state.running}'.",
                "pipeline": state.state(),
            }
        raise HTTPException(409, f"Pipeline already queued/running for '{area}'.")

    ok = state.start(area)
    if not ok:
        raise HTTPException(503, "Pipeline slot occupied — try again soon.")

    background_tasks.add_task(run_pipeline_background, area, postal_codes, req.load_all)

    return {
        "success": False,
        "pipeline_started": True,
        "message": f"Pipeline started for '{area}'. Poll /pipeline/status.",
        "pipeline": state.state(),
    }


@router.get("/pipeline/status")
async def pipeline_status(user: dict = Depends(get_current_user)):
    """Return current pipeline state (idle, running, queued, progress)."""
    return get_pipeline_state().state()


@router.post("/search")
async def search(req: SearchRequest, background_tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
    area = req.area
    resolved = None
    if not area:
        resolved = _resolve_query(req.query)
        area = resolved["name"] if resolved and resolved["kind"] == "area" else None
    if not area:
        # Broad region (province/regency)? Offer a drill-down list instead of a
        # 400 / empty search (e.g. "kos di Lampung" -> list Lampung's regencies).
        if resolved and resolved["kind"] == "region":
            region = {k: v for k, v in resolved.items() if k != "kind"}
            return {
                "success": False,
                "broad_region": True,
                **region,
                "message": (
                    f"'{region['region']}' adalah area luas dengan "
                    f"{len(region['regions'])} sub-area. Pilih salah satu untuk cari kos."
                ),
            }
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
                "pipeline": state.state(),
            }

        # Layer 3: Another pipeline running → queue
        if state.running is not None:
            ok = state.queue(area)
            if ok:
                return {
                    "success": False,
                    "pipeline_queued": True,
                    "message": f"Pipeline for '{state.running}' is running. '{area}' queued.",
                    "pipeline": state.state(),
                }
            else:
                return {
                    "success": False,
                    "pipeline_blocked": True,
                    "message": f"Pipeline for '{area}' is already running (dedup).",
                    "pipeline": state.state(),
                }

        # Start pipeline in background
        ok = state.start(area)
        if not ok:
            return {
                "success": False,
                "pipeline_blocked": True,
                "message": "Another pipeline is already running.",
                "pipeline": state.state(),
            }

        background_tasks.add_task(run_pipeline_background, area, postal_codes, req.force_scrape)

        return {
            "success": False,
            "pipeline_started": True,
            "message": f"Pipeline started for '{area}'. Poll /pipeline/status for progress.",
            "pipeline": state.state(),
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


# Known areas matched quickly by substring (no network). Specific kecamatan
# MUST come before their regency/city (e.g. "bekasi timur" before "bekasi"),
# since matching is substring-based. The geo-router fallback below covers any
# area not listed here.
_KNOWN_AREAS = [
    # Jakarta Timur
    "cilincing", "pulo gadung", "pulogadung", "cakung", "matraman",
    "jatinegara", "duren sawit", "kramat jati", "makasar", "pasar rebo",
    "ciracas", "cipayung",
    # Jakarta Utara
    "tanjung priok", "kelapa gading", "penjaringan", "koja",
    # Jakarta Barat
    "cengkareng", "kalideres", "kebon jeruk", "grogol petamburan",
    "taman sari", "tambora",
    # Jakarta Selatan
    "kebayoran baru", "kebayoran lama", "mampang prapatan", "pasar minggu",
    "cilandak", "jagakarsa", "pesanggrahan", "tebet", "setiabudi",
    # Jakarta Pusat
    "menteng", "tanah abang", "kemayoran", "sawah besar",
    # Bekasi (kecamatan before kota)
    "bekasi timur", "bekasi barat", "bekasi selatan", "bekasi utara",
    # Kota / kabupaten (generic, last)
    "jakarta barat", "jakarta selatan", "jakarta timur", "jakarta pusat",
    "jakarta utara", "tangerang selatan", "tangerang", "bekasi", "depok",
    "bogor", "bandung", "surabaya", "yogyakarta", "semarang", "malang",
]

# Words that are NOT place names — stripped before trying the geo-router so a
# full sentence like "kos di sekitar tenjo" reduces to the place candidate "tenjo".
_NON_AREA_WORDS = {
    # kos / query verbs
    "kos", "kost", "kosan", "cari", "mencari", "buat", "untuk", "saya", "aku",
    # prepositions / location fillers
    "di", "sekitar", "sekitarnya", "dekat", "dekatnya", "depan", "sebelah",
    "seputar", "area", "pinggir", "dalam", "luar", "antara", "menuju",
    # connectors
    "yang", "dan", "atau", "dengan", "tapi", "yg", "dkk",
    # facility / attribute terms
    "murah", "mahal", "bersih", "luas", "putri", "putra", "campur", "khusus",
    "wifi", "ac", "parkir", "kasur", "lemari", "dapur", "laundry", "listrik",
    "harga", "dibawah", "diatas", "sebulan", "perbulan", "bulan",
}


# Province -> regencies/cities index, built lazily from the kodepos regency list.
# Used to offer a drill-down when a query names a broad region (e.g. "Lampung")
# instead of returning an empty search.
_PROVINCE_INDEX: Optional[Dict[str, Dict[str, object]]] = None


def _province_index() -> Dict[str, Dict[str, object]]:
    global _PROVINCE_INDEX
    if _PROVINCE_INDEX is None:
        from .locations import _load_regencies
        idx: Dict[str, Dict[str, object]] = {}
        for r in _load_regencies():
            prov = r.get("province", "")
            if not prov:
                continue
            entry = idx.setdefault(prov.lower(), {"display": prov, "regencies": set()})
            entry["regencies"].add(r.get("regency", ""))  # type: ignore[attr-defined]
        _PROVINCE_INDEX = idx
    return _PROVINCE_INDEX


def _resolve_query(query: str) -> Optional[dict]:
    """Resolve a query's place into a specific kecamatan OR a broad region.

    Returns one of:
      {"kind": "area",   "name": <kecamatan>}
      {"kind": "region", "region_type": "province", "region": ..., "regions": [...]}
      {"kind": "region", "region_type": "regency",  "region": ..., "province": ..., "regions": [...]}
      None

    Candidate phrases are tried LONGEST-first (contiguous spans of non-area
    words) so multi-word regions like "Bandar Lampung" / "Jawa Barat" resolve
    as a region instead of a spurious single district from a short unigram
    like "bandar" or "barat".
    """
    lower = query.lower()

    # 1) fast keyword match against known areas (no network)
    for a in _KNOWN_AREAS:
        if a in lower:
            return {"kind": "area", "name": a}

    # 2) candidate phrases from non-area words, longest contiguous span first
    tokens = [
        t for t in re.findall(r"[a-zA-Z]+", lower)
        if t not in _NON_AREA_WORDS and len(t) > 2
    ]
    provs = _province_index()
    seen: set[str] = set()
    calls = 0
    for span_len in range(len(tokens), 0, -1):
        for start in range(0, len(tokens) - span_len + 1):
            cand = " ".join(tokens[start:start + span_len])
            if cand in seen:
                continue
            seen.add(cand)

            # Province? -> list its regencies/cities
            pe = provs.get(cand)
            if pe:
                return {
                    "kind": "region",
                    "region_type": "province",
                    "region": pe["display"],
                    "regions": sorted(r for r in pe["regencies"] if r),  # type: ignore[arg-type]
                }

            # Geo-router resolve (cap calls to bound latency)
            if calls >= 8:
                continue
            calls += 1
            geo = resolve_area(cand)
            districts = geo.get("districts", [])
            if geo.get("type") == "AREA":
                if len(districts) == 1:
                    return {"kind": "area", "name": districts[0].get("name") or cand}
                if len(districts) > 1:
                    return {
                        "kind": "region",
                        "region_type": "regency",
                        "region": geo.get("regency") or cand,
                        "province": geo.get("province", ""),
                        "regions": [d.get("name") for d in districts if d.get("name")],
                    }
            # POI / no match: try the next shorter span
    return None
