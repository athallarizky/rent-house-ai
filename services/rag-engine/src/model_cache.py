"""Singleton model cache — loads the configured embedding model once per process.

Used by both subprocess and in-process callers. The SentenceTransformer model
is ~449 MB for `intfloat/multilingual-e5-small` (the default since Sprint 11)
and takes 10-25s to load cold; reusing it across requests eliminates that
overhead completely.

Override with the `EMBED_MODEL` env var to swap models (e.g. back to
`BAAI/bge-m3` for A/B testing — note that the ChromaDB collection must then
be wiped + re-ingested because the vector dimensions differ).
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
