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


def ensure_scraped(area: str, postal_codes: List[int], force: bool = False) -> Dict[str, Any]:
    cache_dir = ROOT / "data" / "raw" / area
    all_cached = force is False and all(
        (cache_dir / f"{code}.jsonl").exists() for code in postal_codes
    )

    if all_cached:
        import glob
        count = len(list(cache_dir.glob("*.jsonl")))
        return {"status": "cached", "files": count}

    codes_arg = ",".join(str(c) for c in postal_codes)
    scraper_dir = ROOT / "services" / "scraper"
    flags = "force=True" if force else ""

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
    return {"status": "scraped", "files": count}


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


def search_and_rank(query: str, area: str, top_k: int = 5) -> List[Dict[str, Any]]:
    proc = subprocess.run(
        [sys.executable, "-c",
         f"import json; "
         f"from src.search import search; from src.rank import rank; "
         f"results = search({json.dumps(query)}, kecamatan={json.dumps(area)}, top_k={max(top_k * 3, 30)}); "
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


def format_results(results: List[Dict[str, Any]], query: str) -> str:
    if not results:
        return f"No results for: {query}"

    input_data = json.dumps({"query": query, "results": results[:5]})
    proc = subprocess.run(
        [sys.executable, "-c",
         f"import json, sys; "
         f"from src.summarize import summarize; "
         f"data = json.loads(sys.stdin.read()); "
         f"print(summarize(data['query'], data['results']))"],
        cwd=str(ROOT / "services" / "rag-engine"),
        input=input_data,
        timeout=30,
        capture_output=True,
        text=True,
    )

    if proc.returncode != 0:
        return _format_fallback(results, query)

    return proc.stdout.strip() or _format_fallback(results, query)


def _format_fallback(results: List[Dict], query: str) -> str:
    lines = [f"Pencarian: {query}", ""]
    for i, r in enumerate(results[:5], 1):
        m = r.get("metadata", r)
        lines.append(f"{i}. {m.get('name', '')} — {m.get('rating', 0)}★ ({m.get('review_count', 0)} reviews)")
    return "\n".join(lines)
