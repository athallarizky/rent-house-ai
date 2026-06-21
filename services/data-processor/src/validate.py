"""Validate coordinates and required fields."""

from typing import Dict, Any, List, Tuple

INDONESIA_BOUNDS = {
    "lat_min": -11.0,
    "lat_max": 6.0,
    "lon_min": 95.0,
    "lon_max": 141.0,
}


def validate(entry: Dict[str, Any]) -> Tuple[bool, List[str]]:
    errors: List[str] = []

    if not entry.get("place_id"):
        errors.append("missing place_id")
    if not entry.get("name"):
        errors.append("missing name")

    lat = entry.get("lat") or entry.get("latitude") or 0
    lon = entry.get("lon") or entry.get("longitude") or 0

    if not lat or not lon:
        errors.append("missing coordinates")
    else:
        b = INDONESIA_BOUNDS
        if lat < b["lat_min"] or lat > b["lat_max"]:
            errors.append(f"latitude {lat} outside Indonesia bounds")
        if lon < b["lon_min"] or lon > b["lon_max"]:
            errors.append(f"longitude {lon} outside Indonesia bounds")

    return len(errors) == 0, errors


def validate_all(entries: List[Dict[str, Any]]) -> Tuple[List[Dict], List[Dict]]:
    valid: List[Dict] = []
    invalid: List[Dict] = []

    for entry in entries:
        ok, errors = validate(entry)
        if ok:
            valid.append(entry)
        else:
            entry["_validation_errors"] = errors
            invalid.append(entry)

    return valid, invalid
