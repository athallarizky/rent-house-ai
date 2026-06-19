"""CLI orchestrator for the full kos search pipeline.

Usage:
    cd services/rag-engine
    python -m src.cli "Kosan di Cengkareng wifi kenceng"
    python -m src.cli --area Cengkareng --query "wifi kenceng"
"""

import sys
import json
import urllib.request
import urllib.parse
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any

ROOT = Path(__file__).resolve().parent.parent.parent.parent

GEO_ROUTER_URL = "http://localhost:3001"


def cli_main():
    import argparse
    ap = argparse.ArgumentParser(description="Kos search CLI")
    ap.add_argument("input_query", nargs="?", help="Natural language query")
    ap.add_argument("--area", help="Force specific area (skip geo-router)")
    ap.add_argument("--query", dest="search_query", help="Override search query (if different from input)")
    ap.add_argument("--force-scrape", action="store_true", help="Re-scrape even if cached")
    ap.add_argument("--no-llm", action="store_true", help="Skip LLM summarization")
    ap.add_argument("--top-k", type=int, default=5, help="Number of results")
    args = ap.parse_args()

    query_text = args.search_query or args.input_query or ""
    if not query_text and not args.area:
        ap.error("Provide a query or --area")

    area = args.area or _extract_area(query_text)
    if not area:
        print("Error: Could not determine area from query. Use --area.")
        sys.exit(1)

    _run_pipeline(area, query_text, args.force_scrape, not args.no_llm, args.top_k)


def _extract_area(query: str) -> Optional[str]:
    common_areas = [
        "cengkareng", "jakarta barat", "jakarta selatan", "jakarta timur",
        "jakarta pusat", "jakarta utara", "bandung", "surabaya", "yogyakarta",
        "tangerang", "bekasi", "depok", "bogor", "semarang",
    ]
    lower = query.lower()
    for area in common_areas:
        if area in lower:
            return area
    return None


def _run_pipeline(area: str, query: str, force_scrape: bool, use_llm: bool, top_k: int):
    print(f"=== Kos Search Pipeline ===")
    print(f"Area: {area}")
    print(f"Query: {query or '(browse mode)'}")

    resolved = _resolve_area(area)
    regency = resolved.get("regency", "")
    districts = resolved.get("districts", [])
    postal_codes: list = []

    if len(districts) > 1 and not query:
        print(f"\n{regency} has {len(districts)} kecamatan:")
        for i, d in enumerate(districts[:10], 1):
            print(f"  {i}. {d['name']}")
        print(f"\nTip: Re-run with --area <kecamatan> for a specific area.")
        return

    for d in districts:
        postal_codes.extend(d.get("postalCodes", []))

    if not postal_codes:
        print("Error: No postal codes found for this area")
        return

    _ensure_scraped(area, postal_codes, force_scrape)
    _ensure_processed(area)
    _ensure_indexed(area)

    if query:
        _search_and_summarize(query, area, use_llm, top_k)
    else:
        print(f"\nData ready for {area}. Try: python -m src.cli \"wifi kenceng\" --area {area}")


def _resolve_area(area: str) -> Dict[str, Any]:
    print(f"\n[1/4] Resolving area: {area}")
    try:
        url = f"{GEO_ROUTER_URL}/resolve?q={urllib.parse.quote(area)}"
        resp = urllib.request.urlopen(url, timeout=5)
        data = json.loads(resp.read())
        if data.get("success"):
            return data["data"]
    except Exception as e:
        print(f"  Geo-router offline ({e}), using basic lookup")
    return {"regency": area, "districts": []}


def _ensure_scraped(area: str, postal_codes: list, force: bool):
    print(f"\n[2/4] Scraping: {area} ({len(postal_codes)} postal codes)")

    import os
    cache_dir = ROOT / "data" / "raw" / area
    all_cached = all((cache_dir / f"{code}.jsonl").exists() for code in postal_codes)

    if not force and all_cached:
        count = sum(1 for _ in cache_dir.glob("*.jsonl") if _.suffix == ".jsonl")
        print(f"  Already cached ({count} files) — skipping")
        return

    codes_arg = ",".join(str(c) for c in postal_codes)
    flags = "--force" if force else ""
    subprocess.run(
        [sys.executable, "-c",
         f"from src.run import scrape_area, ScraperConfig; "
         f"config = ScraperConfig(depth=1, concurrency=1, lang='id'); "
         f"scrape_area('{area}', [{codes_arg}], config=config, force={force})"],
        cwd=str(ROOT / "services" / "scraper"),
        timeout=600,
    )


def _ensure_processed(area: str):
    clean_path = ROOT / "data" / "cleaned" / f"{area}_docs.json"
    if clean_path.exists():
        print(f"\n[3/4] Processing: already cached")
        return
    print(f"\n[3/4] Processing: {area}")
    subprocess.run(
        [sys.executable, "-m", "src.pipeline", area],
        cwd=str(ROOT / "services" / "data-processor"),
        timeout=120,
    )


def _ensure_indexed(area: str):
    print(f"\n[4/4] Indexing: {area}")
    from src.ingest import ingest
    docs_path = ROOT / "data" / "cleaned" / f"{area}_docs.json"
    if docs_path.exists():
        result = ingest(docs_path)
        print(f"  Indexed: {result['indexed']} new, {result['skipped']} skipped")
    else:
        print("  No docs to index")


def _search_and_summarize(query: str, area: str, use_llm: bool, top_k: int):
    from src.search import search
    from src.rank import rank

    print(f"\n{'='*50}")
    print(f"Search: {query}")
    print(f"{'='*50}")

    results = search(query, kecamatan=area, top_k=max(top_k * 3, 30))
    ranked = rank(results)

    for i, r in enumerate(ranked[:top_k], 1):
        m = r["metadata"]
        print(f"\n{i}. {m['name']} ({m['rating']}★, {m['review_count']} reviews)")
        print(f"   Score: {r['score']:.3f} | Tags: {m.get('tags', '—')}")
        if m.get("phone"):
            print(f"   Phone: {m['phone']}")
        text = r.get("text", "")
        for line in text.split("\n"):
            if line.startswith("[") and "★" in line:
                print(f"   {line[:120]}")

    if use_llm:
        print(f"\n{'='*50}")
        print("LLM Summary:")
        print(f"{'='*50}")
        from src.summarize import summarize
        summary = summarize(query, ranked[:top_k])
        print(summary)


if __name__ == "__main__":
    cli_main()
