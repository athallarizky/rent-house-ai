"""Enrich entries with kodepos data (kecamatan, kelurahan, province)."""

import json
from pathlib import Path
from typing import Dict, Any, Optional, List

KODEPOS_PATH = Path(__file__).resolve().parent.parent.parent / "geo-router" / "kodepos" / "data" / "kodepos.json"

_kodepos_data: Optional[List[Dict]] = None
_postal_lookup: Optional[Dict[str, Dict]] = None


def _load_kodepos():
    global _kodepos_data, _postal_lookup
    if _kodepos_data is None:
        with open(KODEPOS_PATH) as f:
            _kodepos_data = json.load(f)
        _postal_lookup = {}
        for entry in _kodepos_data:
            code = str(entry["code"])
            if code not in _postal_lookup:
                _postal_lookup[code] = entry


def enrich(entry: Dict[str, Any], area: Optional[str] = None) -> Dict[str, Any]:
    _load_kodepos()

    pc = entry.get("postal_code", "")
    if pc and pc in _postal_lookup:
        kd = _postal_lookup[pc]
        entry["kelurahan"] = kd["village"]
        entry["kecamatan"] = kd["district"]
        entry["regency"] = kd["regency"]
        entry["province"] = kd["province"]
    else:
        entry.setdefault("kelurahan", "")
        # Scraped kos frequently lack a usable postal_code, so the kodepos lookup
        # misses and kecamatan would be empty — making the doc unsearchable by
        # area. Fall back to the scrape area name (process_area always passes it)
        # so docs are at least retrievable under the area they were scraped for.
        entry["kecamatan"] = area or entry.get("kecamatan") or ""
        entry.setdefault("regency", "")
        entry.setdefault("province", "")

    return entry
