"""Pipeline orchestrator — coordinates geo-router, scraper, processor, and RAG engine."""

import json
import subprocess
import sys
import urllib.request
import urllib.parse
from pathlib import Path
from typing import Optional, Dict, Any, List

ROOT = Path(__file__).resolve().parent.parent.parent
GEO_ROUTER_URL = "http://localhost:3001"


def _format_kos_items(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Shape raw {metadata, text} from the RAG engine into the API KosResult item."""
    items = []
    for r in results:
        meta = r.get("metadata", r)
        items.append({
            "name": meta.get("name", ""),
            "place_id": meta.get("place_id", ""),
            "rating": meta.get("rating", 0),
            "review_count": meta.get("review_count", 0),
            "tags": meta.get("tags", "").split("|") if meta.get("tags") else [],
            "gender": meta.get("gender", ""),
            "phone": meta.get("phone", ""),
            "lat": meta.get("lat", 0),
            "lon": meta.get("lon", 0),
            "kecamatan": meta.get("kecamatan", ""),
            "score": r.get("score", 0),
            "text": r.get("text", ""),
            "price_min": meta.get("price_min") or None,
            "price_max": meta.get("price_max") or None,
        })
    return items


def resolve_area(query: str) -> Dict[str, Any]:
    try:
        url = f"{GEO_ROUTER_URL}/resolve?q={urllib.parse.quote(query)}"
        resp = urllib.request.urlopen(url, timeout=5)
        data = json.loads(resp.read())
        if data.get("success"):
            return data["data"]
    except Exception:
        pass
    return {"type": "AREA", "regency": query, "districts": [], "province": ""}


def ensure_scraped(area: str, postal_codes: List[int], force: bool = False, stale_days: int = 30) -> Dict[str, Any]:
    cache_dir = ROOT / "data" / "raw" / area

    import os
    from datetime import datetime

    max_age = 0.0
    all_fresh = True
    for code in postal_codes:
        path = cache_dir / f"{code}.jsonl"
        if path.exists():
            mtime = datetime.fromtimestamp(os.path.getmtime(path))
            age = (datetime.now() - mtime).total_seconds() / 86400
            max_age = max(max_age, age)
            if stale_days > 0 and age > stale_days:
                all_fresh = False
        else:
            all_fresh = False

    if not force and all_fresh:
        import glob
        count = len(list(cache_dir.glob("*.jsonl")))
        return {"status": "cached", "files": count, "scrape_age_days": round(max_age, 1)}

    codes_arg = ",".join(str(c) for c in postal_codes)
    scraper_dir = ROOT / "services" / "scraper"
    flags = "force=True" if force else f"stale_days={stale_days}"

    proc = subprocess.run(
        [sys.executable, "-c",
         f"from src.run import scrape_area, ScraperConfig; "
         f"config = ScraperConfig(depth=1, concurrency=1, lang='id'); "
         f"scrape_area('{area}', [{codes_arg}], config=config, {flags})"],
        cwd=str(scraper_dir),
        timeout=600,
        capture_output=True,
        text=True,
    )

    if proc.returncode != 0:
        return {"status": "error", "message": proc.stderr[-300:]}

    import glob
    count = len(list(cache_dir.glob("*.jsonl")))
    return {"status": "scraped", "files": count, "scrape_age_days": 0.0}


def ensure_processed(area: str) -> Dict[str, Any]:
    docs_path = ROOT / "data" / "cleaned" / f"{area}_docs.json"
    if docs_path.exists():
        return {"status": "cached"}

    proc_dir = ROOT / "services" / "data-processor"
    proc = subprocess.run(
        [sys.executable, "-m", "src.pipeline", area],
        cwd=str(proc_dir),
        timeout=120,
        capture_output=True,
        text=True,
    )

    if proc.returncode != 0:
        return {"status": "error", "message": proc.stderr[-300:]}

    return {"status": "processed"}


def ensure_indexed(area: str) -> Dict[str, Any]:
    docs_path = ROOT / "data" / "cleaned" / f"{area}_docs.json"
    if not docs_path.exists():
        return {"status": "error", "message": "No processed docs found"}

    proc = subprocess.run(
        [sys.executable, "-c",
         f"import json; from src.ingest import ingest; "
         f"result = ingest('{docs_path}'); "
         f"print(json.dumps(result))"],
        cwd=str(ROOT / "services" / "rag-engine"),
        timeout=120,
        capture_output=True,
        text=True,
    )

    if proc.returncode != 0:
        return {"status": "error", "message": proc.stderr[-300:]}

    try:
        result = json.loads(proc.stdout.strip())
        return {"status": "indexed", "new": result.get("indexed", 0), "skipped": result.get("skipped", 0)}
    except Exception:
        return {"status": "indexed", "new": 0, "skipped": 0}


def _resolve_kecamatan(area: str, regency: Optional[str] = None) -> Optional[str]:
    """Determine the kecamatan filter for a search.

    When a regency is supplied (the session/switcher flow), look the district up
    inside that regency for an EXACT match. This avoids the geo-router's
    direct-resolve mis-hits (e.g. "Buahbatu" fuzzy-matched to "Blahbatuh, Gianyar"
    instead of "Buahbatu, Bandung" — see RCA-007 / RCA-004).

    Without a regency, fall back to direct resolve: a regency-level area
    (multiple districts) → None (search all); a single district → its name.
    """
    if regency:
        regency_geo = resolve_area(regency)
        for d in regency_geo.get("districts", []):
            if d.get("name", "").lower() == area.lower():
                return d.get("name", area)
        # not found inside the regency — fall through to direct resolve

    geo = resolve_area(area)
    districts = geo.get("districts", [])
    if len(districts) > 1:
        return None  # regency-level: search across all kecamatan
    if len(districts) == 1:
        return districts[0].get("name", area)
    return area


def search_and_rank(
    query: str, area: str, top_k: int = 5, regency: Optional[str] = None
) -> List[Dict[str, Any]]:
    kec_filter = _resolve_kecamatan(area, regency)

    proc = subprocess.run(
        [sys.executable, "-c",
         f"import json; "
         f"from src.search import search; from src.rank import rank; "
         f"results = search({json.dumps(query)}, kecamatan={json.dumps(kec_filter)}, top_k={max(top_k * 3, 30)}); "
         f"ranked = rank(results); "
         f"output = [{{'metadata': r['metadata'], 'score': r.get('score', 0), 'text': r.get('text', '')[:200]}} for r in ranked[:{top_k}]]; "
         f"print(json.dumps(output))"],
        cwd=str(ROOT / "services" / "rag-engine"),
        timeout=30,
        capture_output=True,
        text=True,
    )

    if proc.returncode != 0:
        return []

    try:
        return json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        return []


def format_results(results: List[Dict[str, Any]], query: str, chat_history: Optional[List[Dict[str, str]]] = None) -> str:
    if not results:
        return f"No results for: {query}"

    input_data = json.dumps({"query": query, "results": results[:10], "chat_history": chat_history})
    proc = subprocess.run(
        [sys.executable, "-c",
         f"import json, sys; "
         f"from src.summarize import summarize; "
         f"data = json.loads(sys.stdin.read()); "
         f"print(summarize(data['query'], data['results'], chat_history=data.get('chat_history')))"],
        cwd=str(ROOT / "services" / "rag-engine"),
        input=input_data,
        timeout=60,
        capture_output=True,
        text=True,
    )

    if proc.returncode != 0:
        return _format_fallback(results, query)

    return proc.stdout.strip() or _format_fallback(results, query)


def format_results_stream(results: List[Dict[str, Any]], query: str, chat_history: Optional[List[Dict[str, str]]] = None):
    """Stream summary tokens via the RAG engine subprocess.

    Yields token strings as they arrive. The subprocess prints each token as a
    JSON-encoded line ({"t": "<token>"}) so we can stream across the process
    boundary without buffering. Falls back to a single error token on failure.
    """
    input_data = json.dumps({"query": query, "results": results[:10], "chat_history": chat_history})
    proc = subprocess.Popen(
        [sys.executable, "-u", "-c",
         "import json, sys; "
         "from src.summarize import stream_to_stdout; "
         "data = json.loads(sys.stdin.read()); "
         "stream_to_stdout(data['query'], data['results'], chat_history=data.get('chat_history'))"],
        cwd=str(ROOT / "services" / "rag-engine"),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert proc.stdin is not None and proc.stdout is not None
    try:
        proc.stdin.write(input_data)
        proc.stdin.close()
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line).get("t", "")
            except json.JSONDecodeError:
                continue
        proc.wait(timeout=30)
    except Exception:
        proc.kill()
        yield _format_fallback(results, query)
    finally:
        if proc.poll() is None:
            proc.kill()


def _format_fallback(results: List[Dict], query: str) -> str:
    lines = [f"Pencarian: {query}", ""]
    for i, r in enumerate(results[:10], 1):
        m = r.get("metadata", r)
        lines.append(f"{i}. {m.get('name', '')} — {m.get('rating', 0)}★ ({m.get('review_count', 0)} reviews)")
    return "\n".join(lines)


def load_area(district: str, regency: Optional[str] = None, load_all: bool = False) -> Dict[str, Any]:
    """Load the full kos dataset for a district (session browse set).

    Runs the pipeline (cached after first run), then returns ALL kos for the
    district plus the sibling districts in the same regency (for the UI switcher).

    When a regency is supplied (the switcher flow), the district is looked up
    inside that regency rather than resolved directly. This sidesteps the
    geo-router POI classifier, which mislabels real kecamatan like "Taman Sari"
    (contains the POI word "taman") as Points of Interest.

    When load_all=True and regency resolves to multiple districts, loads ALL
    kos across every district in the regency (cross-district search).
    """
    resolved_regency = ""
    province = ""
    regency_districts: List[Dict[str, Any]] = []
    matched_district: Optional[Dict[str, Any]] = None

    if regency:
        regency_geo = resolve_area(regency)
        resolved_regency = regency_geo.get("regency", regency)
        province = regency_geo.get("province", "")
        regency_districts = regency_geo.get("districts", [])
        for d in regency_districts:
            if d.get("name", "").lower() == district.lower():
                matched_district = d
                break

    if matched_district is None:
        # Direct resolve (no regency, or name not found in regency).
        geo = resolve_area(district)
        if geo.get("type") == "POI":
            return {
                "success": False,
                "error": f"'{district}' is a Point of Interest, not an area.",
            }
        if not resolved_regency:
            resolved_regency = geo.get("regency", "") or regency or ""
        if not province:
            province = geo.get("province", "")
        ds = geo.get("districts", [])
        matched_district = ds[0] if ds else None
        # If we didn't already have siblings from a regency resolve, try once now.
        if not regency_districts and resolved_regency:
            rg = resolve_area(resolved_regency)
            regency_districts = rg.get("districts", [])
            if not province:
                province = rg.get("province", province)

    # Cross-district: load all districts in the regency
    if load_all and regency_districts and len(regency_districts) > 1:
        return _load_all_districts(regency_districts, resolved_regency, province)

    if not matched_district:
        return {"success": False, "error": f"District '{district}' not found."}

    postal_codes: list = list(matched_district.get("postalCodes", []))
    if not postal_codes:
        return {"success": False, "error": f"No postal codes found for '{district}'"}

    resolved_district = matched_district.get("name", district)

    pipeline: Dict[str, Any] = {
        "area": resolved_district,
        "regency": resolved_regency,
        "province": province,
    }

    scrape_result = ensure_scraped(resolved_district, postal_codes)
    if scrape_result["status"] == "error":
        return {"success": False, "error": f"Scrape failed: {scrape_result.get('message')}"}
    pipeline["scrape"] = scrape_result["status"]
    if "scrape_age_days" in scrape_result:
        pipeline["scrape_age_days"] = scrape_result["scrape_age_days"]

    proc_result = ensure_processed(resolved_district)
    if proc_result["status"] == "error":
        return {"success": False, "error": f"Processing failed: {proc_result.get('message')}"}
    pipeline["process"] = proc_result["status"]

    idx_result = ensure_indexed(resolved_district)
    if idx_result["status"] == "error":
        return {"success": False, "error": f"Indexing failed: {idx_result.get('message')}"}
    pipeline["index"] = f"{idx_result.get('new', 0)} new, {idx_result.get('skipped', 0)} skipped"

    # Sibling districts in the same regency (for the UI switcher)
    siblings: List[Dict[str, Any]] = []
    if len(regency_districts) > 1:
        siblings = [
            {"name": d.get("name", ""), "postalCodes": d.get("postalCodes", [])}
            for d in regency_districts
        ]

    raw_items = _list_kos_subprocess(resolved_district)
    dataset = _format_kos_items(raw_items)

    return {
        "success": True,
        "district": resolved_district,
        "regency": resolved_regency,
        "province": province,
        "siblings": siblings,
        "dataset": dataset,
        "pipeline": pipeline,
    }


def _load_all_districts(regency_districts: List[Dict[str, Any]], regency: str, province: str) -> Dict[str, Any]:
    all_items: List[Dict[str, Any]] = []
    failed: List[str] = []

    for d in regency_districts:
        name = d.get("name", "")
        postal_codes: list = list(d.get("postalCodes", []))
        if not postal_codes:
            continue

        try:
            sr = ensure_scraped(name, postal_codes)
            if sr["status"] == "error":
                failed.append(name)
                continue
            ensure_processed(name)
            ensure_indexed(name)
        except Exception:
            failed.append(name)
            continue

        raw = _list_kos_subprocess(name)
        items = _format_kos_items(raw)
        all_items.extend(items)

    siblings = [
        {"name": d.get("name", ""), "postalCodes": d.get("postalCodes", [])}
        for d in regency_districts
    ]

    return {
        "success": True,
        "district": regency,
        "regency": regency,
        "province": province,
        "siblings": siblings,
        "dataset": all_items,
        "pipeline": {
            "area": regency,
            "regency": regency,
            "province": province,
            "scrape": f"{len(regency_districts) - len(failed)}/{len(regency_districts)} districts",
        },
        "failed_districts": failed if failed else None,
    }


def _list_kos_subprocess(kecamatan: str) -> List[Dict[str, Any]]:
    """Call rag-engine list_kos(kecamatan) via subprocess (no semantic search)."""
    proc = subprocess.run(
        [sys.executable, "-c",
         f"import json; from src.search import list_kos; "
         f"items = list_kos(kecamatan={json.dumps(kecamatan)}, limit=500); "
         f"print(json.dumps(items))"],
        cwd=str(ROOT / "services" / "rag-engine"),
        timeout=60,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return []
    try:
        return json.loads(proc.stdout.strip())
    except json.JSONDecodeError:
        return []
