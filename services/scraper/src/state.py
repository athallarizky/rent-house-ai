"""Per-postal-code scrape-state manifest.

Persists which postal codes for an area are waiting / running / completed /
failed so that:

  - the pipeline dashboard can show live per-code progress (the dropdown), and
  - a resume / retry run only re-scrapes codes that are missing or failed
    (instead of restarting the whole area from scratch).

The manifest lives at ``data/raw/<area>/_scrape_state.json`` and is written
atomically (tmp + os.replace) on every transition by the scrape subprocess
(`services/scraper/src/run.py`). The API process reads it directly over the
shared filesystem — no IPC needed.

Schema::

    {
      "area": "cengkareng",
      "status": "scraping",            # scraping | completed | partial | failed
      "updated_at": 1782...,           # epoch seconds
      "codes": [
        {"code": 11111, "status": "completed", "count": 64, "updated_at": ...},
        {"code": 22222, "status": "running",  "count": 0,  "updated_at": ...},
        {"code": 33333, "status": "failed",   "count": 0,
         "error": "Scraper failed ...", "updated_at": ...}
      ]
    }
"""

import json
import os
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .cache import RAW_DIR

MANIFEST_NAME = "_scrape_state.json"


def _state_path(area: str) -> Path:
    return RAW_DIR / area / MANIFEST_NAME


def _now() -> float:
    return time.time()


def _atomic_write(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w") as f:
        json.dump(data, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def read_state(area: str) -> Optional[Dict[str, Any]]:
    path = _state_path(area)
    if not path.exists():
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _compute_status(codes: List[Dict[str, Any]]) -> str:
    if not codes:
        return "failed"
    statuses = [c.get("status") for c in codes]
    has_failed = "failed" in statuses
    has_completed = "completed" in statuses
    if not has_failed and all(s == "completed" for s in statuses):
        return "completed"
    if has_completed and has_failed:
        return "partial"
    return "failed"


def init_state(area: str, postal_codes: List[int]) -> Dict[str, Any]:
    """Begin a fresh scrape: every code -> waiting, top-level -> scraping."""
    now = _now()
    data = {
        "area": area,
        "status": "scraping",
        "updated_at": now,
        "codes": [
            {"code": int(c), "status": "waiting", "count": 0, "updated_at": now}
            for c in postal_codes
        ],
    }
    _atomic_write(_state_path(area), data)
    return data


def ensure_codes(
    area: str,
    postal_codes: List[int],
    is_complete: Callable[[int], bool],
    count_for: Callable[[int], int],
) -> Dict[str, Any]:
    """Make sure the manifest tracks every requested postal code.

    On a resume run the manifest usually already exists with the same codes —
    in that case this is a no-op. If the requested code set differs from the
    stored one (e.g. the geo-router resolved extra codes), the new codes are
    appended (marked ``completed`` when a complete JSONL already exists on disk,
    else ``waiting``). Creates the manifest if it doesn't exist yet.

    ``is_complete`` / ``count_for`` are supplied by the caller (cache layer) so
    this module stays free of cache imports.
    """
    data = read_state(area)
    if data is None:
        return init_state(area, postal_codes)
    have = {c["code"] for c in data.get("codes", [])}
    now = _now()
    for code in postal_codes:
        if int(code) not in have:
            done = bool(is_complete(int(code)))
            data["codes"].append(
                {
                    "code": int(code),
                    "status": "completed" if done else "waiting",
                    "count": int(count_for(int(code))) if done else 0,
                    "updated_at": now,
                }
            )
    data["updated_at"] = now
    _atomic_write(_state_path(area), data)
    return data


def _update(area: str, mutate: Callable[[Dict[str, Any]], None]) -> None:
    data = read_state(area)
    if data is None:
        return
    mutate(data)
    data["updated_at"] = _now()
    _atomic_write(_state_path(area), data)


def mark_running(area: str, code: int) -> None:
    def m(data: Dict[str, Any]) -> None:
        for c in data.get("codes", []):
            if c["code"] == int(code):
                c["status"] = "running"
                c["updated_at"] = _now()

    _update(area, m)


def mark_completed(area: str, code: int, count: int) -> None:
    def m(data: Dict[str, Any]) -> None:
        for c in data.get("codes", []):
            if c["code"] == int(code):
                c["status"] = "completed"
                c["count"] = int(count)
                c.pop("error", None)
                c["updated_at"] = _now()

    _update(area, m)


def mark_failed(area: str, code: int, error: str) -> None:
    def m(data: Dict[str, Any]) -> None:
        for c in data.get("codes", []):
            if c["code"] == int(code):
                c["status"] = "failed"
                c["error"] = (error or "")[:500]
                c["updated_at"] = _now()

    _update(area, m)


def finalize(area: str) -> str:
    """Set top-level status from per-code results. Returns that status."""
    data = read_state(area)
    if data is None:
        return "failed"
    status = _compute_status(data.get("codes", []))
    data["status"] = status
    data["updated_at"] = _now()
    _atomic_write(_state_path(area), data)
    return status


def reconcile(area: str, active: bool) -> None:
    """Repair a manifest left mid-run by a crash / kill.

    If no scrape is currently active for this area but the manifest still says
    ``scraping``, any ``running`` / ``waiting`` codes never finished — mark them
    ``failed`` (with a reason) and recompute the top-level status.
    """
    data = read_state(area)
    if data is None:
        return
    if active or data.get("status") != "scraping":
        return
    now = _now()
    for c in data.get("codes", []):
        if c.get("status") in ("running", "waiting"):
            c["status"] = "failed"
            if not c.get("error"):
                c["error"] = "Dihentikan — proses scrape berakhir sebelum kodepos ini selesai"
            c["updated_at"] = now
    data["status"] = _compute_status(data.get("codes", []))
    data["updated_at"] = now
    _atomic_write(_state_path(area), data)


def failed_codes(area: str) -> List[int]:
    data = read_state(area)
    if data is None:
        return []
    return [c["code"] for c in data.get("codes", []) if c.get("status") == "failed"]


def remove_state(area: str) -> None:
    """Delete the manifest (e.g. on a wipe-raw delete)."""
    try:
        _state_path(area).unlink(missing_ok=True)
    except OSError:
        pass
