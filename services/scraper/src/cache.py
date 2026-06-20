"""Cache layer for scraper results. Skips re-scraping if JSONL already exists."""

import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional

ROOT = Path(__file__).resolve().parent.parent.parent.parent
RAW_DIR = ROOT / "data" / "raw"

CACHE_TTL_DAYS = 30


def cache_path(area: str, postal_code: int) -> Path:
    return RAW_DIR / area / f"{postal_code}.jsonl"


def exists(area: str, postal_code: int) -> bool:
    return cache_path(area, postal_code).exists()


def all_cached(area: str, postal_codes: List[int]) -> bool:
    return all(exists(area, code) for code in postal_codes)


def cache_age_days(area: str, postal_code: int) -> Optional[float]:
    path = cache_path(area, postal_code)
    if not path.exists():
        return None
    mtime = datetime.fromtimestamp(os.path.getmtime(path))
    return (datetime.now() - mtime).total_seconds() / 86400


def stale_codes(area: str, postal_codes: List[int], max_age_days: int = CACHE_TTL_DAYS) -> List[int]:
    return [c for c in postal_codes if (age := cache_age_days(area, c)) is not None and age > max_age_days]


def max_cache_age_days(area: str, postal_codes: List[int]) -> float:
    ages = [age for c in postal_codes if (age := cache_age_days(area, c)) is not None]
    return max(ages) if ages else 0.0


def get_cached_files(area: str, postal_codes: List[int]) -> List[Path]:
    return [cache_path(area, code) for code in postal_codes]


def missing_codes(area: str, postal_codes: List[int]) -> List[int]:
    return [code for code in postal_codes if not exists(area, code)]


def read_jsonl(path: Path) -> List[Dict[str, Any]]:
    import json

    entries = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))
    return entries
