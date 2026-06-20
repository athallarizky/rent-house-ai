"""Singleton model cache — loads bge-m3 once per process lifetime.

Used by both subprocess and in-process callers. The SentenceTransformer model
is ~2.3 GB and takes 3-5s to load; reusing it across requests eliminates that
overhead completely.
"""

from sentence_transformers import SentenceTransformer

from .config import EMBED_MODEL

_model = None


def get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(
            EMBED_MODEL, model_kwargs={"attn_implementation": "eager"}
        )
    return _model
