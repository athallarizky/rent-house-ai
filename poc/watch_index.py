#!/usr/bin/env python3
"""Live resource watcher for pipeline indexing events.

Polls every POLL_INTERVAL seconds:
  - docker stats (CPU% + RAM per container)
  - data/chroma_db/ size
  - /pipeline/status (running, status, progress)
  - wall-clock timestamp

Auto-detects pipeline state transitions:
  - idle → indexing/scraping : mark "pipeline_start"
  - indexing/scraping → completed/idle : mark "pipeline_end" + print summary

Live prints one line per poll (overwrites in place via ANSI). When pipeline
completes, prints a full summary block + saves results.

Usage:
    python poc/watch_index.py --label tambora
    (then click Index in UI at http://localhost:4000/pipeline)
    Ctrl+C to stop early.

Output:
    poc/_e2e_logs/watch_<label>_samples.jsonl   (raw 1.5s samples)
    poc/_e2e_logs/watch_<label>_summary.json    (computed summary)
"""

import argparse
import json
import os
import signal
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

API_URL_DEFAULT = "http://localhost:4001"
CHROMA_PATH = ROOT / "data" / "chroma_db"
POLL_INTERVAL = 1.5  # seconds


# ---------- helpers ----------

def http_get(url, timeout=5):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:200]}
    except Exception as e:
        return 0, {"error": str(e)[:200]}


def docker_stats():
    """One-shot docker stats for all running containers."""
    try:
        out = subprocess.check_output(
            ["docker", "stats", "--no-stream",
             "--format", "{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"],
            stderr=subprocess.DEVNULL, text=True, timeout=8,
        ).strip()
    except subprocess.SubprocessError:
        return {}
    result = {}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        name = parts[0]
        cpu_str = parts[1].strip().rstrip("%")
        mem_used_str = parts[2].split("/")[0].strip()
        mem_pct_str = parts[3].strip().rstrip("%")
        try:
            cpu = float(cpu_str)
        except ValueError:
            cpu = 0.0
        mem_mb = _parse_mem_mb(mem_used_str)
        mem_pct = float(mem_pct_str) if mem_pct_str else 0.0
        result[name] = {
            "cpu_pct": cpu,
            "mem_mb": mem_mb,
            "mem_used_str": mem_used_str,
            "mem_pct": mem_pct,
        }
    return result


def _parse_mem_mb(s):
    s = s.strip()
    try:
        if s.endswith("GiB"): return float(s[:-3]) * 1024
        if s.endswith("MiB"): return float(s[:-3])
        if s.endswith("KiB"): return float(s[:-3]) / 1024
        if s.endswith("B"): return float(s[:-1]) / 1024 / 1024
    except ValueError:
        pass
    return 0.0


def dir_size_mb(path):
    """Walk directory and sum st_size. Portable across macOS/Linux (no `du -sb`)."""
    if not Path(path).exists():
        return 0.0
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            try:
                total += os.stat(os.path.join(root, f)).st_size
            except OSError:
                pass
    return total / 1024 / 1024


def login(api_url):
    body = json.dumps({"email": "admin@kos.ai", "password": "admin123"}).encode()
    req = urllib.request.Request(
        api_url + "/auth/login", data=body,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read().decode())["token"]


def auth_get(api_url, path, token, timeout=5):
    req = urllib.request.Request(
        api_url + path,
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def pipeline_status(api_url, token):
    return auth_get(api_url, "/pipeline/status", token)


def pipeline_data(api_url, token):
    return auth_get(api_url, "/pipeline/data", token, timeout=8)


# ---------- main loop ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", required=True, help="Label for output files, e.g. 'tambora'")
    ap.add_argument("--api-url", default=API_URL_DEFAULT)
    ap.add_argument("--max-wait-s", type=int, default=3600,
                    help="Max seconds to wait for a pipeline event before giving up")
    args = ap.parse_args()

    print(f"=== watch_index — label={args.label} ===")
    print(f"  api: {args.api_url}")
    print(f"  poll interval: {POLL_INTERVAL}s")
    print(f"  chroma path: {CHROMA_PATH}")
    print()

    token = login(args.api_url)
    print(f"✓ logged in as admin@kos.ai")

    samples_path = LOG_DIR / f"watch_{args.label}_samples.jsonl"
    summary_path = LOG_DIR / f"watch_{args.label}_summary.json"
    samples_fh = samples_path.open("w")

    # State — declared here so signal handler can write summary
    sample_count = [0]
    pipeline_events = []
    initial_areas_indexed = {}

    # Pre-pipeline baseline
    initial_data = pipeline_data(args.api_url, token)
    if initial_data:
        for a in initial_data.get("areas", []):
            if a.get("indexed_count", 0) > 0:
                initial_areas_indexed[a["area"]] = a["indexed_count"]
    print(f"  indexed areas at start: {len(initial_areas_indexed)} areas, "
          f"{sum(initial_areas_indexed.values())} total docs")

    # Signal handler — write summary on SIGTERM/SIGINT
    def write_summary(signum=None, frame=None):
        try:
            samples_fh.close()
        except Exception:
            pass
        summary = {
            "label": args.label,
            "api_url": args.api_url,
            "timestamp": datetime.now().isoformat(),
            "poll_interval_s": POLL_INTERVAL,
            "sample_count": sample_count[0],
            "initial": {
                "chroma_mb": round(chroma_start_mb, 3),
                "indexed_areas": len(initial_areas_indexed),
                "indexed_docs_total": sum(initial_areas_indexed.values()),
            },
            "events": pipeline_events,
        }
        summary_path.write_text(json.dumps(summary, indent=2))
        if signum is not None:
            print(f"\n📁 Raw samples:  {samples_path}  ({sample_count[0]} samples)")
            print(f"📁 Summary:      {summary_path}")
            print(f"   Events captured: {len(pipeline_events)}  "
                  f"({len([e for e in pipeline_events if e['type']=='end'])} complete)")
            sys.exit(0)
    signal.signal(signal.SIGTERM, write_summary)
    signal.signal(signal.SIGINT, write_summary)

    # State
    pipeline_active = False
    pipeline_start_t = None
    pipeline_start_status = None
    pipeline_area = None
    pipeline_progress_at_start = None
    last_status = None
    peaks = {"cpu_pct": 0, "mem_mb": 0, "cpu_str": "0%", "mem_str": "0MiB"}
    chroma_start_mb = dir_size_mb(CHROMA_PATH)
    chroma_peak_mb = chroma_start_mb

    print(f"  initial chroma_db size: {chroma_start_mb:.2f} MB")
    print()
    print("Waiting for pipeline event (click Index/Rebuild in UI)...")
    print("(Ctrl+C to stop early)")
    print()

    t0 = time.perf_counter()
    while time.perf_counter() - t0 < args.max_wait_s:
        now = datetime.now().strftime("%H:%M:%S")
        stats = docker_stats()
        api_stats = stats.get("kos-api", {"cpu_pct": 0, "mem_mb": 0, "mem_used_str": "?", "cpu_str": "?"})
        status = pipeline_status(args.api_url, token)
        status_str = (status or {}).get("status", "?")
        running_area = (status or {}).get("running")
        progress = (status or {}).get("progress")
        chroma_mb = dir_size_mb(CHROMA_PATH)

        sample = {
            "t": round(time.perf_counter() - t0, 2),
            "wall": now,
            "stats": stats,
            "pipeline": status,
            "chroma_mb": round(chroma_mb, 3),
        }
        samples_fh.write(json.dumps(sample) + "\n")
        samples_fh.flush()
        sample_count[0] += 1

        # Track peaks (regardless of pipeline state)
        if api_stats["cpu_pct"] > peaks["cpu_pct"]:
            peaks["cpu_pct"] = api_stats["cpu_pct"]
            peaks["cpu_str"] = f"{api_stats['cpu_pct']:.1f}%"
        if api_stats["mem_mb"] > peaks["mem_mb"]:
            peaks["mem_mb"] = api_stats["mem_mb"]
            peaks["mem_str"] = api_stats["mem_used_str"]
        if chroma_mb > chroma_peak_mb:
            chroma_peak_mb = chroma_mb

        # Detect pipeline state transitions
        is_active = status_str in ("scraping", "processing", "indexing", "running")
        if is_active and not pipeline_active:
            # START of pipeline event
            pipeline_active = True
            pipeline_start_t = time.perf_counter()
            pipeline_start_status = status_str
            pipeline_area = running_area
            pipeline_progress_at_start = progress
            pipeline_events.append({
                "type": "start",
                "t": round(pipeline_start_t, 2),
                "wall": now,
                "area": pipeline_area,
                "status": status_str,
                "progress": progress,
                "chroma_mb": round(chroma_mb, 3),
                "api_mem_mb": round(api_stats["mem_mb"], 1),
            })
            print(f"\n🟢 [{now}] PIPELINE START  area={pipeline_area}  status={status_str}  progress={progress}")
        elif not is_active and pipeline_active:
            # END of pipeline event
            pipeline_end_t = time.perf_counter()
            duration_s = pipeline_end_t - pipeline_start_t
            # Get fresh pipeline data to see new indexed count
            final_data = pipeline_data(args.api_url, token)
            final_areas_indexed = {}
            if final_data:
                for a in final_data.get("areas", []):
                    if a.get("indexed_count", 0) > 0:
                        final_areas_indexed[a["area"]] = a["indexed_count"]

            # Compute docs added in the target area
            docs_before = initial_areas_indexed.get(pipeline_area, 0)
            docs_after = final_areas_indexed.get(pipeline_area, 0)
            docs_added = docs_after - docs_before
            if docs_added <= 0 and docs_after > 0:
                docs_added = docs_after

            event_summary = {
                "type": "end",
                "t": round(pipeline_end_t, 2),
                "wall": now,
                "area": pipeline_area,
                "duration_s": round(duration_s, 2),
                "docs_added": docs_added,
                "docs_per_sec": round(docs_added / duration_s, 2) if duration_s > 0 else 0,
                "ms_per_doc": round(duration_s * 1000 / docs_added, 1) if docs_added > 0 else 0,
                "status": status_str,
                "progress": progress,
                "chroma_delta_mb": round(chroma_mb - chroma_start_mb, 3),
                "chroma_after_mb": round(chroma_mb, 3),
                "peak_cpu_str": peaks["cpu_str"],
                "peak_mem_str": peaks["mem_str"],
                "chroma_peak_mb": round(chroma_peak_mb, 3),
            }
            pipeline_events.append(event_summary)

            print(f"\n✅ [{now}] PIPELINE END  area={pipeline_area}  status={status_str}")
            print(f"   duration:       {duration_s:.2f}s")
            print(f"   docs added:     {docs_added}")
            if docs_added > 0:
                print(f"   per-doc ingest: {duration_s*1000/docs_added:.1f} ms/doc  ({docs_added/duration_s:.1f} docs/s)")
            print(f"   chroma growth:  {event_summary['chroma_delta_mb']:+.3f} MB  (now {chroma_mb:.3f} MB)")
            print()
            print(f"   📊 During this pipeline event:")
            print(f"      kos-api peak CPU: {peaks['cpu_str']}")
            print(f"      kos-api peak RAM: {peaks['mem_str']}")
            print(f"      chroma peak size: {chroma_peak_mb:.3f} MB")
            print()
            print("   Continuing to watch (waiting for next event, Ctrl+C to stop)...")
            print()

            # Reset for next event
            pipeline_active = False
            pipeline_start_t = None
            peaks = {"cpu_pct": 0, "mem_mb": 0, "cpu_str": "0%", "mem_str": "0MiB"}

        # Live status line (ANSI: move up + clear line)
        if sample_count[0] > 1:
            sys.stdout.write("\033[F\033[K")
        api_cpu = api_stats["cpu_pct"]
        api_mem = api_stats["mem_used_str"]
        marker = "🟢" if pipeline_active else "⚪"
        sys.stdout.write(
            f"  {marker} [{now}] t={time.perf_counter()-t0:6.1f}s  "
            f"api: cpu={api_cpu:5.1f}%  mem={api_mem:>10}  "
            f"chroma={chroma_mb:6.3f}MB  "
            f"pipeline: {status_str}/{running_area or '-'}  "
            f"({(progress or '')[:40]})\n"
        )
        sys.stdout.flush()

        last_status = status_str
        time.sleep(POLL_INTERVAL)

    # Max wait exceeded — write summary and exit
    write_summary()


if __name__ == "__main__":
    main()
