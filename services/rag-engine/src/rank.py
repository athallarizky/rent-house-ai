"""Composite ranking for search results."""

import math
from typing import List, Dict, Any, Optional


def rank(
    results: List[Dict[str, Any]],
    user_lat: Optional[float] = None,
    user_lon: Optional[float] = None,
    weight_distance: float = 0.15,
    weight_rating: float = 0.35,
    weight_review_count: float = 0.20,
    weight_tag_match: float = 0.30,
    proximity_first: bool = False,
) -> List[Dict[str, Any]]:
    """Rank results by a composite score.

    When ``proximity_first`` is True (POI/radius queries like "kos sekitar X"),
    distance dominates the score with exponential decay (500m half-life) so the
    closest kos always wins, with rating/reviews as tiebreakers. When False
    (semantic search like "wifi kenceng ac dingin"), a balanced linear weight is
    used (distance only 15%, rating/reviews/tags carry most of the score).
    """
    max_rating = 5.0
    max_reviews = 200.0

    for item in results:
        meta = item["metadata"]
        rating = meta.get("rating", 0)
        review_count = meta.get("review_count", 0)
        tags = meta.get("tags", "")
        tag_count = len(tags.split("|")) if tags else 0

        rating_score = rating / max_rating
        review_score = min(review_count / max_reviews, 1.0)
        tag_score = min(tag_count / 10.0, 1.0)

        has_geo = (
            user_lat is not None
            and user_lon is not None
            and meta.get("lat")
            and meta.get("lon")
        )

        if proximity_first and has_geo:
            from .search import haversine_km

            dist = haversine_km(user_lat, user_lon, meta["lat"], meta["lon"])
            # Exponential decay: 0m=1.0, 500m=0.37, 1km=0.14, 2km=0.02.
            # Close kos dominate; far kos fade fast (appropriate for "sekitar X").
            proximity = math.exp(-dist / 0.5)
            score = (
                0.65 * proximity      # distance is the primary intent
                + 0.15 * rating_score  # rating as secondary
                + 0.10 * review_score
                + 0.10 * tag_score
            )
        else:
            score = (
                weight_rating * rating_score
                + weight_review_count * review_score
                + weight_tag_match * tag_score
            )
            if has_geo:
                from .search import haversine_km

                dist = haversine_km(user_lat, user_lon, meta["lat"], meta["lon"])
                max_distance = 10.0
                score += weight_distance * (1.0 - min(dist / max_distance, 1.0))

        item["score"] = round(score, 4)

    results.sort(key=lambda x: x.get("score", 0), reverse=True)
    return results
