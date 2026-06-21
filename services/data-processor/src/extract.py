"""Regex-based field detectors from review text. Adapted from kosan-jakbar detect.py."""

import re
from typing import Optional, List, Dict

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

_PRICE_UNIT: Dict[str, int] = {
    "jt": 1_000_000, "juta": 1_000_000, "jutaan": 1_000_000, "jt-an": 1_000_000,
    "rb": 1_000, "ribu": 1_000, "rbu": 1_000, "perak": 1_000, "k": 1_000,
}

_PRICE_RANGE_RE = re.compile(
    r"(?:harga(?:nya)?|biaya|sewa|bayar)\b.{0,60}?"
    r"(\d+[.,]?\d*)\s*(jt|juta|jutaan|jt-an|rb|ribu|rbu|k)?"
    r"\s*(?:[-–—]|s/d|s\.?d|sampai|hingga|sampai\s+dengan)\s*"
    r"(?:rp[.\s]*)?(\d+[.,]?\d*)\s*(jt|juta|jutaan|jt-an|rb|ribu|rbu|k)?",
    re.IGNORECASE,
)

_PRICE_SINGLE_RE = re.compile(
    r"(?:harga(?:nya)?|biaya|sewa|bayar)\b.{0,40}?"
    r"(\d+[.,]?\d*)\s*(jt|juta|jutaan|jt-an|rb|ribu|rbu|k)?"
    r"(?:\s*(?:an|per\s*bulan|per\s*month|/bulan))?",
    re.IGNORECASE,
)


def _parse_amount(value_str: str, unit_str: Optional[str]) -> int:
    clean = value_str.replace(",", ".")
    value = float(clean)
    if unit_str:
        value *= _PRICE_UNIT.get(unit_str.lower(), 1)
    return int(value)


def detect_price(*fields: Optional[str]) -> Optional[Dict[str, Optional[int]]]:
    haystack = " ".join(f for f in fields if isinstance(f, str) and f).lower()
    if not haystack:
        return None

    m = _PRICE_RANGE_RE.search(haystack)
    if m:
        unit1, unit2 = m.group(2), m.group(4)
        raw1 = float(m.group(1).replace(",", "."))
        raw2 = float(m.group(3).replace(",", "."))

        if not unit1 and unit2:
            unit1 = unit2
            if raw1 * _PRICE_UNIT.get(unit1.lower(), 1) > raw2 * _PRICE_UNIT.get(unit2.lower(), 1) * 2:
                unit1 = "rb" if unit1.lower() in ("jt", "juta", "jutaan", "jt-an") else unit1
        elif not unit1 and not unit2:
            unit1 = unit2 = "rb"

        if not unit2 and unit1:
            unit2 = unit1
        elif not unit2 and not unit1:
            unit2 = "rb"

        v1 = raw1 * _PRICE_UNIT.get((unit1 or "rb").lower(), 1)
        v2 = raw2 * _PRICE_UNIT.get((unit2 or "rb").lower(), 1)
        lo, hi = min(int(v1), int(v2)), max(int(v1), int(v2))
        if 10_000 <= lo <= 50_000_000 and 10_000 <= hi <= 50_000_000:
            return {"min": lo, "max": hi}

    m = _PRICE_SINGLE_RE.search(haystack)
    if m:
        raw = float(m.group(1).replace(",", "."))
        unit = m.group(2)
        if unit:
            raw *= _PRICE_UNIT.get(unit.lower(), 1)
        elif raw < 100:
            raw *= 1_000_000
        else:
            raw *= 1_000
        v = int(raw)
        if 10_000 <= v <= 50_000_000:
            return {"min": v, "max": v}

    return None


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
