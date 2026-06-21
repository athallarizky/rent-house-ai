#!/usr/bin/env python3
"""Phase 2.2 — Retrieval quality benchmark: bge-m3 vs e5-small.

Builds two throwaway ChromaDB collections (one per model) from the same
production corpus (data/cleaned/*_docs.json), runs each held-out query scoped
to its area (matching production search.py where-clause), and reports
nDCG@5 + recall@5 per query and averaged.

Production-faithful settings (so numbers transfer to a real swap decision):
  - MAX_DOC_CHARS = 4000          (ingest.py:85)
  - hnsw:space = "cosine"         (ingest.py:25)
  - SEARCH_TOP_K = 20             (config.py:34)
  - batch_size = 8                (ingest.py:89)
  - normalize_embeddings = True   (cosine convention)
  - area filter via where={"kecamatan": area}  (search.py:46)

e5-small uses mandatory "passage:" / "query:" prefixes; bge-m3 uses none.
"""

import json
import math
import shutil
import time
from pathlib import Path

import chromadb
from sentence_transformers import SentenceTransformer

ROOT = Path(__file__).resolve().parent.parent
CHROMA_DIR = Path(__file__).resolve().parent / "_chroma"
QUERY_PATH = Path(__file__).resolve().parent / "queries.json"
CLEANED_DIR = ROOT / "data" / "cleaned"
RESULTS_DIR = Path(__file__).resolve().parent / "_results"
RESULTS_DIR.mkdir(exist_ok=True)

MAX_DOC_CHARS = 4000
TOP_K = 20
BATCH_SIZE = 8
K_NDCG = 5
K_RECALL = 5

MODELS = {
    "bge_m3": {
        "name": "BAAI/bge-m3",
        "doc_prefix": "",
        "query_prefix": "",
    },
    "e5_small": {
        "name": "intfloat/multilingual-e5-small",
        "doc_prefix": "passage: ",
        "query_prefix": "query: ",
    },
}


def load_all_docs():
    """Load all docs, deduplicated by doc_id (boundary cases appear twice).

    Production ingest.py:62-67 silently skips dupes via existing-id check; we
    mirror that here by keeping the first occurrence.
    """
    seen = set()
    docs = []
    dupes = 0
    for p in sorted(CLEANED_DIR.glob("*_docs.json")):
        for d in json.loads(p.read_text()):
            did = d["doc_id"]
            if did in seen:
                dupes += 1
                continue
            seen.add(did)
            docs.append(d)
    if dupes:
        print(f"  (deduped {dupes} duplicate doc_ids across area files)")
    return docs


def load_queries():
    return json.loads(QUERY_PATH.read_text())["queries"]


def sanitize_metadata(meta):
    """Mirror of ingest.py:30-46 _sanitize_metadata.

    ChromaDB's Rust binding (1.5.x) rejects None values; production sanitizes
    at insert time, so we must too.
    """
    clean = {}
    for k, v in meta.items():
        if v is None:
            if k in ("lat", "lon", "rating"):
                clean[k] = 0.0
            elif k == "review_count":
                clean[k] = 0
            elif k == "is_24h":
                clean[k] = False
            else:
                clean[k] = ""
        elif isinstance(v, bool):
            clean[k] = v
        elif isinstance(v, (int, float)):
            clean[k] = v
        else:
            clean[k] = str(v)
    return clean


def build_collection(client, name, model, doc_prefix, all_docs):
    try:
        client.delete_collection(name)
    except Exception:
        pass

    col = client.create_collection(name=name, metadata={"hnsw:space": "cosine"})

    ids = [d["doc_id"] for d in all_docs]
    raw_texts = [d["text"] for d in all_docs]
    prefixed_texts = [doc_prefix + t[:MAX_DOC_CHARS] for t in raw_texts]
    metas = [sanitize_metadata(d["metadata"]) for d in all_docs]

    print(f"  Encoding {len(ids)} docs (batch_size={BATCH_SIZE})...")
    t0 = time.perf_counter()
    embeddings = model.encode(
        prefixed_texts,
        batch_size=BATCH_SIZE,
        show_progress_bar=True,
        normalize_embeddings=True,
    ).tolist()
    encode_s = time.perf_counter() - t0
    print(f"  Encoded in {encode_s:.1f}s")

    col.add(ids=ids, embeddings=embeddings, documents=raw_texts, metadatas=metas)
    print(f"  Inserted. Collection count: {col.count()}")
    return col, encode_s


def query_collection(col, model, query_text, area, query_prefix):
    q = query_prefix + query_text
    emb = model.encode([q], normalize_embeddings=True).tolist()
    where = {"kecamatan": area}
    res = col.query(
        query_embeddings=emb,
        n_results=TOP_K,
        where=where,
        include=[],
    )
    return res["ids"][0]


def dcg_at_k(rels, k):
    return sum(rels[i] / math.log2(i + 2) for i in range(min(k, len(rels))))


def ndcg_at_k(retrieved_ids, relevant_set, k):
    if not relevant_set:
        return 0.0
    rels = [1 if rid in relevant_set else 0 for rid in retrieved_ids[:k]]
    dcg = dcg_at_k(rels, k)
    ideal_len = min(len(relevant_set), k)
    idcg = dcg_at_k([1] * ideal_len, k)
    return dcg / idcg if idcg > 0 else 0.0


def recall_at_k(retrieved_ids, relevant_set, k):
    if not relevant_set:
        return 0.0
    retrieved_set = set(retrieved_ids[:k])
    return len(retrieved_set & relevant_set) / len(relevant_set)


def main():
    print("Phase 2.2 — Retrieval benchmark")
    print(f"  Corpus: {CLEANED_DIR}")
    print(f"  Top-K: {TOP_K}  nDCG@{K_NDCG}  recall@{K_RECALL}")
    print(f"  MAX_DOC_CHARS: {MAX_DOC_CHARS}  BATCH_SIZE: {BATCH_SIZE}")
    print()

    queries = load_queries()
    all_docs = load_all_docs()
    print(f"Loaded {len(queries)} queries, {len(all_docs)} corpus docs")

    # Sanity: every queried area must have docs in corpus
    corpus_areas = {d["metadata"].get("kecamatan", "") for d in all_docs}
    for q in queries:
        if q["area"] not in corpus_areas:
            print(f"  ⚠ {q['id']} area {q['area']!r} NOT in corpus areas")

    if CHROMA_DIR.exists():
        print(f"Wiping {CHROMA_DIR}")
        shutil.rmtree(CHROMA_DIR)

    client = chromadb.PersistentClient(path=str(CHROMA_DIR))

    results = {}
    for model_key, cfg in MODELS.items():
        print(f"\n{'=' * 64}")
        print(f"Model: {model_key} ({cfg['name']})")
        print(f"  doc_prefix={cfg['doc_prefix']!r}  query_prefix={cfg['query_prefix']!r}")
        print(f"{'=' * 64}")

        t0 = time.perf_counter()
        model = SentenceTransformer(
            cfg["name"],
            model_kwargs={"attn_implementation": "eager"},
        )
        load_s = time.perf_counter() - t0
        print(f"Model loaded in {load_s:.1f}s")

        col_name = f"poc_{model_key}"
        col, encode_s = build_collection(client, col_name, model, cfg["doc_prefix"], all_docs)

        per_query = []
        for q in queries:
            relevant_set = set(q["relevant_doc_ids"])
            retrieved = query_collection(col, model, q["query"], q["area"], cfg["query_prefix"])
            n_hits_5 = sum(1 for rid in retrieved[:5] if rid in relevant_set)
            ndcg5 = ndcg_at_k(retrieved, relevant_set, K_NDCG)
            rec5 = recall_at_k(retrieved, relevant_set, K_RECALL)
            per_query.append({
                "id": q["id"],
                "query": q["query"],
                "area": q["area"],
                "n_relevant": len(relevant_set),
                "n_area_docs": sum(1 for d in all_docs if d["metadata"].get("kecamatan") == q["area"]),
                "hits_in_5": n_hits_5,
                "ndcg_5": round(ndcg5, 4),
                "recall_5": round(rec5, 4),
                "top_5_ids": retrieved[:5],
            })

        avg_ndcg = sum(p["ndcg_5"] for p in per_query) / len(per_query)
        avg_recall = sum(p["recall_5"] for p in per_query) / len(per_query)
        avg_hits = sum(p["hits_in_5"] for p in per_query) / len(per_query)

        results[model_key] = {
            "model_name": cfg["name"],
            "load_s": round(load_s, 1),
            "encode_s": round(encode_s, 1),
            "avg_ndcg_5": round(avg_ndcg, 4),
            "avg_recall_5": round(avg_recall, 4),
            "avg_hits_in_5": round(avg_hits, 2),
            "per_query": per_query,
        }

        print(f"\nSummary for {model_key}:")
        print(f"  avg nDCG@5:    {avg_ndcg:.4f}")
        print(f"  avg recall@5:  {avg_recall:.4f}")
        print(f"  avg hits@5:    {avg_hits:.2f}  (of avg {sum(p['n_relevant'] for p in per_query)/len(per_query):.1f} relevant)")

        del model

    # Headline comparison
    b, e = results["bge_m3"], results["e5_small"]
    print(f"\n{'=' * 64}")
    print("HEADLINE COMPARISON")
    print(f"{'=' * 64}")
    print(f"{'metric':<22} {'bge-m3':>14} {'e5-small':>14} {'delta':>10} {'rel%':>8}")
    print("-" * 64)
    for key, label in [
        ("avg_ndcg_5", "avg_ndcg_5"),
        ("avg_recall_5", "avg_recall_5"),
        ("avg_hits_in_5", "avg_hits_in_5"),
        ("load_s", "load_s"),
        ("encode_s", "encode_s"),
    ]:
        bv, ev = b[key], e[key]
        delta = ev - bv
        rel = (delta / bv * 100) if bv else 0
        print(f"{label:<22} {bv:>14.4f} {ev:>14.4f} {delta:>+10.4f} {rel:>+7.1f}%")

    # Per-query table
    print(f"\n{'=' * 64}")
    print("PER-QUERY DETAIL (sorted by delta nDCG@5, worst regressions first)")
    print(f"{'=' * 64}")
    rows = []
    for bq, eq in zip(b["per_query"], e["per_query"]):
        rows.append((bq, eq, eq["ndcg_5"] - bq["ndcg_5"]))
    rows.sort(key=lambda r: r[2])

    print(f"{'id':<5} {'area':<20} {'query':<32} {'rel':<4} {'bge_ndcg':>9} {'e5_ndcg':>9} {'Δndcg':>8} {'bge_rec':>8} {'e5_rec':>8}")
    print("-" * 110)
    for bq, eq, d in rows:
        print(f"{bq['id']:<5} {bq['area'][:19]:<20} {bq['query'][:31]:<32} {bq['n_relevant']:<4} "
              f"{bq['ndcg_5']:>9.4f} {eq['ndcg_5']:>9.4f} {d:>+8.4f} {bq['recall_5']:>8.4f} {eq['recall_5']:>8.4f}")

    out = RESULTS_DIR / "bench_retrieval_results.json"
    out.write_text(json.dumps(results, indent=2))
    print(f"\nResults written: {out}")


if __name__ == "__main__":
    main()
