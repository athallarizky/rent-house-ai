#!/usr/bin/env python3
"""Phase 2.1b — Re-label queries.json with INCLUSIVE programmatic criteria.

The original hand-labels picked top-5 docs per query, which made the benchmark
noisy: for facility queries (wifi, ac, etc.) many docs match the criterion,
and the model views them as roughly equivalent. nDCG@5 then mostly measures
"did the model pick MY 5 out of 30 valid candidates?" — not a useful signal.

This script re-labels each query with ALL docs in the area that match a clear,
programmatic criterion. The criteria are baked into the script per-query for
transparency. Result: honest labels that make recall@5 and nDCG@5 meaningful.

Output: poc/queries.json (rewritten with expanded labels + updated rationale).
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLEANED_DIR = ROOT / "data" / "cleaned"
QUERY_PATH = Path(__file__).resolve().parent / "queries.json"

# Load corpus
all_docs_by_area = {}
for p in sorted(CLEANED_DIR.glob("*_docs.json")):
    area = p.stem.replace("_docs", "")
    all_docs_by_area[area] = json.loads(p.read_text())


def tag_match(doc, required_tags):
    """True if doc.metadata.tags contains ALL required tags (pipe-separated)."""
    tags = (doc["metadata"].get("tags") or "").lower()
    if not tags:
        return False
    tag_set = set(tags.split("|"))
    return all(t in tag_set for t in required_tags)


def text_mention(doc, patterns, logic="any"):
    """True if doc.text matches patterns (regex, IGNORECASE).

    logic='any' → OR;  logic='all' → AND.
    """
    text = doc.get("text", "")
    if logic == "all":
        return all(re.search(p, text, re.IGNORECASE) for p in patterns)
    return any(re.search(p, text, re.IGNORECASE) for p in patterns)


def gender_match(doc, genders):
    """True if doc.metadata.gender is in genders list (case-insensitive)."""
    g = (doc["metadata"].get("gender") or "").lower()
    return g in genders


def has_24h(doc):
    return bool(doc["metadata"].get("is_24h"))


def price_in_range(doc, low, high):
    pmin = doc["metadata"].get("price_min", 0) or 0
    return low <= pmin <= high


def review_count_at_least(doc, n):
    return (doc["metadata"].get("review_count") or 0) >= n


def rating_at_least(doc, r):
    return (doc["metadata"].get("rating") or 0) >= r


# Per-query labeling criteria.
# Each entry: (query_id, predicate_function taking doc -> bool)
# Predicates are designed to match the SEMANTIC INTENT of the query.
LABELERS = {
    # === Facility queries: ALL docs in area with the relevant tag(s) ===
    "q01": lambda d: tag_match(d, ["wifi"]),  # wifi kenceng buat wfh
    "q04": lambda d: tag_match(d, ["ac", "parkir"]),  # ac + parkir (conjunction)
    "q05": lambda d: tag_match(d, ["kamar_mandi_dalam"]),
    "q08": lambda d: tag_match(d, ["dapur"]),
    "q09": lambda d: tag_match(d, ["ac"]),  # kamar ber ac
    "q10": lambda d: text_mention(d, [r"\bluas\b", r"spacious", r"kamar besar"]),  # 'luas' applies to room
    "q12": lambda d: tag_match(d, ["wifi"]),  # wifi fiber cepat → same wifi set
    "q13": lambda d: tag_match(d, ["parkir"]) and text_mention(d, [r"\bmotor\b", r"\baman\b"]),
    "q17": lambda d: text_mention(d, [r"\bbersih\b", r"\brapi\b"]) and rating_at_least(d, 4.5),
    "q20": lambda d: tag_match(d, ["ac", "kamar_mandi_dalam"]),  # conjunction
    "q21": lambda d: tag_match(d, ["wifi"]),
    "q23": lambda d: tag_match(d, ["parkir"]) and text_mention(d, [r"\bluas\b", r"\bmobil\b", r"garasi"]),
    # === Gender queries: ALL docs in area with matching gender ===
    # 'campur' counts as both putra and putri (mixed accepts both)
    "q02": lambda d: gender_match(d, ["putri", "wanita", "perempuan", "campur"]),
    "q15": lambda d: gender_match(d, ["putri", "wanita", "perempuan"])
            and text_mention(d, [r"kampus|mahasiswa|kuliah|universitas"]),
    "q24": lambda d: gender_match(d, ["putra", "pria", "laki-laki", "campur"]),
    # === Compound: gender + facility ===
    "q03": lambda d: gender_match(d, ["putra", "pria", "laki-laki", "campur", ""])
            and text_mention(d, [r"stasiun|kereta api"]),
    "q07": lambda d: gender_match(d, ["putri", "wanita", "perempuan"])
            and text_mention(d, [r"cctv|satpam|security|\baman\b"]),
    "q19": lambda d: gender_match(d, ["putri", "wanita", "perempuan", "campur"])
            and text_mention(d, [r"satpam|security|cctv"]),
    # === Location queries: docs whose reviews name the location ===
    "q06": lambda d: text_mention(d, [r"kampus|mahasiswa|kuliah|universitas"]),
    "q14": lambda d: text_mention(d, [r"halte|transjakarta|busway|\bTJ\b"]),
    # === Specific structured fields ===
    "q11": lambda d: has_24h(d),
    "q16": lambda d: price_in_range(d, 700000, 1500000) and rating_at_least(d, 4.0),
    "q18": lambda d: text_mention(d, [r"\bkerja\b", r"karyawan", r"\bpekerja\b"]),
    "q22": lambda d: review_count_at_least(d, 20) and rating_at_least(d, 4.5),
    "q25": lambda d: text_mention(d, [r"\bharian\b", r"sewa harian", r"daily rent"]),
}


def main():
    data = json.loads(QUERY_PATH.read_text())

    print(f"{'id':<5} {'area':<22} {'old':<4} {'new':<5} {'criterion':<55}")
    print("-" * 95)

    for q in data["queries"]:
        qid = q["id"]
        if qid not in LABELERS:
            print(f"{qid:<5} {q['area']:<22} {len(q['relevant_doc_ids']):<4} {'?':<5} NO LABELER DEFINED")
            continue

        pred = LABELERS[qid]
        area_docs = all_docs_by_area.get(q["area"], [])
        new_ids = [d["doc_id"] for d in area_docs if pred(d)]

        old_count = len(q["relevant_doc_ids"])
        q["relevant_doc_ids"] = new_ids
        # Update rationale to reflect inclusive labeling
        criterion_name = pred.__doc__ or "(see LABELERS in relabel_queries.py)"
        q["rationale"] = (
            f"Inclusive re-label (relabel_queries.py): {criterion_name}. "
            f"Matches {len(new_ids)} of {len(area_docs)} docs in {q['area']}."
        )

        print(f"{qid:<5} {q['area']:<22} {old_count:<4} {len(new_ids):<5} {q['query'][:54]}")

    # Update _meta to reflect new labeling methodology
    data["_meta"]["labeling_convention"]["criteria"] = [
        "INCLUSIVE (programmatic re-label, 2026-06-21): for each query, label ALL docs in the area that match a clear criterion (facility tag, gender, location mention, etc.). Old hand-labels picked top-5 by rating which made the benchmark noisy — for facility queries many docs match and the model views them as equivalent.",
        "Facility queries: ALL docs whose metadata.tags contains the required tag(s). Conjunction queries (q04, q20, q23) require ALL listed tags.",
        "Gender queries: ALL docs with matching gender in metadata. 'campur' counts as both putri and putri (mixed accepts both).",
        "Location queries (q03, q06, q14): ALL docs whose review text mentions the location by name.",
        "Compound queries (q07, q15, q19): ALL docs matching both constraints.",
        "Price queries (q16): ALL docs with price_min in [low, high] range.",
        "Quality queries (q17): ALL docs with rating>=4.5 AND review text mentions the quality word.",
        "Discovery queries (q22): ALL docs with review_count >= N AND rating >= R.",
      ]
    data["_meta"]["labeling_convention"]["conservative_rule"] = (
      "Programmatic, deterministic. Inclusive: ALL matching docs are labeled relevant. "
      "This makes recall@5 the primary metric (what fraction of valid matches did the model surface?) "
      "and nDCG@5 measures top-5 purity."
    )
    data["_meta"]["relabel_history"] = [
        "2026-06-21 initial: top-5 by rating per area (conservative, manual). Noisy for facility queries.",
        "2026-06-21 v2: programmatic inclusive labels. Now matches semantic intent of each query.",
    ]

    QUERY_PATH.write_text(json.dumps(data, indent=2))
    print(f"\nWrote: {QUERY_PATH}")
    print(f"Total labels: {sum(len(q['relevant_doc_ids']) for q in data['queries'])}")


if __name__ == "__main__":
    main()
