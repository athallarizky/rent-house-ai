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
    """Convert a location query (e.g., 'stasiun poris tangerang') to lat/lon + admin info."""
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
