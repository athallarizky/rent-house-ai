"""Run the Google Maps scraper binary and collect results.

Per-postal-code progress is persisted to ``data/raw/<area>/_scrape_state.json``
(see ``state.py``) so the dashboard can show live status and a resume run only
re-scrapes codes that are missing or failed.

Output is written atomically: each code scrapes into ``<code>.jsonl.part`` and
is promoted to ``<code>.jsonl`` (via os.replace) only on a clean exit. Thus the
existence of ``<code>.jsonl`` is a reliable "this code is complete" signal — a
run killed mid-code leaves only a ``.part`` (ignored by all readers), so the
next resume correctly re-scrapes it.
"""

import os
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, List, Dict, Any

from .generate import generate_queries, write_queries
from .cache import (
    cache_path,
    exists,
    all_cached,
    missing_codes,
    stale_codes,
    read_jsonl,
    RAW_DIR,
)
from .state import (
    init_state,
    ensure_codes,
    mark_running,
    mark_completed,
    mark_failed,
    finalize,
    read_state,
    failed_codes,
)

ROOT = Path(__file__).resolve().parent.parent.parent.parent
SCRAPER_BIN = (
    ROOT / "services" / "scraper" / "google-maps-scraper" / "gmaps-scraper"
)


@dataclass
class ScraperConfig:
    depth: int = 2
    concurrency: int = 1
    lang: str = "id"
    json_output: bool = True
    exit_on_inactivity: str = "5m"


def run_scrape(postal_code: int, queries: List[str], area: str, config: ScraperConfig) -> Path:
    queries_path = RAW_DIR / area / f"queries_{postal_code}.txt"
    results_path = cache_path(area, postal_code)          # final <code>.jsonl
    part_path = results_path.with_name(results_path.name + ".part")

    # Clear any stale partial left by a previous run killed mid-code.
    part_path.unlink(missing_ok=True)

    write_queries(queries, queries_path)

    cmd = [
        str(SCRAPER_BIN),
        "-input", str(queries_path.absolute()),
        "-results", str(part_path.absolute()),            # scrape INTO the .part file
        "-depth", str(config.depth),
        "-c", str(config.concurrency),
        "-lang", config.lang,
        "-exit-on-inactivity", config.exit_on_inactivity,
    ]
    if config.json_output:
        cmd.append("-json")

    print(f"  [{postal_code}] Running scraper...")
    # start_new_session=True puts the Go child in its own process group, so a
    # per-code timeout (below) can kill the whole tree instead of orphaning it.
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            cwd=str(ROOT),
            start_new_session=True,
        )
    except subprocess.TimeoutExpired as exc:
        part_path.unlink(missing_ok=True)
        raise RuntimeError(f"Scraper timed out after 300s for {postal_code}") from exc

    if result.returncode != 0:
        part_path.unlink(missing_ok=True)
        stderr = result.stderr[-500:] if result.stderr else ""
        raise RuntimeError(f"Scraper failed for {postal_code} (exit {result.returncode}): {stderr}")

    if not part_path.exists():
        raise RuntimeError(f"No output file produced for {postal_code}")

    # Atomic promote: .part -> .jsonl. From now on the code counts as complete.
    os.replace(part_path, results_path)
    return results_path


def scrape_area(
    area: str,
    postal_codes: List[int],
    config: Optional[ScraperConfig] = None,
    force: bool = False,
    stale_days: int = 0,
    only_code: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Scrape one area across its postal codes.

    Modes:
      - ``force=True``            : fresh scrape of every code (manifest reset).
      - ``only_code=<int>``       : retry a single code (resume path); other
                                    codes are left untouched in the manifest.
      - default / ``stale_days>0``: resume — scrape only codes with no complete
        ``.jsonl`` or previously marked failed (and stale ones if stale_days>0).
    """
    if config is None:
        config = ScraperConfig()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / area).mkdir(parents=True, exist_ok=True)

    def _count(code: int) -> int:
        return len(read_jsonl(cache_path(area, code))) if exists(area, code) else 0

    # 1. Manifest: reset on force, otherwise sync/reuse (keeps completed codes).
    if force:
        init_state(area, postal_codes)
    else:
        ensure_codes(area, postal_codes, lambda c: exists(area, c), _count)

    # 2. Decide which codes to scrape.
    if force:
        to_scrape = list(postal_codes)
    elif only_code is not None:
        to_scrape = [] if exists(area, only_code) else [only_code]
        if only_code not in postal_codes:
            to_scrape = []  # safety: code doesn't belong to this area
    else:
        missing = missing_codes(area, postal_codes)
        failed = failed_codes(area)
        stale = stale_codes(area, postal_codes, max_age_days=stale_days) if stale_days > 0 else []
        to_scrape = list({*missing, *failed, *stale})
        # Reflect already-complete codes in the manifest (counts from disk).
        for code in postal_codes:
            if code not in to_scrape and exists(area, code):
                mark_completed(area, code, _count(code))

    cached = [c for c in postal_codes if c not in to_scrape]
    if not to_scrape:
        print(f"[{area}] All {len(postal_codes)} codes already complete — nothing to scrape")
        finalize(area)
        return _load_cached(area, postal_codes)

    if cached:
        print(f"[{area}] {len(cached)}/{len(postal_codes)} codes cached, scraping {len(to_scrape)} remaining")
    else:
        print(f"[{area}] Scraping {len(to_scrape)}/{len(postal_codes)} postal codes")

    # 3. Scrape, updating the manifest per code (non-fatal per-code failures).
    for code in to_scrape:
        queries = generate_queries([code])
        mark_running(area, code)
        try:
            path = run_scrape(code, queries, area, config)
            entries = read_jsonl(path)
            mark_completed(area, code, len(entries))
            print(f"  [{code}] Done — {len(entries)} kos")
        except Exception as e:  # noqa: BLE001 — record + continue with next code
            mark_failed(area, code, str(e))
            print(f"  [{code}] FAILED: {e}", file=sys.stderr)

    finalize(area)
    return _load_cached(area, postal_codes)


def _load_cached(area: str, postal_codes: List[int]) -> List[Dict[str, Any]]:
    all_entries: List[Dict[str, Any]] = []
    for code in postal_codes:
        path = cache_path(area, code)
        if path.exists():
            all_entries.extend(read_jsonl(path))
    print(f"[{area}] Total: {len(all_entries)} entries from {len(postal_codes)} postal codes")
    return all_entries
