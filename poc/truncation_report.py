#!/usr/bin/env python3
"""Phase 3.1 — Truncation impact of e5-small's 512-token window vs bge-m3's 8192.

Tokenizes every doc in data/cleaned/*_docs.json with the e5-small tokenizer
(same family production would use) and reports:

  - % of docs fully under 512 tokens (no truncation)
  - mean / median / p90 / p99 / max token count
  - for over-long docs: how many chars of review text get cut
  - same numbers at production MAX_DOC_CHARS=4000 cap, for comparison

Also tokenizes with bge-m3's tokenizer for the same docs (control group) to
show how much of the gap is "e5-small tokenizer is more verbose" vs "the docs
are genuinely too long".

This is the single most decision-relevant output of Sprint 10 per tasks.md.
"""

import json
import statistics
from pathlib import Path

from transformers import AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent
CLEANED_DIR = ROOT / "data" / "cleaned"
RESULTS_DIR = Path(__file__).resolve().parent / "_results"
RESULTS_DIR.mkdir(exist_ok=True)

E5_TOKENIZER = "intfloat/multilingual-e5-small"
BGE_TOKENIZER = "BAAI/bge-m3"
E5_MAX_TOKENS = 512
PROD_MAX_CHARS = 4000


def load_all_docs():
    docs = []
    for p in sorted(CLEANED_DIR.glob("*_docs.json")):
        docs.extend(json.loads(p.read_text()))
    return docs


def percentile(sorted_list, p):
    if not sorted_list:
        return 0
    k = (len(sorted_list) - 1) * p
    f = int(k)
    c = min(f + 1, len(sorted_list) - 1)
    if f == c:
        return sorted_list[f]
    return sorted_list[f] + (sorted_list[c] - sorted_list[f]) * (k - f)


def analyze(tokenizer, name, docs):
    # Full-doc token counts
    full_texts = [d["text"] for d in docs]
    full_counts = tokenizer(full_texts, add_special_tokens=True)["input_ids"]
    full_token_lens = [len(c) for c in full_counts]

    # Production-capped token counts (after MAX_DOC_CHARS=4000 cap, matching ingest.py:86)
    capped_texts = [t[:PROD_MAX_CHARS] for t in full_texts]
    capped_counts = tokenizer(capped_texts, add_special_tokens=True)["input_ids"]
    capped_token_lens = [len(c) for c in capped_counts]

    # For e5-small: include the "passage: " prefix in the count
    if "e5" in name.lower():
        prefixed_texts = ["passage: " + t[:PROD_MAX_CHARS] for t in full_texts]
        prefixed_counts = tokenizer(prefixed_texts, add_special_tokens=True)["input_ids"]
        prefixed_token_lens = [len(c) for c in prefixed_counts]
    else:
        prefixed_token_lens = capped_token_lens  # bge-m3 uses no prefix

    # Use the prefixed lens as the "production-realistic" lens for that model
    prod_lens = prefixed_token_lens

    over_limit = [i for i, n in enumerate(prod_lens) if n > 512] if "e5" in name.lower() else []
    pct_over = (len(over_limit) / len(prod_lens) * 100) if prod_lens else 0

    # For over-limit docs at e5-small: compute how many chars of the original
    # text would be lost when tokenizer truncates at 512 tokens.
    chars_lost = []
    if "e5" in name.lower():
        for i in over_limit:
            # Decode the first 512 tokens to see how much text survives
            truncated_ids = full_counts[i][:512]
            survived_text = tokenizer.decode(truncated_ids, skip_special_tokens=True)
            # Strip the "passage: " prefix from survived for fair comparison
            if survived_text.startswith("passage: "):
                survived_text = survived_text[len("passage: "):]
            original_len = len(full_texts[i])
            survived_len = len(survived_text)
            lost = max(0, original_len - survived_len)
            chars_lost.append(lost)

    summary = {
        "tokenizer": name,
        "n_docs": len(prod_lens),
        "max_tokens_limit": 512 if "e5" in name.lower() else 8192,
        "full_text_mean": round(statistics.mean(full_token_lens), 1),
        "full_text_median": int(statistics.median(full_token_lens)),
        "full_text_p90": int(percentile(sorted(full_token_lens), 0.90)),
        "full_text_p99": int(percentile(sorted(full_token_lens), 0.99)),
        "full_text_max": max(full_token_lens),
        "prod_capped_mean": round(statistics.mean(prod_lens), 1),
        "prod_capped_median": int(statistics.median(prod_lens)),
        "prod_capped_p90": int(percentile(sorted(prod_lens), 0.90)),
        "prod_capped_p99": int(percentile(sorted(prod_lens), 0.99)),
        "prod_capped_max": max(prod_lens),
        "n_over_limit": len(over_limit),
        "pct_over_limit": round(pct_over, 2),
    }
    if chars_lost:
        summary["over_limit_chars_lost_mean"] = round(statistics.mean(chars_lost), 0)
        summary["over_limit_chars_lost_median"] = int(statistics.median(chars_lost))
        summary["over_limit_chars_lost_p90"] = int(percentile(sorted(chars_lost), 0.90))
        summary["over_limit_chars_lost_total"] = sum(chars_lost)

    return summary


def main():
    print("Phase 3.1 — Truncation impact analysis")
    print(f"  Corpus: {CLEANED_DIR}")
    print(f"  e5-small max tokens: {E5_MAX_TOKENS}")
    print(f"  Production MAX_DOC_CHARS: {PROD_MAX_CHARS}")
    print()

    docs = load_all_docs()
    print(f"Loaded {len(docs)} docs")

    print("\nLoading e5-small tokenizer...")
    e5_tok = AutoTokenizer.from_pretrained(E5_TOKENIZER)
    print("Loading bge-m3 tokenizer...")
    bge_tok = AutoTokenizer.from_pretrained(BGE_TOKENIZER)

    print("\nAnalyzing e5-small...")
    e5_summary = analyze(e5_tok, "e5_small", docs)
    print("Analyzing bge-m3 (control)...")
    bge_summary = analyze(bge_tok, "bge_m3", docs)

    # Report
    print(f"\n{'=' * 76}")
    print(f"{'metric':<36} {'e5-small (512)':>16} {'bge-m3 (8192)':>16}")
    print(f"{'-' * 76}")
    rows = [
        ("n_docs", "n_docs", "d"),
        ("full_text_mean", "full-text mean tokens", ".1f"),
        ("full_text_median", "full-text median", "d"),
        ("full_text_p90", "full-text p90", "d"),
        ("full_text_p99", "full-text p99", "d"),
        ("full_text_max", "full-text max", "d"),
        ("prod_capped_mean", "prod-capped mean", ".1f"),
        ("prod_capped_median", "prod-capped median", "d"),
        ("prod_capped_p90", "prod-capped p90", "d"),
        ("prod_capped_p99", "prod-capped p99", "d"),
        ("prod_capped_max", "prod-capped max", "d"),
        ("n_over_limit", f"n over limit", "d"),
        ("pct_over_limit", "% over limit (truncated)", ".2f"),
    ]
    for key, label, fmt in rows:
        ev = e5_summary[key]
        bv = bge_summary[key]
        if fmt == "d":
            print(f"  {label:<34} {int(ev):>16} {int(bv):>16}")
        elif fmt == ".1f":
            print(f"  {label:<34} {ev:>16.1f} {bv:>16.1f}")
        else:
            print(f"  {label:<34} {ev:>16.2f} {bv:>16.2f}")

    if "over_limit_chars_lost_mean" in e5_summary:
        print(f"\n  On the {e5_summary['n_over_limit']} truncated docs (e5-small):")
        print(f"    chars lost per doc — mean {e5_summary['over_limit_chars_lost_mean']:.0f}, "
              f"median {e5_summary['over_limit_chars_lost_median']}, "
              f"p90 {e5_summary['over_limit_chars_lost_p90']}")
        print(f"    total review text lost across corpus: {e5_summary['over_limit_chars_lost_total']:,} chars")

    # Decision verdict
    pct_over = e5_summary["pct_over_limit"]
    print(f"\n{'=' * 76}")
    print("VERDICT")
    print(f"{'=' * 76}")
    if pct_over > 25:
        verdict = f"MATERIAL TRUNCATION ({pct_over:.1f}% > 25% threshold) — Phase 3.2 chunk_probe REQUIRED"
    elif pct_over > 10:
        verdict = f"MODERATE TRUNCATION ({pct_over:.1f}%) — Phase 3.2 recommended"
    elif pct_over > 0:
        verdict = f"MINOR TRUNCATION ({pct_over:.1f}%) — Phase 3.2 optional"
    else:
        verdict = f"NO TRUNCATION ({pct_over:.1f}%) — Phase 3.2 not needed"
    print(verdict)

    out = RESULTS_DIR / "truncation_report.json"
    out.write_text(json.dumps({
        "e5_small": e5_summary,
        "bge_m3": bge_summary,
        "verdict": verdict,
    }, indent=2))
    print(f"\nResults written: {out}")


if __name__ == "__main__":
    main()
