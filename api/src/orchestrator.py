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
    # Resolve so a regency-level area (multiple districts) searches across all
    # its kecamatan instead of filtering to a non-existent kecamatan name.
    geo = resolve_area(area)
    districts = geo.get("districts", [])
    if len(districts) > 1:
        kec_filter: Optional[str] = None
    elif len(districts) == 1:
        kec_filter = districts[0].get("name", area)
    else:
        kec_filter = area

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


def format_results_stream(results: List[Dict[str, Any]], query: str):
    """Stream summary tokens via the RAG engine subprocess.

    Yields token strings as they arrive. The subprocess prints each token as a
    JSON-encoded line ({"t": "<token>"}) so we can stream across the process
    boundary without buffering. Falls back to a single error token on failure.
    """
    input_data = json.dumps({"query": query, "results": results[:5]})
    proc = subprocess.Popen(
        [sys.executable, "-u", "-c",
         "import json, sys; "
         "from src.summarize import stream_to_stdout; "
         "data = json.loads(sys.stdin.read()); "
         "stream_to_stdout(data['query'], data['results'])"],
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
    for i, r in enumerate(results[:5], 1):
        m = r.get("metadata", r)
        lines.append(f"{i}. {m.get('name', '')} — {m.get('rating', 0)}★ ({m.get('review_count', 0)} reviews)")
    return "\n".join(lines)
