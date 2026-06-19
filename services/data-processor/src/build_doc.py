"""Build RAG document text from a normalized kos entry."""

from typing import Dict, Any, List


def build_document(entry: Dict[str, Any], max_reviews: int = 20) -> Dict[str, Any]:
    name = entry.get("name", "")
    address = entry.get("address", "")
    kecamatan = entry.get("kecamatan", "")
    kelurahan = entry.get("kelurahan", "")
    province = entry.get("province", "")
    postal_code = entry.get("postal_code", "")
    rating = entry.get("rating", 0)
    review_count = entry.get("review_count", 0)
    tags = entry.get("tags", [])
    gender = entry.get("gender", "")
    is_24h = entry.get("is_24h", False)
    phone = entry.get("phone") or ""
    website = entry.get("website") or ""
    maps_url = entry.get("maps_url") or ""

    reviews = entry.get("reviews", [])
    usable = _select_reviews(reviews, max_reviews)

    parts: List[str] = []
    parts.append(f"## {name}")

    addr_parts = [address]
    for extra in [kelurahan, kecamatan, province, postal_code]:
        if extra and extra not in address:
            addr_parts.append(extra)
    parts.append("Alamat: " + ", ".join(addr_parts))

    parts.append(f"Rating: {rating}/5 dari {review_count} reviews")

    if tags:
        parts.append(f"Fasilitas: {', '.join(tags)}")
    if gender:
        parts.append(f"Tipe asrama: {gender}")
    if is_24h:
        parts.append("Akses: 24 jam")

    if usable:
        parts.append("Review tamu:")
        for r in usable:
            stars = r.get("rating", 0)
            text = r.get("text", "")
            parts.append(f"[{stars}★] {text}")

    doc = {
        "doc_id": entry.get("place_id", ""),
        "text": "\n".join(parts),
        "metadata": {
            "place_id": entry.get("place_id", ""),
            "name": name,
            "kecamatan": kecamatan,
            "kelurahan": kelurahan,
            "province": province,
            "postal_code": postal_code,
            "lat": entry.get("lat", 0),
            "lon": entry.get("lon", 0),
            "rating": rating,
            "review_count": review_count,
            "tags": "|".join(tags) if tags else "",
            "gender": gender,
            "is_24h": is_24h,
            "phone": phone,
            "website": website,
            "maps_url": maps_url,
        },
    }

    return doc


def _select_reviews(reviews: List[Dict], max_count: int) -> List[Dict]:
    from .extract import is_usable_review

    usable = [r for r in reviews if is_usable_review(r.get("text", ""))]
    if len(usable) <= max_count:
        return usable

    sorted_reviews = sorted(usable, key=lambda r: r.get("rating", 0))
    worst = sorted_reviews[: max_count // 2]
    best = sorted_reviews[-max_count // 2 :]
    selected = worst + best

    seen = set()
    result = []
    for r in selected:
        text = r.get("text", "")
        if text not in seen:
            seen.add(text)
            result.append(r)
    return result
