"""ChromaDB client + collection singletons — Sprint 8 (T3.1).

`search()`, `list_kos()`, and `ingest()` previously opened a fresh
`chromadb.PersistentClient` on every call. Once the bge-m3 model became
resident in-process (Sprint 8), per-call client construction turned into the
next overhead. These singletons build the client + collection once per process
and reuse them.

`reset_collection_cache()` is called by ingest when it deletes/recreates the
collection (force path) so callers don't hold a stale handle.
"""
import chromadb
from .config import CHROMA_PATH, COLLECTION_NAME

_client = None
_collection = None


def get_client():
    """Return the process-wide PersistentClient (created lazily)."""
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path=CHROMA_PATH)
    return _client


def get_collection():
    """Return the kos collection, cached after first access (raises if absent)."""
    global _collection
    if _collection is None:
        _collection = get_client().get_collection(COLLECTION_NAME)
    return _collection


def reset_collection_cache() -> None:
    """Drop the cached collection handle — call after delete/recreate."""
    global _collection
    _collection = None


def delete_area_from_index(area: str) -> int:
    """Delete all vectors for one area (matched by metadata.kecamatan).

    Per-area, safe — does NOT touch other areas (unlike `ingest(force=True)`
    which calls `delete_collection` and nukes the whole DB). Returns the number
    of entries removed. Used by the Rebuild / Rescrape / Delete actions (Sprint 9).
    """
    col = get_collection()
    before = col.count()
    col.delete(where={"kecamatan": area})
    return before - col.count()
