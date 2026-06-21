"""Pipeline orchestrator — coordinates geo-router, scraper, processor, and RAG engine."""

import asyncio
import glob
import json
import os
import urllib.request
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

from .pipeline_state import get_pipeline_state

ROOT = Path(__file__).resolve().parent.parent.parent
GEO_ROUTER_URL = os.environ.get("GEO_ROUTER_URL", "http://localhost:3001")


# Sprint 8 — in-process RAG bridge. Imported lazily so the API stays importable
# without torch/chromadb installed (e.g. local dev, unit tests). The first call
# loads the rag-engine package + (via startup) the bge-m3 model; sys.modules
# caches it thereafter.
_rag_bridge = None


def _rag():
    global _rag_bridge
    if _rag_bridge is None:
        from . import rag_bridge
        _rag_bridge = rag_bridge
    return _rag_bridge


_data_bridge = None


def _data():
    global _data_bridge
    if _data_bridge is None:
        from . import data_bridge
        _data_bridge = data_bridge
    return _data_bridge


def is_area_cached(area: str) -> bool:
    """Check if an area has already been scraped, processed, and indexed.

    Returns True only if the full pipeline output exists (cleaned docs).
    Raw JSONL existence alone means scrape finished but process/index may not have.
    """
    docs_path = ROOT / "data" / "cleaned" / f"{area}_docs.json"
    return docs_path.exists() and docs_path.stat().st_size > 100


def _format_kos_items(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Shape raw {metadata, text} from the RAG engine into the API KosResult item."""
    items = []
    for r in results:
        meta = r.get("metadata", r)
        items.append({
            "name": meta.get("name", ""),
            "place_id": meta.get("place_id", ""),
            "rating": meta.get("rating", 0),
            "review_count": meta.get("review_count", 0),
            "tags": meta.get("tags", "").split("|") if meta.get("tags") else [],
            "gender": meta.get("gender", ""),
            "phone": meta.get("phone", ""),
            "lat": meta.get("lat", 0),
            "lon": meta.get("lon", 0),
            "kecamatan": meta.get("kecamatan", ""),
            "score": r.get("score", 0),
            "text": r.get("text", ""),
            "price_min": meta.get("price_min") or None,
            "price_max": meta.get("price_max") or None,
        })
    return items


def resolve_area(query: str) -> Dict[str, Any]:
    try:
        url = f"{GEO_ROUTER_URL}/resolve?q={urllib.parse.quote(query)}"
        resp = urllib.request.urlopen(url, timeout=5)
        data = json.loads(resp.read())
        if data.get("success"):
            return data["data"]
    except Exception:
        pass
    return {"type": "AREA", "regency": query, "districts": [], "province": ""}


def ensure_scraped(area: str, postal_codes: List[int], force: bool = False, stale_days: int = 30) -> Dict[str, Any]:
    cache_dir = ROOT / "data" / "raw" / area

    max_age = 0.0
    all_fresh = True
    for code in postal_codes:
        path = cache_dir / f"{code}.jsonl"
        if path.exists():
            mtime = datetime.fromtimestamp(os.path.getmtime(path))
            age = (datetime.now() - mtime).total_seconds() / 86400
            max_age = max(max_age, age)
            if stale_days > 0 and age > stale_days:
                all_fresh = False
        else:
            all_fresh = False

    if not force and all_fresh:
        count = len(list(cache_dir.glob("*.jsonl")))
        return {"status": "cached", "files": count, "scrape_age_days": round(max_age, 1)}

    # Sprint 12 — release/standalone: scraper always runs as an external
    # service (EC2) reached via REMOTE_SCRAPER_URL. There is no in-process
    # subprocess fallback in this branch; if the env vars are missing, fail
    # loudly so the operator notices immediately.
    from . import scraper_client
    if not scraper_client.is_configured():
        return {
            "status": "error",
            "message": (
                "REMOTE_SCRAPER_URL and REMOTE_SCRAPER_API_KEY must be set. "
                "The in-process scraper subprocess is not available on the "
                "release/standalone branch."
            ),
        }
    return scraper_client.scrape_area_remote(area, postal_codes, lang="id", depth=2)


def ensure_processed(area: str) -> Dict[str, Any]:
    docs_path = ROOT / "data" / "cleaned" / f"{area}_docs.json"
    # Treat as cached ONLY if the file has real content. A failed/partial earlier
    # run can leave an empty [] (2 bytes) docs file; checking just .exists()
    # would skip reprocessing forever and the area indexes 0 docs (see RCA-029).
    if docs_path.exists():
        try:
            if docs_path.stat().st_size > 100:
                return {"status": "cached"}
        except OSError:
            pass

    try:
        _data().process_area(area)
    except Exception as exc:  # noqa: BLE001 — surface to pipeline state
        return {"status": "error", "message": str(exc)[:300]}

    return {"status": "processed"}


def ensure_indexed(area: str) -> Dict[str, Any]:
    docs_path = ROOT / "data" / "cleaned" / f"{area}_docs.json"
    if not docs_path.exists():
        return {"status": "error", "message": "No processed docs found"}

    try:
        result = _rag().ingest(docs_path)
    except Exception as exc:  # noqa: BLE001 — surface to pipeline state
        return {"status": "error", "message": str(exc)[:300]}

    return {"status": "indexed", "new": result.get("indexed", 0), "skipped": result.get("skipped", 0)}


# ============================================================
# Async background pipeline runner
# ============================================================

def is_area_cached(area: str) -> bool:
    """Check if an area already has indexed data (docs + chroma).

    Returns True if both the cleaned docs file exists AND ChromaDB has entries
    for this area's kecamatan.
    """
    docs_path = ROOT / "data" / "cleaned" / f"{area}_docs.json"
    if not docs_path.exists():
        return False
    # Quick check: docs file has content
    try:
        if docs_path.stat().st_size < 10:
            return False
    except OSError:
        return False
    return True


def _resolve_kecamatan(area: str, regency: Optional[str] = None) -> Optional[str]:
    """Determine the kecamatan filter for a search.

    When a regency is supplied (the session/switcher flow), look the district up
    inside that regency for an EXACT match. This avoids the geo-router's
    direct-resolve mis-hits (e.g. "Buahbatu" fuzzy-matched to "Blahbatuh, Gianyar"
    instead of "Buahbatu, Bandung" — see RCA-007 / RCA-004).

    Without a regency, fall back to direct resolve: a regency-level area
    (multiple districts) → None (search all); a single district → its name.
    """
    if regency:
        regency_geo = resolve_area(regency)
        for d in regency_geo.get("districts", []):
            if d.get("name", "").lower() == area.lower():
                return d.get("name", area)
        # not found inside the regency — fall through to direct resolve

    geo = resolve_area(area)
    districts = geo.get("districts", [])
    if len(districts) > 1:
        return None  # regency-level: search across all kecamatan
    if len(districts) == 1:
        return districts[0].get("name", area)
    return area


def search_and_rank(
    query: str,
    area: str,
    top_k: int = 5,
    regency: Optional[str] = None,
    user_lat: Optional[float] = None,
    user_lon: Optional[float] = None,
    radius_km: Optional[float] = None,
) -> List[Dict[str, Any]]:
    kec_filter = _resolve_kecamatan(area, regency)
    if user_lat is not None and user_lon is not None:
        print(f"[/search] RADIUS query: area={area} lat={user_lat} lon={user_lon} radius_km={radius_km}", flush=True)
    try:
        rag = _rag()
        # POI/radius queries: widen the candidate pool to ALL kos (not just
        # top-N by embedding similarity, which can exclude the closest kos if
        # their text isn't semantically similar to the landmark name).
        is_poi = user_lat is not None and user_lon is not None
        search_top_k = 500 if is_poi else max(top_k * 3, 30)
        results = rag.search(
            query_text=query,
            kecamatan=kec_filter,
            top_k=search_top_k,
            user_lat=user_lat,
            user_lon=user_lon,
            radius_km=radius_km,
        )
        ranked = rag.rank(results, user_lat=user_lat, user_lon=user_lon, proximity_first=is_poi)
    except Exception:
        return []
    return [
        {"metadata": r["metadata"], "score": r.get("score", 0), "text": r.get("text", "")[:1000]}
        for r in ranked[:top_k]
    ]


def format_results(results: List[Dict[str, Any]], query: str, chat_history: Optional[List[Dict[str, str]]] = None) -> str:
    if not results:
        return f"No results for: {query}"
    try:
        out = _rag().summarize(query, results[:10], chat_history=chat_history)
        return out or _format_fallback(results, query)
    except Exception:
        return _format_fallback(results, query)


def format_results_stream(results: List[Dict[str, Any]], query: str, chat_history: Optional[List[Dict[str, str]]] = None):
    """Stream summary tokens from the in-process rag-engine (Sprint 8).

    `summarize_stream()` is a sync generator yielding str tokens. We keep this
    wrapper a sync generator too — the search endpoint bridges it to the async
    event loop via a thread + queue (see `_stream_response` in search.py). Falls
    back to a single chunk on failure so the client always gets a summary.
    """
    if not results:
        yield f"No results for: {query}"
        return
    try:
        for token in _rag().summarize_stream(query, results[:10], chat_history=chat_history):
            yield token
    except Exception:
        yield _format_fallback(results, query)


def _format_fallback(results: List[Dict], query: str) -> str:
    lines = [f"Pencarian: {query}", ""]
    for i, r in enumerate(results[:10], 1):
        m = r.get("metadata", r)
        lines.append(f"{i}. {m.get('name', '')} — {m.get('rating', 0)}★ ({m.get('review_count', 0)} reviews)")
    return "\n".join(lines)


def load_area(district: str, regency: Optional[str] = None, load_all: bool = False) -> Dict[str, Any]:
    """Load the full kos dataset for a district (session browse set).

    Runs the pipeline (cached after first run), then returns ALL kos for the
    district plus the sibling districts in the same regency (for the UI switcher).

    When a regency is supplied (the switcher flow), the district is looked up
    inside that regency rather than resolved directly. This sidesteps the
    geo-router POI classifier, which mislabels real kecamatan like "Taman Sari"
    (contains the POI word "taman") as Points of Interest.

    When load_all=True and regency resolves to multiple districts, loads ALL
    kos across every district in the regency (cross-district search).
    """
    resolved_regency = ""
    province = ""
    regency_districts: List[Dict[str, Any]] = []
    matched_district: Optional[Dict[str, Any]] = None

    if regency:
        regency_geo = resolve_area(regency)
        resolved_regency = regency_geo.get("regency", regency)
        province = regency_geo.get("province", "")
        regency_districts = regency_geo.get("districts", [])
        for d in regency_districts:
            if d.get("name", "").lower() == district.lower():
                matched_district = d
                break

    if matched_district is None:
        # Direct resolve (no regency, or name not found in regency).
        geo = resolve_area(district)
        if geo.get("type") == "POI":
            return {
                "success": False,
                "error": f"'{district}' is a Point of Interest, not an area.",
            }
        if not resolved_regency:
            resolved_regency = geo.get("regency", "") or regency or ""
        if not province:
            province = geo.get("province", "")
        ds = geo.get("districts", [])
        matched_district = ds[0] if ds else None
        # If we didn't already have siblings from a regency resolve, try once now.
        if not regency_districts and resolved_regency:
            rg = resolve_area(resolved_regency)
            regency_districts = rg.get("districts", [])
            if not province:
                province = rg.get("province", province)

    # Cross-district: load all districts in the regency
    if load_all and regency_districts and len(regency_districts) > 1:
        return _load_all_districts(regency_districts, resolved_regency, province)

    if not matched_district:
        return {"success": False, "error": f"District '{district}' not found."}

    postal_codes: list = list(matched_district.get("postalCodes", []))
    if not postal_codes:
        return {"success": False, "error": f"No postal codes found for '{district}'"}

    resolved_district = matched_district.get("name", district)

    pipeline: Dict[str, Any] = {
        "area": resolved_district,
        "regency": resolved_regency,
        "province": province,
    }

    scrape_result = ensure_scraped(resolved_district, postal_codes)
    if scrape_result["status"] == "error":
        return {"success": False, "error": f"Scrape failed: {scrape_result.get('message')}"}
    pipeline["scrape"] = scrape_result["status"]
    if "scrape_age_days" in scrape_result:
        pipeline["scrape_age_days"] = scrape_result["scrape_age_days"]

    proc_result = ensure_processed(resolved_district)
    if proc_result["status"] == "error":
        return {"success": False, "error": f"Processing failed: {proc_result.get('message')}"}
    pipeline["process"] = proc_result["status"]

    idx_result = ensure_indexed(resolved_district)
    if idx_result["status"] == "error":
        return {"success": False, "error": f"Indexing failed: {idx_result.get('message')}"}
    pipeline["index"] = f"{idx_result.get('new', 0)} new, {idx_result.get('skipped', 0)} skipped"

    # Sibling districts in the same regency (for the UI switcher)
    siblings: List[Dict[str, Any]] = []
    if len(regency_districts) > 1:
        siblings = [
            {"name": d.get("name", ""), "postalCodes": d.get("postalCodes", [])}
            for d in regency_districts
        ]

    raw_items = _list_kos(resolved_district)
    dataset = _format_kos_items(raw_items)

    return {
        "success": True,
        "district": resolved_district,
        "regency": resolved_regency,
        "province": province,
        "siblings": siblings,
        "dataset": dataset,
        "pipeline": pipeline,
    }


def _load_all_districts(regency_districts: List[Dict[str, Any]], regency: str, province: str) -> Dict[str, Any]:
    """Cross-district browse: load kos from ALL **already-cached** districts in
    the regency. Does NOT scrape — districts that haven't been scraped yet are
    skipped (returned as `skipped_districts`). This keeps the request fast and
    non-blocking; uncached districts are scraped via the normal async pipeline
    when the user loads them individually."""
    all_items: List[Dict[str, Any]] = []
    skipped: List[str] = []

    for d in regency_districts:
        name = d.get("name", "")
        if not name:
            continue
        if not is_area_cached(name):
            skipped.append(name)
            continue
        try:
            raw = _list_kos(name)
            items = _format_kos_items(raw)
            all_items.extend(items)
        except Exception:
            skipped.append(name)
            continue

    siblings = [
        {"name": d.get("name", ""), "postalCodes": d.get("postalCodes", [])}
        for d in regency_districts
    ]

    loaded = len(regency_districts) - len(skipped)
    return {
        "success": True,
        "district": regency,
        "regency": regency,
        "province": province,
        "siblings": siblings,
        "dataset": all_items,
        "pipeline": {
            "area": regency,
            "regency": regency,
            "province": province,
            "scrape": f"{loaded}/{len(regency_districts)} districts cached",
        },
        "skipped_districts": skipped if skipped else None,
        # keep the old field name for any client still reading it
        "failed_districts": skipped if skipped else None,
    }


def _list_kos(kecamatan: str) -> List[Dict[str, Any]]:
    """Return all kos for a kecamatan via in-process rag-engine (metadata only, no embedding)."""
    try:
        return _rag().list_kos(kecamatan=kecamatan, limit=500)
    except Exception:
        return []


# ============================================================
# Async pipeline runner — non-blocking scrape→process→index
# ============================================================

async def run_pipeline_background(area: str, postal_codes: List[int], force: bool = False):
    """Run the full pipeline (scrape→process→index) without blocking the event loop.

    Existing sync functions are wrapped via asyncio.to_thread() so Uvicorn can
    keep serving HTTP requests while the pipeline runs. PipelineState is updated
    at each stage for the status endpoint.
    """
    state = get_pipeline_state()
    try:
        # Stage 1: Scrape
        state.status = "scraping"
        state.progress = f"Scraping {len(postal_codes)} postal codes for {area}..."
        scrape_result = await asyncio.to_thread(ensure_scraped, area, postal_codes, force)
        if scrape_result["status"] == "error":
            state.progress = f"Scrape failed: {scrape_result.get('message', '')}"
            return

        # Stage 2: Process
        state.status = "processing"
        state.progress = f"Processing scraped data for {area}..."
        proc_result = await asyncio.to_thread(ensure_processed, area)
        if proc_result["status"] == "error":
            state.progress = f"Processing failed: {proc_result.get('message', '')}"
            return

        # Stage 3: Index
        state.status = "indexing"
        state.progress = f"Indexing {area} to ChromaDB..."
        idx_result = await asyncio.to_thread(ensure_indexed, area)
        if idx_result["status"] == "error":
            state.progress = f"Indexing failed: {idx_result.get('message', '')}"
            return

        new = idx_result.get("new", 0)
        skipped = idx_result.get("skipped", 0)
        state.progress = f"Done: {new} new, {skipped} skipped for {area}"
    except Exception as exc:
        state.progress = f"Pipeline error: {exc}"
    finally:
        state.finish()


# ============================================================
# Sprint 9 — Pipeline action runners (Index / Rebuild / Rescrape)
# All async + non-blocking. Reuse the single pipeline slot (Sprint 6).
# ============================================================

async def run_index_background(area: str) -> None:
    """Process + index an already-scraped area (skip scrape). Cheap remediation
    for `scraped && !indexed` areas. Safe to run after RCA-029 (ensure_processed
    now reprocesses empty docs files)."""
    state = get_pipeline_state()
    try:
        state.status = "processing"
        state.progress = f"Processing {area}..."
        proc = await asyncio.to_thread(ensure_processed, area)
        if proc["status"] == "error":
            state.progress = f"Processing failed: {proc.get('message', '')}"
            return
        state.status = "indexing"
        state.progress = f"Indexing {area}..."
        idx = await asyncio.to_thread(ensure_indexed, area)
        if idx["status"] == "error":
            state.progress = f"Indexing failed: {idx.get('message', '')}"
            return
        state.progress = f"Done: {idx.get('new', 0)} new, {idx.get('skipped', 0)} skipped"
    except Exception as exc:
        state.progress = f"Pipeline error: {exc}"
    finally:
        state.finish()


async def run_rebuild_background(area: str) -> None:
    """Reprocess + reingest (per-area). The "fix data" tool: rebuild docs from
    the existing raw data and re-embed them, WITHOUT re-scraping Google Maps.
    Use after a data-processor change, RCA-020 (kecamatan), RCA-029 (empty docs).
    Per-area delete (NOT global ingest force)."""
    state = get_pipeline_state()
    try:
        docs_path = ROOT / "data" / "cleaned" / f"{area}_docs.json"

        def _clear() -> int:
            docs_path.unlink(missing_ok=True)  # force ensure_processed to reprocess
            return _rag().delete_area_from_index(area)

        state.status = "rebuilding"
        state.progress = f"Clearing old index for {area}..."
        removed = await asyncio.to_thread(_clear)

        state.status = "processing"
        state.progress = f"Re-processing {area} (removed {removed} old)..."
        proc = await asyncio.to_thread(ensure_processed, area)
        if proc["status"] == "error":
            state.progress = f"Processing failed: {proc.get('message', '')}"
            return

        state.status = "indexing"
        state.progress = f"Indexing {area}..."
        idx = await asyncio.to_thread(ensure_indexed, area)
        if idx["status"] == "error":
            state.progress = f"Indexing failed: {idx.get('message', '')}"
            return
        state.progress = f"Done: rebuilt {idx.get('new', 0)} docs for {area}"
    except Exception as exc:
        state.progress = f"Pipeline error: {exc}"
    finally:
        state.finish()


async def run_rescrape_background(area: str, postal_codes: List[int]) -> None:
    """Full re-scrape → process → index. Per-area delete first (clean slate),
    then a fresh Google Maps scrape. Expensive (rate-limit risk); admin-only and
    rare."""
    state = get_pipeline_state()
    try:
        state.status = "rebuilding"
        state.progress = f"Clearing old data for {area}..."
        await asyncio.to_thread(lambda: _rag().delete_area_from_index(area))

        state.status = "scraping"
        state.progress = f"Re-scraping {len(postal_codes)} postal codes for {area}..."
        scrape = await asyncio.to_thread(ensure_scraped, area, postal_codes, True)
        if scrape["status"] == "error":
            state.progress = f"Scrape failed: {scrape.get('message', '')}"
            return

        state.status = "processing"
        state.progress = f"Processing {area}..."
        proc = await asyncio.to_thread(ensure_processed, area)
        if proc["status"] == "error":
            state.progress = f"Processing failed: {proc.get('message', '')}"
            return

        state.status = "indexing"
        state.progress = f"Indexing {area}..."
        idx = await asyncio.to_thread(ensure_indexed, area)
        if idx["status"] == "error":
            state.progress = f"Indexing failed: {idx.get('message', '')}"
            return
        state.progress = f"Done: re-scraped, {idx.get('new', 0)} new docs for {area}"
    except Exception as exc:
        state.progress = f"Pipeline error: {exc}"
    finally:
        state.finish()
