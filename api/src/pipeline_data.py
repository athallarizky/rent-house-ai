"""GET /pipeline/data — per-area inventory across raw / cleaned / ChromaDB.
POST /pipeline/{index,rebuild,rescrape,delete} — admin action triggers (Sprint 9).

Scans the three pipeline outputs and fuses them into a single per-area view so
the dashboard can show what's been scraped, processed, and indexed without SSH:

  - data/raw/<area>/*.jsonl        → scraped (postal-code files + record count)
  - data/cleaned/<area>_docs.json  → processed (RAG-ready document count)
  - ChromaDB collection kos_indonesia (metadata.kecamatan) → indexed count

Keyed by area name (which equals the kecamatan name in this system).
"""

import json
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from .auth import require_admin
from .orchestrator import (
    resolve_area,
    run_index_background,
    run_rebuild_background,
    run_rescrape_background,
)
from .pipeline_state import get_pipeline_state

ROOT = Path(__file__).resolve().parent.parent.parent
RAW_DIR = ROOT / "data" / "raw"
CLEANED_DIR = ROOT / "data" / "cleaned"

# Skip parsing individual JSONL files larger than this when counting records
# (see docs/sprint-7/tasks.md risk mitigation). Dir-level scan still counts
# the file as a postal code.
MAX_JSONL_PARSE_BYTES = 10 * 1024 * 1024

router = APIRouter(prefix="/pipeline", tags=["pipeline"])


def _new_area_entry(area: str) -> Dict[str, Any]:
    return {
        "area": area,
        "scraped": False,
        "processed": False,
        "indexed": False,
        "postal_codes": 0,
        "scraped_count": 0,
        "docs_count": None,
        "indexed_count": 0,
        "scrape_date": None,
    }


def _count_jsonl_records(area_dir: Path) -> Tuple[int, int]:
    """Count postal-code files and total lines across all *.jsonl files.

    Returns (postal_codes, scraped_count). Files larger than MAX_JSONL_PARSE_BYTES
    are counted as a postal code but skipped during line counting.
    """
    if not area_dir.exists():
        return 0, 0
    postal_codes = 0
    total = 0
    for path in area_dir.glob("*.jsonl"):
        postal_codes += 1
        try:
            if path.stat().st_size > MAX_JSONL_PARSE_BYTES:
                continue
        except OSError:
            continue
        try:
            with path.open("r", encoding="utf-8", errors="replace") as f:
                for _ in f:
                    total += 1
        except OSError:
            continue
    return postal_codes, total


def _latest_scrape_date(area_dir: Path) -> Optional[float]:
    """Newest mtime among *.jsonl files (epoch seconds), or None."""
    if not area_dir.exists():
        return None
    latest: Optional[float] = None
    for path in area_dir.glob("*.jsonl"):
        try:
            m = path.stat().st_mtime
        except OSError:
            continue
        if latest is None or m > latest:
            latest = m
    return latest


def _count_docs(path: Path) -> Optional[int]:
    """Return number of RAG documents in a *_docs.json file, or None if missing."""
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if isinstance(data, list):
        return len(data)
    return None


def _get_indexed_counts() -> Dict[str, int]:
    """Query ChromaDB in-process and group indexed document counts by metadata.kecamatan.

    Returns a dict keyed by kecamatan name (the "area" in this system); areas
    missing the kecamatan field fall back to "unknown". Returns {} if the model
    bridge / ChromaDB is unavailable (e.g. model not loaded, collection missing).
    """
    try:
        from .rag_bridge import get_collection
        col = get_collection()
        res = col.get(include=["metadatas"])
    except Exception:
        return {}
    counts: Dict[str, int] = {}
    for m in res.get("metadatas", []) or []:
        k = (m or {}).get("kecamatan") or "unknown"
        counts[k] = counts.get(k, 0) + 1
    return counts


@router.get("/data")
async def get_pipeline_data(user: dict = Depends(require_admin)):
    """Scan raw/cleaned/ChromaDB and return the per-area pipeline inventory."""
    areas: Dict[str, Dict[str, Any]] = {}

    # Source 1: raw scraped JSONL
    if RAW_DIR.exists():
        for area_dir in RAW_DIR.iterdir():
            if not area_dir.is_dir():
                continue
            area = area_dir.name
            postal_codes, scraped_count = _count_jsonl_records(area_dir)
            entry = _new_area_entry(area)
            entry["scraped"] = scraped_count > 0
            entry["postal_codes"] = postal_codes
            entry["scraped_count"] = scraped_count
            entry["scrape_date"] = _latest_scrape_date(area_dir)
            areas[area] = entry

    # Source 2: processed docs
    if CLEANED_DIR.exists():
        for path in CLEANED_DIR.glob("*_docs.json"):
            area = path.name[: -len("_docs.json")]
            docs_count = _count_docs(path)
            entry = areas.get(area)
            if entry is None:
                entry = _new_area_entry(area)
                areas[area] = entry
            if docs_count and docs_count > 0:
                entry["processed"] = True
                entry["docs_count"] = docs_count

    # Source 3: ChromaDB indexed counts (grouped by kecamatan)
    for kecamatan, count in _get_indexed_counts().items():
        entry = areas.get(kecamatan)
        if entry is None:
            entry = _new_area_entry(kecamatan)
            areas[kecamatan] = entry
        entry["indexed"] = count > 0
        entry["indexed_count"] = count

    area_list = [areas[k] for k in sorted(areas.keys())]

    totals = {
        "areas": len(area_list),
        "scraped": sum(1 for a in area_list if a["scraped"]),
        "processed": sum(1 for a in area_list if a["processed"]),
        "indexed": sum(1 for a in area_list if a["indexed"]),
        "total_kos": sum(a["indexed_count"] for a in area_list),
    }

    return {
        "areas": area_list,
        "pipeline": get_pipeline_state().state(),
        "totals": totals,
    }


# ============================================================
# Sprint 9 — Admin action triggers (Index / Rebuild / Rescrape / Delete)
# All admin-only. The 3 background actions reuse the single pipeline slot
# (start-or-queue). Delete is synchronous + instant. Never blocks (RCA-028).
# ============================================================

class ActionRequest(BaseModel):
    area: str
    wipe_raw: bool = False  # /delete only: True = also remove data/raw/<area>


def _start_or_queue(area: str, runner_factory, background_tasks: BackgroundTasks) -> dict:
    """Try to start a background action for `area`; queue behind the running one
    if the single slot is occupied. Mirrors the Sprint-6 3-layer check."""
    state = get_pipeline_state()
    if state.running is not None:
        state.queue(area)
        return {
            "success": False,
            "pipeline_queued": True,
            "message": f"Action untuk '{area}' antri di belakang '{state.running}'.",
            "pipeline": state.state(),
        }
    if not state.start(area):
        return {
            "success": False,
            "pipeline_blocked": True,
            "message": "Pipeline slot sibuk, coba lagi sebentar.",
            "pipeline": state.state(),
        }
    background_tasks.add_task(runner_factory, area)
    return {
        "success": True,
        "pipeline_started": True,
        "message": f"Action dimulai untuk '{area}'. Poll /pipeline/status.",
        "pipeline": state.state(),
    }


def _postal_codes_for(area: str) -> list:
    """Resolve postal codes for an area via the geo-router (needed for rescrape)."""
    geo = resolve_area(area)
    codes: list = []
    for d in geo.get("districts", []):
        codes.extend(d.get("postalCodes", []))
    return codes


@router.post("/index")
async def trigger_index(req: ActionRequest, background_tasks: BackgroundTasks, user: dict = Depends(require_admin)):
    """Process + index an already-scraped area (skip scrape). Admin only."""
    return _start_or_queue(req.area, run_index_background, background_tasks)


@router.post("/rebuild")
async def trigger_rebuild(req: ActionRequest, background_tasks: BackgroundTasks, user: dict = Depends(require_admin)):
    """Reprocess + reingest (fix data) without re-scraping. Admin only."""
    return _start_or_queue(req.area, run_rebuild_background, background_tasks)


@router.post("/rescrape")
async def trigger_rescrape(req: ActionRequest, background_tasks: BackgroundTasks, user: dict = Depends(require_admin)):
    """Full re-scrape → process → index. Admin only. Expensive (Google Maps)."""
    postal_codes = _postal_codes_for(req.area)
    if not postal_codes:
        raise HTTPException(400, f"Tidak ada postal code untuk '{req.area}'.")
    return _start_or_queue(req.area, lambda a: run_rescrape_background(a, postal_codes), background_tasks)


@router.post("/delete")
async def trigger_delete(req: ActionRequest, user: dict = Depends(require_admin)):
    """Delete an area's data. Default: remove from index + cleaned docs (keep raw,
    so Rebuild/Index still works). wipe_raw=true also removes data/raw/<area>.
    Instant (synchronous). Admin only."""
    from .rag_bridge import delete_area_from_index

    removed = 0
    try:
        removed = delete_area_from_index(req.area)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"Gagal hapus index: {exc}")

    docs_path = CLEANED_DIR / f"{req.area}_docs.json"
    docs_deleted = docs_path.exists()
    docs_path.unlink(missing_ok=True)

    raw_deleted = False
    if req.wipe_raw:
        raw_dir = RAW_DIR / req.area
        if raw_dir.exists():
            import shutil
            shutil.rmtree(raw_dir)
            raw_deleted = True

    return {
        "success": True,
        "removed_from_index": removed,
        "docs_deleted": docs_deleted,
        "raw_deleted": raw_deleted,
        "message": f"'{req.area}' dihapus dari index ({removed} entries)."
                   + (" Raw data juga dihapus." if raw_deleted else " Raw data dipertahankan."),
    }
