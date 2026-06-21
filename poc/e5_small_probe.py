#!/usr/bin/env python3
"""Phase 1 — Probe e5-small vs bge-m3 standalone (subprocess-isolated).

Measures per model:
  - cold-load time (first SentenceTransformer(...) call)
  - peak RSS (resource.getrusage; bytes on macOS, KB on Linux)
  - warm per-encode latency on a 50-doc batch
  - output dim

For e5-small also smoke-tests query:/passage: prefix behavior.

Why subprocesses: ru_maxrss is monotonic per-process, so loading bge-m3 first
would inflate e5-small's reported RSS. Each model gets a fresh interpreter.

Outputs:
  - stdout: comparison table
  - poc/_results/probe_results.json
"""

import argparse
import json
import resource
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESULTS_DIR = Path(__file__).resolve().parent / "_results"
RESULTS_DIR.mkdir(exist_ok=True)

DOCS_PATH = ROOT / "data" / "cleaned" / "Cengkareng_docs.json"
BATCH_SIZE = 50

MODELS = {
    "e5_small": "intfloat/multilingual-e5-small",
    "bge_m3": "BAAI/bge-m3",
}


def _peak_rss_mb() -> float:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        return rss / (1024 * 1024)
    return rss / 1024


def load_docs(path: Path, n: int) -> list:
    with open(path) as f:
        return json.load(f)[:n]


def probe_one(model_key: str) -> dict:
    from sentence_transformers import SentenceTransformer

    model_name = MODELS[model_key]

    rss_pre = _peak_rss_mb()

    t0 = time.perf_counter()
    model = SentenceTransformer(
        model_name,
        model_kwargs={"attn_implementation": "eager"},
    )
    cold_load_s = time.perf_counter() - t0

    rss_after_load = _peak_rss_mb()
    dim = model.get_sentence_embedding_dimension()

    docs = load_docs(DOCS_PATH, BATCH_SIZE)
    texts = [d["text"] for d in docs]

    _ = model.encode(["warmup"], normalize_embeddings=True)

    latencies = []
    for _ in range(3):
        t = time.perf_counter()
        model.encode(
            texts, batch_size=8, normalize_embeddings=True, show_progress_bar=False
        )
        latencies.append(time.perf_counter() - t)
    latencies.sort()
    warm_encode_s = latencies[1]

    rss_peak = _peak_rss_mb()

    prefix_test = None
    if model_key == "e5_small":
        import numpy as np
        q_yes = model.encode(["query: wifi kenceng"], normalize_embeddings=True)
        p_yes = model.encode(
            ["passage: kos dengan wifi fiber 100Mbps, cocok untuk WFH"],
            normalize_embeddings=True,
        )
        q_no = model.encode(["wifi kenceng"], normalize_embeddings=True)
        p_no = model.encode(
            ["kos dengan wifi fiber 100Mbps, cocok untuk WFH"],
            normalize_embeddings=True,
        )
        prefix_test = {
            "cosine_with_prefix": float(np.dot(q_yes[0], p_yes[0])),
            "cosine_no_prefix": float(np.dot(q_no[0], p_no[0])),
            "expected_dim": 384,
            "actual_dim": dim,
        }

    total_chars = sum(len(t) for t in texts)
    return {
        "model_key": model_key,
        "model_name": model_name,
        "dim": dim,
        "cold_load_s": round(cold_load_s, 3),
        "warm_encode_s": round(warm_encode_s, 3),
        "docs_encoded": len(texts),
        "total_chars": total_chars,
        "rss_pre_mb": round(rss_pre, 1),
        "rss_after_load_mb": round(rss_after_load, 1),
        "rss_peak_mb": round(rss_peak, 1),
        "rss_model_delta_mb": round(rss_peak - rss_pre, 1),
        "prefix_test": prefix_test,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--probe-one",
        choices=list(MODELS.keys()),
        help="Internal: probe one model in a subprocess.",
    )
    args = ap.parse_args()

    if args.probe_one:
        print(json.dumps(probe_one(args.probe_one)))
        return

    print(f"Phase 1 probe — batch of {BATCH_SIZE} docs from {DOCS_PATH.name}")
    print(f"Platform: {sys.platform}   Python: {sys.version.split()[0]}")
    print()

    results = {}
    for key in MODELS:
        print(f"==> Probing {key} ({MODELS[key]}) in subprocess...")
        t0 = time.perf_counter()
        out = subprocess.run(
            [sys.executable, __file__, "--probe-one", key],
            capture_output=True,
            text=True,
            check=True,
        )
        wall_s = time.perf_counter() - t0
        data = json.loads(out.stdout.strip().splitlines()[-1])
        data["subprocess_wall_s"] = round(wall_s, 3)
        results[key] = data
        print(
            f"    dim={data['dim']}  cold_load={data['cold_load_s']:.1f}s  "
            f"warm_encode={data['warm_encode_s']:.2f}s  "
            f"peak_rss={data['rss_peak_mb']:.0f}MB"
        )

    e, b = results["e5_small"], results["bge_m3"]

    print()
    print("=" * 74)
    print(f"{'Metric':<28} {'e5-small':>15} {'bge-m3':>15} {'delta':>10}")
    print("-" * 74)
    print(f"{'dim':<28} {e['dim']:>15} {b['dim']:>15} {(e['dim']-b['dim']):>+10}")
    print(
        f"{'cold_load_s':<28} {e['cold_load_s']:>15.2f} {b['cold_load_s']:>15.2f} "
        f"{(e['cold_load_s']-b['cold_load_s']):>+10.2f}"
    )
    print(
        f"{'warm_encode_s (50 docs)':<28} {e['warm_encode_s']:>15.2f} {b['warm_encode_s']:>15.2f} "
        f"{(e['warm_encode_s']-b['warm_encode_s']):>+10.2f}"
    )
    print(
        f"{'rss_peak_mb':<28} {e['rss_peak_mb']:>15.0f} {b['rss_peak_mb']:>15.0f} "
        f"{(e['rss_peak_mb']-b['rss_peak_mb']):>+10.0f}"
    )
    print(
        f"{'rss_model_delta_mb':<28} {e['rss_model_delta_mb']:>15.0f} {b['rss_model_delta_mb']:>15.0f} "
        f"{(e['rss_model_delta_mb']-b['rss_model_delta_mb']):>+10.0f}"
    )
    print("=" * 74)

    if e.get("prefix_test"):
        pt = e["prefix_test"]
        print("\ne5-small prefix ablation (cosine, higher = more similar):")
        print(f"  with    prefix: {pt['cosine_with_prefix']:.4f}")
        print(f"  without prefix: {pt['cosine_no_prefix']:.4f}")
        print(
            f"  expected dim 384: {'OK' if pt['actual_dim'] == pt['expected_dim'] else 'MISMATCH'}"
        )

    out_path = RESULTS_DIR / "probe_results.json"
    out_path.write_text(json.dumps(results, indent=2))
    print(f"\nResults written: {out_path}")


if __name__ == "__main__":
    main()
