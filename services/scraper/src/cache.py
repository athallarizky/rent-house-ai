"""Cache layer for scraper results. Skips re-scraping if JSONL already exists."""

from pathlib import Path
from typing import List, Dict, Any

ROOT = Path(__file__).resolve().parent.parent.parent.parent
RAW_DIR = ROOT / "data" / "raw"


def cache_path(area: str, postal_code: int) -> Path:
    return RAW_DIR / area / f"{postal_code}.jsonl"


def exists(area: str, postal_code: int) -> bool:
    return cache_path(area, postal_code).exists()


def all_cached(area: str, postal_codes: List[int]) -> bool:
    return all(exists(area, code) for code in postal_codes)


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
