"""Regex-based field detectors from review text. Adapted from kosan-jakbar detect.py."""

import re
from typing import Optional, List

_IS_24H = re.compile(
    r"(?:\b|^)(?:24\s*(?:jam|hours?|hrs?|h)|open\s*24)(?:\b|$)",
    re.IGNORECASE,
)

_GENDER_PATTERNS: List[tuple] = [
    (
        "campur",
        re.compile(
            r"\b(?:campur|pria\s*(?:&|dan)\s*wanita|wanita\s*(?:&|dan)\s*pria|mixed)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "putri",
        re.compile(
            r"\b(?:putri|perempuan|wanita|cewek?|khusus\s+(?:wanita|perempuan|cewek?))\b",
            re.IGNORECASE,
        ),
    ),
    (
        "putra",
        re.compile(
            r"\b(?:putra|laki[-\s]?laki|pria|cowok?|khusus\s+(?:pria|laki|cowok?))\b",
            re.IGNORECASE,
        ),
    ),
]

_TAG_PATTERNS: dict[str, re.Pattern] = {
    "wifi": re.compile(r"\bwi[-\s]?fi\b", re.IGNORECASE),
    "ac": re.compile(r"\b(?:ac|air[\s-]?cond(?:itioning)?)\b", re.IGNORECASE),
    "kamar_mandi_dalam": re.compile(r"\bkamar\s+mandi\s+dalam\b", re.IGNORECASE),
    "parkir": re.compile(r"\b(?:parkir|parking)\b", re.IGNORECASE),
    "dapur": re.compile(r"\b(?:dapur|kitchen)\b", re.IGNORECASE),
    "laundry": re.compile(r"\blaundry\b", re.IGNORECASE),
    "tv": re.compile(r"\b(?:tv|televisi)\b", re.IGNORECASE),
    "kasur": re.compile(r"\b(?:kasur|tempat\s+tidur)\b", re.IGNORECASE),
    "lemari": re.compile(r"\b(?:lemari|wardrobe)\b", re.IGNORECASE),
    "listrik": re.compile(r"\b(?:listrik|meteran|token)\b", re.IGNORECASE),
}


def detect_is_24h(*fields: Optional[str]) -> bool:
    for f in fields:
        if f and _IS_24H.search(f):
            return True
    return False


def detect_gender(*fields: Optional[str]) -> Optional[str]:
    hay = " ".join(f for f in fields if isinstance(f, str) and f).lower()
    if not hay:
        return None
    for label, pat in _GENDER_PATTERNS:
        if pat.search(hay):
            return label
    return None


def detect_tags(*fields: Optional[str]) -> List[str]:
    hay = " ".join(f for f in fields if isinstance(f, str) and f).lower()
    if not hay:
        return []
    return [tag for tag, pat in _TAG_PATTERNS.items() if pat.search(hay)]


def is_usable_review(text: str) -> bool:
    if len(text) < 30:
        return False
    noise_patterns = [
        "ada yang kosong", "masih ada kamar", "berapa harga",
        "nomor wa", "hubungi kemana", "ada nomor", "ada kamar kosong",
        "ada yang kosong", "infokan harga", "mau tanya", "apakah masih",
        "mau nanya", "ada kost kosong",
    ]
    lower = text.lower()
    for p in noise_patterns:
        if p in lower:
            return False
    return True
