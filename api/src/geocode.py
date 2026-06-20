"""Geocoding via Nominatim (OpenStreetMap) — free, no API key needed.

Rate-limited to 1 req/sec per Nominatim policy.
"""

import json
import time
import urllib.request
import urllib.parse
from typing import Optional, Dict, Any

NOMINATIM_URL = "https://nominatim.openstreetmap.org"
USER_AGENT = "kos-ai/1.0 (rent-house-ai)"

_last_request = 0.0


def _rate_limit():
    global _last_request
    elapsed = time.time() - _last_request
    if elapsed < 1.0:
        time.sleep(1.0 - elapsed)
    _last_request = time.time()


def geocode(query: str) -> Optional[Dict[str, Any]]:
    """Convert a location query (e.g., 'stasiun poris tangerang') to lat/lon + admin info.
    
    Retries with cleaned query if the original fails (e.g., 'mall tangcity' → 'tangcity').
    """
    # Try original query first
    result = _geocode_query(query)
    if result:
        return result

    # Second attempt: recursively strip known prefixes from the query
    # "Kos di sekitar mall One Belpark" → "One Belpark"
    stripped = query
    prefixes = [
        "kos di sekitar ", "kos sekitar ", "kosan di sekitar ", "kosan sekitar ",
        "cari kos di ", "cari kosan di ", "di sekitar ", "di dekat ",
        "mall ", "stasiun ", "terminal ", "bandara ", "universitas ", "kampus ",
        "pasar ", "alun-alun ", "taman ",
    ]
    changed = True
    while changed:
        changed = False
        for prefix in prefixes:
            if stripped.lower().startswith(prefix):
                stripped = stripped[len(prefix):].strip()
                changed = True
                break

    if stripped != query and stripped:
        result = _geocode_query(stripped)
        if result:
            return result

    return None


def _geocode_query(query: str) -> Optional[Dict[str, Any]]:
    _rate_limit()
    params = urllib.parse.urlencode({
        "q": query,
        "format": "json",
        "limit": 1,
        "addressdetails": 1,
    })
    url = f"{NOMINATIM_URL}/search?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    try:
        resp = urllib.request.urlopen(req, timeout=10)
        results = json.loads(resp.read())
        if not results:
            return None

        r = results[0]
        addr = r.get("address", {})

        regency = (
            addr.get("city")
            or addr.get("county")
            or addr.get("municipality")
            or addr.get("town")
            or addr.get("state_district")
            or addr.get("city_district")
            or ""
        )

        district = (
            addr.get("city_district")
            or addr.get("suburb")
            or addr.get("village")
            or addr.get("hamlet")
            or addr.get("town")
            or ""
        )

        return {
            "lat": float(r.get("lat", 0)),
            "lon": float(r.get("lon", 0)),
            "display_name": r.get("display_name", ""),
            "regency": regency,
            "province": addr.get("state", ""),
            "district": district,
        }
    except Exception as e:
        print(f"[geocode] failed: {e}")
        return None
