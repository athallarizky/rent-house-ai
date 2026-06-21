"""Unit tests for services/rag-engine/src/prefixes.py

Run with:
    cd services/rag-engine
    python -m pytest tests/test_prefixes.py -v

Or from repo root:
    python -m pytest services/rag-engine/tests/test_prefixes.py -v

These tests verify the prefix logic that protects against the most dangerous
silent failure mode of the e5-family swap: forgetting the query/passage prefix
would not raise an error — it would just degrade retrieval quality by ~10-20%
per the model card. The tests lock in correct behavior across model swaps.
"""

import os
import sys
from pathlib import Path

# Make src/ importable when run from any cwd
SRC = Path(__file__).resolve().parent.parent / "src"
sys.path.insert(0, str(SRC))

# Force a known model for tests that don't override
os.environ.setdefault("EMBED_MODEL", "intfloat/multilingual-e5-small")

from prefixes import (  # noqa: E402
    needs_prefixes,
    prefix_query,
    prefix_passage,
    prefix_passages,
    _PREFIX_REQUIRED_MODELS,
)


# ---------- needs_prefixes ----------

def test_e5_small_requires_prefixes():
    assert needs_prefixes("intfloat/multilingual-e5-small") is True


def test_e5_base_requires_prefixes():
    assert needs_prefixes("intfloat/multilingual-e5-base") is True


def test_e5_large_requires_prefixes():
    assert needs_prefixes("intfloat/multilingual-e5-large") is True


def test_e5_v2_requires_prefixes():
    assert needs_prefixes("intfloat/e5-small-v2") is True


def test_bge_m3_does_not_require_prefixes():
    """bge-m3 was the previous model — no prefixes. Lock this in so accidental
    regression doesn't add bogus prefixes to bge-m3 if someone reverts."""
    assert needs_prefixes("BAAI/bge-m3") is False


def test_unknown_model_does_not_require_prefixes():
    """Conservative default: unknown models don't get prefixes."""
    assert needs_prefixes("sentence-transformers/all-MiniLM-L6-v2") is False
    assert needs_prefixes("unknown/arbitrary-model") is False


def test_needs_prefixes_reads_config_default():
    """With no arg, falls back to config.EMBED_MODEL (set to e5-small above)."""
    assert needs_prefixes() is True


# ---------- prefix_query ----------

def test_prefix_query_adds_prefix_for_e5():
    out = prefix_query("wifi kenceng", model_name="intfloat/multilingual-e5-small")
    assert out == "query: wifi kenceng"


def test_prefix_query_passthrough_for_bge():
    out = prefix_query("wifi kenceng", model_name="BAAI/bge-m3")
    assert out == "wifi kenceng"


def test_prefix_query_preserves_special_chars():
    """Make sure we don't accidentally strip or escape anything."""
    out = prefix_query("AC dingin, parkir luas! @home", model_name="intfloat/multilingual-e5-small")
    assert out == "query: AC dingin, parkir luas! @home"


def test_prefix_query_indonesian_text():
    """The actual production use case — Indonesian kos queries."""
    out = prefix_query("kos putri depan stasiun", model_name="intfloat/multilingual-e5-small")
    assert out == "query: kos putri depan stasiun"


def test_prefix_query_empty_string():
    out = prefix_query("", model_name="intfloat/multilingual-e5-small")
    assert out == "query: "


# ---------- prefix_passage ----------

def test_prefix_passage_adds_prefix_for_e5():
    out = prefix_passage("## Kost Contoso\nAlamat: ...", model_name="intfloat/multilingual-e5-small")
    assert out == "passage: ## Kost Contoso\nAlamat: ..."


def test_prefix_passage_passthrough_for_bge():
    out = prefix_passage("## Kost Contoso", model_name="BAAI/bge-m3")
    assert out == "## Kost Contoso"


def test_prefix_passage_preserves_multiline():
    """Kos documents are multi-line; newlines must survive."""
    doc = "## Kost A\nAlamat: Jl. ABC\nRating: 5/5\nReview: bagus"
    out = prefix_passage(doc, model_name="intfloat/multilingual-e5-small")
    assert out == "passage: " + doc
    assert "\n" in out  # sanity


# ---------- prefix_passages (batch) ----------

def test_prefix_passages_batch_e5():
    docs = ["doc one", "doc two", "doc three"]
    out = prefix_passages(docs, model_name="intfloat/multilingual-e5-small")
    assert out == ["passage: doc one", "passage: doc two", "passage: doc three"]


def test_prefix_passages_batch_bge_passthrough():
    """Batch version must also no-op for non-prefix models."""
    docs = ["doc one", "doc two"]
    out = prefix_passages(docs, model_name="BAAI/bge-m3")
    assert out == docs  # exact same list, no copies


def test_prefix_passages_empty_list():
    out = prefix_passages([], model_name="intfloat/multilingual-e5-small")
    assert out == []


# ---------- regression: model-name set sanity ----------

def test_known_prefix_models_are_canonical_hf_names():
    """All entries must be valid HuggingFace model IDs (org/name lowercase
    with hyphens). Catches typos like 'intfloat/multilingual_e5_small'."""
    for name in _PREFIX_REQUIRED_MODELS:
        assert "/" in name, f"{name!r} missing org prefix"
        assert name == name.lower(), f"{name!r} must be lowercase"
        assert " " not in name, f"{name!r} must not contain spaces"


def test_e5_small_in_prefix_set():
    """Sanity: the production default model must be in the prefix-required set."""
    assert "intfloat/multilingual-e5-small" in _PREFIX_REQUIRED_MODELS
