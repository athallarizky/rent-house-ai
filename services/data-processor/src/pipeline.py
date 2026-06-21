"""Full data processing pipeline: parse → normalize → enrich → extract → dedup → build docs → validate."""

import json
from pathlib import Path
from typing import Dict, Any, List, Optional

from .parse import parse_jsonl_dir, extract_review_texts, get_postal_code
from .normalize import normalize_phone, normalize_address, normalize_name
from .enrich import enrich
from .extract import detect_tags, detect_gender, detect_is_24h, detect_price
from .dedup import dedup
from .build_doc import build_document
from .validate import validate_all


ROOT = Path(__file__).resolve().parent.parent.parent.parent
RAW_DIR = ROOT / "data" / "raw"
CLEAN_DIR = ROOT / "data" / "cleaned"


def process_area(area: str) -> Dict[str, Any]:
    raw_path = RAW_DIR / area
    if not raw_path.exists():
        raise FileNotFoundError(f"No raw data for area: {area}. Run scraper first.")

    entries = parse_jsonl_dir(raw_path)
    print(f"[{area}] Parsed {len(entries)} entries")

    entries = [_normalize_entry(e) for e in entries]
    print(f"[{area}] Normalized")

    entries = [enrich(e, area) for e in entries]
    print(f"[{area}] Enriched with kodepos")

    entries = [_extract_facilities(e) for e in entries]
    print(f"[{area}] Facilities extracted")

    entries = dedup(entries, proximity_m=10)
    print(f"[{area}] Deduplicated → {len(entries)} unique")

    docs = [build_document(e) for e in entries if e.get("place_id")]
    print(f"[{area}] Built {len(docs)} RAG documents")

    valid_entries, invalid = validate_all(entries)
    print(f"[{area}] Valid: {len(valid_entries)}, Invalid: {len(invalid)}")

    CLEAN_DIR.mkdir(parents=True, exist_ok=True)
    _save_entries(valid_entries, CLEAN_DIR / f"{area}.json")
    _save_docs(docs, CLEAN_DIR / f"{area}_docs.json")

    return {
        "area": area,
        "total_parsed": len(entries),
        "unique": len(valid_entries),
        "docs": len(docs),
        "invalid": len(invalid),
    }


def _normalize_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    entry["name"] = normalize_name(entry.get("title", ""))
    entry["address"] = normalize_address(entry.get("address", ""))
    entry["phone"] = normalize_phone(entry.get("phone", ""))
    entry["lat"] = entry.get("latitude") or entry.get("longtitude") or 0
    entry["lon"] = entry.get("longitude") or entry.get("longtitude") or 0
    entry["postal_code"] = get_postal_code(entry)
    entry["reviews"] = _normalize_reviews(entry)

    entry["review_count"] = entry.get("review_count", len(entry["reviews"]))
    entry["rating"] = entry.get("review_rating", 0)

    entry["maps_url"] = entry.get("link", "")
    entry["website"] = entry.get("web_site", "")

    return entry


def _normalize_reviews(entry: Dict[str, Any]) -> List[Dict[str, Any]]:
    reviews: List[Dict[str, Any]] = []
    for r in entry.get("user_reviews", []):
        if not isinstance(r, dict):
            continue
        text = r.get("text", "") or r.get("Description", "") or ""
        reviews.append({
            "text": text.strip(),
            "rating": r.get("Rating") or r.get("rating") or 0,
            "date": _extract_date(r),
            "author": r.get("Name", ""),
            "language": r.get("language", ""),
        })
    return reviews


def _extract_date(review: Dict[str, Any]) -> str:
    pub = review.get("published_at", "")
    if pub:
        return str(pub)[:10]
    return review.get("When", "")


def _extract_facilities(entry: Dict[str, Any]) -> Dict[str, Any]:
    review_texts = [r.get("text", "") for r in entry.get("reviews", [])]
    all_text = " ".join(review_texts)
    title_text = entry.get("title", "")

    entry["tags"] = detect_tags(all_text, title_text)
    entry["gender"] = detect_gender(all_text, title_text)
    entry["is_24h"] = detect_is_24h(all_text, title_text)

    price = detect_price(all_text, title_text)
    entry["price_min"] = price["min"] if price else None
    entry["price_max"] = price["max"] if price else None

    return entry


def _save_entries(entries: List[Dict], path: Path) -> None:
    cleaned = []
    for e in entries:
        c = {
            "place_id": e.get("place_id", ""),
            "name": e.get("name", ""),
            "address": e.get("address", ""),
            "kelurahan": e.get("kelurahan", ""),
            "kecamatan": e.get("kecamatan", ""),
            "regency": e.get("regency", ""),
            "province": e.get("province", ""),
            "postal_code": e.get("postal_code", ""),
            "lat": e.get("lat", 0),
            "lon": e.get("lon", 0),
            "rating": e.get("rating", 0),
            "review_count": e.get("review_count", 0),
            "tags": e.get("tags", []),
            "gender": e.get("gender", ""),
            "is_24h": e.get("is_24h", False),
            "phone": e.get("phone", ""),
            "website": e.get("website", ""),
            "maps_url": e.get("maps_url", ""),
            "reviews": e.get("reviews", []),
        }
        cleaned.append(c)
    with open(path, "w") as f:
        json.dump(cleaned, f, ensure_ascii=False, indent=2)


def _save_docs(docs: List[Dict], path: Path) -> None:
    with open(path, "w") as f:
        json.dump(docs, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    import sys
    area = sys.argv[1] if len(sys.argv) > 1 else "cengkareng"
    result = process_area(area)
    print(f"\nDone: {result}")
