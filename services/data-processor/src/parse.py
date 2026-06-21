"""Parse JSONL files from Go scraper into clean Python dicts."""

import json
from pathlib import Path
from typing import List, Dict, Any, Optional


def parse_jsonl(path: Path) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                entry = _normalize_entry(entry)
                entries.append(entry)
            except json.JSONDecodeError:
                continue
    return entries


def parse_jsonl_dir(directory: Path) -> List[Dict[str, Any]]:
    entries: List[Dict[str, Any]] = []
    for fpath in sorted(directory.glob("*.jsonl")):
        entries.extend(parse_jsonl(fpath))
    return entries


def _normalize_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    if "longitude" in entry and entry["longitude"]:
        entry["longtitude"] = entry["longitude"]
    if "longtitude" in entry:
        entry["longitude"] = entry["longtitude"]

    entry["user_reviews"] = entry.get("user_reviews") or []
    entry["user_reviews_extended"] = entry.get("user_reviews_extended") or []

    for review in entry["user_reviews"]:
        _normalize_review(review)
    for review in entry["user_reviews_extended"]:
        _normalize_review(review)

    return entry


def _normalize_review(review: Dict[str, Any]) -> None:
    text = review.get("Description") or review.get("text_original") or ""
    review["text"] = text


def extract_review_texts(entry: Dict[str, Any]) -> List[str]:
    texts: List[str] = []
    for r in entry.get("user_reviews", []):
        t = r.get("text", "")
        if t:
            texts.append(t)
    for r in entry.get("user_reviews_extended", []):
        t = r.get("text", "")
        if t:
            texts.append(t)
    return texts


def get_postal_code(entry: Dict[str, Any]) -> Optional[str]:
    ca = entry.get("complete_address", {})
    if isinstance(ca, dict):
        pc = ca.get("postal_code", "")
        if pc:
            return str(pc)
    return None
