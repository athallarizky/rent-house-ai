"""Centralized prefix helper for asymmetric retrieval embedding models.

Some embedding models — notably the `intfloat/multilingual-e5-*` family — are
trained with mandatory `query: ` and `passage: ` prefixes on input texts.
Omitting them silently degrades retrieval quality (per the model card:
"otherwise you will see a performance degradation").

This module is the **single source of truth** for prefix application. Both
`ingest.py` (document encoding) and `search.py` (query encoding) call into
here, so a future model swap or prefix-rule change is a one-file edit.

Usage:
    from .prefixes import prefix_query, prefix_passage
    q_emb = model.encode([prefix_query(q)])         # search.py
    p_emb = model.encode([prefix_passage(p) for p in docs])  # ingest.py

Models that don't use prefixes (bge-m3, mpnet, minilm, etc.) are detected by
name and return the input unchanged — so the same code path works for any
SentenceTransformer model without per-call-site conditionals.
"""

import os
from typing import Optional

# Models that require `query: ` / `passage: ` prefixes for asymmetric retrieval.
# Adding a model here automatically opts it into prefix application everywhere.
_PREFIX_REQUIRED_MODELS = frozenset({
    "intfloat/multilingual-e5-small",
    "intfloat/multilingual-e5-base",
    "intfloat/multilingual-e5-large",
    "intfloat/e5-small-v2",
    "intfloat/e5-base-v2",
    "intfloat/e5-large-v2",
})


def _resolve_model_name(model_name: Optional[str]) -> str:
    """Use explicitly-passed model name, else fall back to config.EMBED_MODEL.

    Tries package import (production), then env var (used by tests + any
    non-package context). This dual path lets the module be unit-tested
    without spinning up the full rag-engine package.
    """
    if model_name:
        return model_name
    try:
        from .config import EMBED_MODEL  # type: ignore[import]
    except ImportError:
        EMBED_MODEL = os.environ.get("EMBED_MODEL", "intfloat/multilingual-e5-small")
    return EMBED_MODEL


def needs_prefixes(model_name: Optional[str] = None) -> bool:
    """True if the model requires `query: `/`passage: ` prefixes.

    Public so callers / tests can introspect without applying.
    """
    return _resolve_model_name(model_name) in _PREFIX_REQUIRED_MODELS


def prefix_query(text: str, model_name: Optional[str] = None) -> str:
    """Add the `query: ` prefix if the model requires it; else pass through."""
    if needs_prefixes(model_name):
        return f"query: {text}"
    return text


def prefix_passage(text: str, model_name: Optional[str] = None) -> str:
    """Add the `passage: ` prefix if the model requires it; else pass through."""
    if needs_prefixes(model_name):
        return f"passage: {text}"
    return text


def prefix_passages(texts: list, model_name: Optional[str] = None) -> list:
    """Batch version of prefix_passage — applies to each text in the list."""
    if needs_prefixes(model_name):
        return [f"passage: {t}" for t in texts]
    return texts
