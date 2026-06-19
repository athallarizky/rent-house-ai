"""Composite ranking for search results."""

from typing import List, Dict, Any, Optional


def rank(
    results: List[Dict[str, Any]],
    user_lat: Optional[float] = None,
    user_lon: Optional[float] = None,
    weight_distance: float = 0.15,
    weight_rating: float = 0.35,
    weight_review_count: float = 0.20,
    weight_tag_match: float = 0.30,
) -> List[Dict[str, Any]]:
    max_rating = 5.0
    max_reviews = 200.0
    max_distance = 10.0

    for item in results:
        meta = item["metadata"]
        score = 0.0

        rating = meta.get("rating", 0)
        score += weight_rating * (rating / max_rating)

        review_count = meta.get("review_count", 0)
        score += weight_review_count * min(review_count / max_reviews, 1.0)

        tags = meta.get("tags", "")
        tag_count = len(tags.split("|")) if tags else 0
        score += weight_tag_match * min(tag_count / 10.0, 1.0)

        if user_lat is not None and user_lon is not None:
            from .search import haversine_km
            ilat = meta.get("lat", 0)
            ilon = meta.get("lon", 0)
            if ilat and ilon:
                dist = haversine_km(user_lat, user_lon, ilat, ilon)
                score += weight_distance * (1.0 - min(dist / max_distance, 1.0))

        item["score"] = round(score, 4)

    results.sort(key=lambda x: x.get("score", 0), reverse=True)
    return results
