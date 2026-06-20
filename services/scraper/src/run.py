"""Run the Google Maps scraper binary and collect results."""

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, List, Dict, Any

from .generate import generate_queries, write_queries
from .cache import (
    cache_path,
    all_cached,
    missing_codes,
    stale_codes,
    read_jsonl,
    RAW_DIR,
)

ROOT = Path(__file__).resolve().parent.parent.parent.parent
SCRAPER_BIN = (
    ROOT / "services" / "scraper" / "google-maps-scraper" / "gmaps-scraper"
)


@dataclass
class ScraperConfig:
    depth: int = 1
    concurrency: int = 1
    lang: str = "id"
    json_output: bool = True
    exit_on_inactivity: str = "5m"


def run_scrape(postal_code: int, queries: List[str], area: str, config: ScraperConfig) -> Path:
    queries_path = RAW_DIR / area / f"queries_{postal_code}.txt"
    results_path = cache_path(area, postal_code)

    write_queries(queries, queries_path)

    cmd = [
        str(SCRAPER_BIN),
        "-input", str(queries_path.absolute()),
        "-results", str(results_path.absolute()),
        "-depth", str(config.depth),
        "-c", str(config.concurrency),
        "-lang", config.lang,
        "-exit-on-inactivity", config.exit_on_inactivity,
    ]
    if config.json_output:
        cmd.append("-json")

    print(f"  [{postal_code}] Running scraper...")
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=300,
        cwd=str(ROOT),
    )

    if result.returncode != 0:
        stderr = result.stderr[-500:] if result.stderr else ""
        raise RuntimeError(f"Scraper failed for {postal_code} (exit {result.returncode}): {stderr}")

    if results_path.exists():
        entries = read_jsonl(results_path)
        print(f"  [{postal_code}] Done — {len(entries)} kos, {results_path}")
        return results_path
    else:
        raise RuntimeError(f"No output file produced for {postal_code}")


def scrape_area(
    area: str,
    postal_codes: List[int],
    config: Optional[ScraperConfig] = None,
    force: bool = False,
    stale_days: int = 0,
) -> List[Dict[str, Any]]:
    if config is None:
        config = ScraperConfig()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / area).mkdir(parents=True, exist_ok=True)

    if force:
        to_scrape = list(postal_codes)
    elif stale_days > 0:
        missing = missing_codes(area, postal_codes)
        stale = stale_codes(area, postal_codes, max_age_days=stale_days)
        to_scrape = list(set(missing + stale))
        if not to_scrape:
            print(f"[{area}] All {len(postal_codes)} codes cached and fresh — skipping scrape")
            return _load_cached(area, postal_codes)
        if stale:
            print(f"[{area}] {len(stale)}/{len(postal_codes)} codes stale (> {stale_days}d), re-scraping")
    else:
        if all_cached(area, postal_codes):
            print(f"[{area}] All {len(postal_codes)} postal codes cached — skipping scrape")
            return _load_cached(area, postal_codes)
        to_scrape = missing_codes(area, postal_codes)

    cached = [c for c in postal_codes if c not in to_scrape]
    if cached:
        print(f"[{area}] {len(cached)}/{len(postal_codes)} codes cached, scraping {len(to_scrape)} remaining")

    for code in to_scrape:
        queries = generate_queries([code])
        try:
            run_scrape(code, queries, area, config)
        except Exception as e:
            print(f"  [{code}] FAILED: {e}", file=sys.stderr)

    return _load_cached(area, postal_codes)


def _load_cached(area: str, postal_codes: List[int]) -> List[Dict[str, Any]]:
    all_entries: List[Dict[str, Any]] = []
    for code in postal_codes:
        path = cache_path(area, code)
        if path.exists():
            all_entries.extend(read_jsonl(path))
    print(f"[{area}] Total: {len(all_entries)} entries from {len(postal_codes)} postal codes")
    return all_entries
