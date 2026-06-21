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


def _entry_score(entry: Dict[str, Any]) -> float:
    """Quality score = rating weighted by review volume (log). Used to pick the
    better entry when two distinct place_ids collide on coordinates."""
    rating = entry.get("rating") or entry.get("review_rating") or 0
    rcount = entry.get("review_count") or len(entry.get("reviews", []) or []) or 0
    return float(rating or 0) * math.log1p(rcount or 0)


def dedup(entries: List[Dict[str, Any]], proximity_m: float = 10.0) -> List[Dict[str, Any]]:
    """Dedup by place_id (merges reviews) + coordinate proximity.

    proximity_m is intentionally SMALL (10m default). Indonesian kos are dense —
    distinct kos in the same gang/gedung routinely sit 30–50m apart, which is
    normal, not duplication. A wide threshold (e.g. the old 50m) wrongly merges
    neighbors and silently drops legit kos (e.g. a 4.9★ kos lost to a 4.5★ one
    40m away that happened to be processed first). 10m only catches true
    coordinate-drift duplicates (same place, slightly different coords). On a
    proximity collision the HIGHER-quality entry (rating×reviews) wins, not just
    the first seen.
    """
    seen_pids: set = set()
    unique: List[Dict[str, Any]] = []

    for entry in entries:
        pid = entry.get("place_id", "")
        # 1) Same place_id → same place scraped multiple times → merge reviews.
        if pid and pid in seen_pids:
            _merge_reviews(unique, entry, pid)
            continue

        lat = entry.get("lat") or entry.get("latitude") or 0.0
        lon = entry.get("lon") or entry.get("longitude") or 0.0

        # 2) Coordinate proximity — only at very close range (default 10m).
        collision_idx = -1
        if lat and lon:
            for i, existing in enumerate(unique):
                elat = existing.get("lat") or existing.get("latitude") or 0.0
                elon = existing.get("lon") or existing.get("longitude") or 0.0
                if elat and elon and haversine_km(lat, lon, elat, elon) < (proximity_m / 1000.0):
                    collision_idx = i
                    break

        if collision_idx >= 0:
            # Distinct kos shouldn't collide at 10m; if they do (coord drift or
            # same place with a different place_id), keep the higher-quality one.
            if _entry_score(entry) > _entry_score(unique[collision_idx]):
                unique[collision_idx] = entry
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
