"""Dedup entries by place_id and coordinate proximity."""

import math
from typing import List, Dict, Any


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def dedup(entries: List[Dict[str, Any]], proximity_m: float = 100.0) -> List[Dict[str, Any]]:
    seen_pids: set = set()
    unique: List[Dict[str, Any]] = []

    for entry in entries:
        pid = entry.get("place_id", "")
        if pid and pid in seen_pids:
            _merge_reviews(unique, entry, pid)
            continue

        lat = entry.get("lat") or entry.get("latitude") or 0
        lon = entry.get("lon") or entry.get("longitude") or 0

        is_dup = False
        for existing in unique:
            elat = existing.get("lat") or existing.get("latitude") or 0
            elon = existing.get("lon") or existing.get("longitude") or 0
            if elat and elon and lat and lon:
                dist = haversine_km(lat, lon, elat, elon)
                if dist < (proximity_m / 1000.0):
                    existing["_dup_proximity"] = True
                    is_dup = True
                    break

        if is_dup:
            continue

        if pid:
            seen_pids.add(pid)

        unique.append(entry)

    return unique


def _merge_reviews(unique: List[Dict], new_entry: Dict, pid: str) -> None:
    for existing in unique:
        if existing.get("place_id") == pid:
            existing_reviews = existing.get("reviews", [])
            for r in new_entry.get("reviews", []):
                if r not in existing_reviews:
                    existing_reviews.append(r)
            existing["review_count"] = max(
                existing.get("review_count", 0),
                new_entry.get("review_count", 0),
            )
            return
