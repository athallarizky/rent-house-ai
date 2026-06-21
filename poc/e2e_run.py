#!/usr/bin/env python3
"""Phase 5 — E2E Docker validation driver.

Orchestrates a single E2E run on the production-shaped Docker stack:
  1. Wait for kos-api health
  2. Login as admin → bearer token
  3. Sample idle docker stats (3 samples, 5s apart)
  4. POST /pipeline/index with area=Cengkareng (kicks off background indexing)
  5. Poll /pipeline/status + sample docker stats every 5s until pipeline done
  6. Measure storage delta (data/chroma_db/ size before vs after)
  7. Run N search queries via API, time each (cold + warm)
  8. Output JSON results to poc/_e2e_logs/{label}_results.json

Usage:
    python poc/e2e_run.py --label runA_bge_m3 --area Cengkareng

Designed to be run twice — once with bge-m3 (default), once with e5-small
(via EMBED_MODEL env on the container). Each run is independent; compose
project name isolation keeps the two runs' volumes separate.
"""

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent.parent
LOG_DIR = Path(__file__).resolve().parent / "_e2e_logs"
LOG_DIR.mkdir(exist_ok=True)

API_URL = "http://localhost:18080"  # Sprint 10 POC: host 8080 is intercepted by another service
ADMIN_EMAIL = "admin@kos.ai"
ADMIN_PASSWORD = "admin123"

# Search queries — same intent as Phase 2 but written naturally
# (we're testing latency here, not retrieval quality — Phase 2 covered that)
SEARCH_QUERIES = [
    {"query": "wifi kenceng buat wfh",        "area": "Cengkareng"},
    {"query": "kos putri murah",              "area": "Cilandak"},
    {"query": "ac dingin parkir luas",        "area": "Kebon Jeruk"},
    {"query": "kamar mandi dalam",            "area": "Grogol Petamburan"},
    {"query": "dapur buat masak",             "area": "Kalideres"},
]


def http(method, path, body=None, token=None, timeout=120):
    url = API_URL + path
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:500]}
    except Exception as e:
        return 0, {"error": str(e)}


def wait_for_health(max_wait_s=600):
    """Wait for /health to return 200."""
    print(f"Waiting for {API_URL}/health ...")
    start = time.perf_counter()
    while time.perf_counter() - start < max_wait_s:
        st, _ = http("GET", "/health", timeout=5)
        if st == 200:
            print(f"  healthy after {time.perf_counter() - start:.0f}s")
            return time.perf_counter() - start
        time.sleep(5)
    raise TimeoutError(f"API not healthy within {max_wait_s}s")


def login():
    st, resp = http("POST", "/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if st != 200 or "token" not in resp:
        raise RuntimeError(f"login failed: {st} {resp}")
    return resp["token"]


def docker_stats(container="kos-api"):
    """One-shot docker stats sample for kos-api. Returns dict or None."""
    try:
        out = subprocess.check_output(
            ["docker", "stats", "--no-stream",
             "--format", "{{.Container}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}",
             container],
            stderr=subprocess.DEVNULL, text=True, timeout=10,
        ).strip()
    except subprocess.SubprocessError:
        return None
    if not out:
        return None
    parts = out.split("|")
    if len(parts) < 4:
        return None
    mem_usage = parts[2].split(" / ")
    mem_used = mem_usage[0].strip() if mem_usage else "?"
    return {
        "container": parts[0],
        "cpu_percent": parts[1].strip(),
        "mem_used": mem_used,
        "mem_percent": parts[3].strip(),
    }


def dir_size(path):
    """Get directory size in bytes (du -sb)."""
    try:
        out = subprocess.check_output(["du", "-sh", path], text=True)
        return out.split()[0]
    except Exception:
        return "?"


def trigger_index(token, area):
    """POST /pipeline/index to start indexing the area. Returns response.

    Body: {"area": "<name>"} per api/src/pipeline_data.py:194 ActionRequest.
    """
    st, resp = http("POST", "/pipeline/index", {"area": area}, token=token)
    return st, resp, "/pipeline/index"


def poll_pipeline_status(token, area, sample_log, max_wait_s=900):
    """Poll /pipeline/status and sample docker stats until pipeline done."""
    start = time.perf_counter()
    last_status = None
    while time.perf_counter() - start < max_wait_s:
        st, resp = http("GET", "/pipeline/status", token=token, timeout=10)
        sample = docker_stats()
        sample_log.append({
            "t": round(time.perf_counter() - start, 1),
            "stats": sample,
            "pipeline_status": resp if st == 200 else None,
        })
        if sample:
            print(f"  t={time.perf_counter() - start:5.1f}s  cpu={sample['cpu_percent']:>6}  mem={sample['mem_used']:>12}  status={((resp or {}).get('status') or '?')}")
        if st == 200 and resp.get("status") in ("completed", "idle", "error"):
            return resp, time.perf_counter() - start
        time.sleep(5)
    return last_status, time.perf_counter() - start


def search_once(token, q, area, mode="rag"):
    """Run one search query, return (status, latency_s, n_results)."""
    body = {
        "query": q, "area": area, "mode": mode,
        "ensure_pipeline": False, "top_k": 5,
    }
    t0 = time.perf_counter()
    st, resp = http("POST", "/search", body, token=token, timeout=60)
    latency = time.perf_counter() - t0
    n = 0
    if isinstance(resp, dict):
        results = resp.get("results") or resp.get("items") or []
        n = len(results) if isinstance(results, list) else 0
    return st, latency, n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True, help="Run label, e.g. runA_bge_m3")
    ap.add_argument("--area", default="Cengkareng")
    ap.add_argument("--skip-warmup-search", action="store_true",
                    help="Skip the warmup search before timed runs")
    args = ap.parse_args()

    print(f"=== E2E run: {args.label}  area={args.area} ===")
    print(f"Start: {datetime.now().isoformat()}")

    # 1. Wait for health
    health_s = wait_for_health()

    # 2. Login
    token = login()
    print(f"Logged in as {ADMIN_EMAIL}")

    # 3. Idle docker stats (3 samples)
    print("\nIdle measurement (3 samples, 5s apart):")
    idle_samples = []
    for i in range(3):
        s = docker_stats()
        idle_samples.append(s)
        if s:
            print(f"  sample {i+1}: cpu={s['cpu_percent']}  mem={s['mem_used']}  mem%={s['mem_percent']}")
        time.sleep(5)

    # 4. Pre-pipeline storage
    pre_chroma = dir_size(str(ROOT / "data" / "chroma_db"))
    print(f"\nPre-pipeline data/chroma_db size: {pre_chroma}")

    # 5. Trigger indexing
    print(f"\nTriggering /pipeline/index for area={args.area} ...")
    st, resp, path = trigger_index(token, args.area)
    print(f"  {path} -> {st} {str(resp)[:200]}")
    trigger_resp = {"status": st, "path": path, "body": resp}

    # 6. Poll + sample during pipeline
    print(f"\nPolling /pipeline/status (5s interval):")
    sample_log = []
    final_status, pipeline_s = poll_pipeline_status(token, args.area, sample_log)
    print(f"\nPipeline finished: status={final_status}  total={pipeline_s:.1f}s")

    # 7. Post-pipeline storage
    post_chroma = dir_size(str(ROOT / "data" / "chroma_db"))
    print(f"Post-pipeline data/chroma_db size: {post_chroma}")

    # Also try to get count via API
    st, count_resp = http("GET", f"/pipeline/data", token=token, timeout=10)

    # 8. Search latency
    print(f"\nSearch latency ({len(SEARCH_QUERIES)} queries, cold + 2 warm):")
    searches = []
    for i, q in enumerate(SEARCH_QUERIES):
        runs = []
        for run_idx in range(3):  # cold, warm, warm
            label = "cold" if run_idx == 0 else "warm"
            st, lat, n = search_once(token, q["query"], q["area"])
            runs.append({"label": label, "status": st, "latency_s": round(lat, 3), "n_results": n})
            print(f"  q{i+1} {label:4} {q['query'][:25]:<26} -> status={st} latency={lat:.3f}s n={n}")
            if st != 200:
                break
            time.sleep(1)
        searches.append({"query": q["query"], "area": q["area"], "runs": runs})

    # Save
    out = {
        "label": args.label,
        "area": args.area,
        "timestamp": datetime.now().isoformat(),
        "health_wait_s": round(health_s, 1),
        "idle_samples": idle_samples,
        "pre_chroma_size": pre_chroma,
        "post_chroma_size": post_chroma,
        "pipeline_trigger": trigger_resp,
        "pipeline_final_status": final_status,
        "pipeline_total_s": round(pipeline_s, 1),
        "pipeline_samples": sample_log,
        "searches": searches,
        "pipeline_data": count_resp if st == 200 else None,
    }
    out_path = LOG_DIR / f"{args.label}_results.json"
    out_path.write_text(json.dumps(out, indent=2))
    print(f"\nWrote: {out_path}")


if __name__ == "__main__":
    main()
