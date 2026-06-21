"""Normalize phone numbers and area names from scraper output."""

import re
from typing import Optional

_PHONE_STRIP = re.compile(r"[\s\-\(\)]")
_PHONE_NON_DIGIT = re.compile(r"\D")

DIRECTION_TO_INDONESIAN: dict[str, str] = {
    "south": "Selatan",
    "north": "Utara",
    "east": "Timur",
    "west": "Barat",
}


def normalize_phone(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    s = _PHONE_STRIP.sub("", raw.strip())
    if not s:
        return None
    if s.startswith("+62"):
        digits = s[3:]
    elif s.startswith("62") and len(s) > 8:
        digits = s[2:]
    elif s.startswith("0"):
        digits = s[1:]
    else:
        digits = s
    digits = _PHONE_NON_DIGIT.sub("", digits)
    if len(digits) < 8 or len(digits) > 13:
        return None
    return f"+62{digits}"


def normalize_address(raw: Optional[str]) -> str:
    if not raw:
        return ""
    s = raw.strip()
    for eng, indo in DIRECTION_TO_INDONESIAN.items():
        s = re.sub(rf"\b{eng}\b", indo, s, flags=re.IGNORECASE)
    return s


def normalize_name(raw: Optional[str]) -> str:
    if not raw:
        return ""
    return raw.strip()
