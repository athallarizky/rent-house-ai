"""Ingest RAG documents into ChromaDB."""

import json
from pathlib import Path
from typing import List, Dict, Any

from .config import COLLECTION_NAME
from .db import get_client, reset_collection_cache
from .model_cache import get_model
from .prefixes import prefix_passage


def load_docs(docs_path: Path) -> List[Dict[str, Any]]:
    with open(docs_path) as f:
        return json.load(f)


def get_or_create_collection():
    client = get_client()
    try:
        collection = client.get_collection(COLLECTION_NAME)
    except Exception:
        collection = client.create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
        reset_collection_cache()
    return collection


def _sanitize_metadata(meta: Dict[str, Any]) -> Dict[str, Any]:
    clean: Dict[str, Any] = {}
    for k, v in meta.items():
        if v is None:
            if k in ("lat", "lon", "rating", "review_count"):
                clean[k] = 0.0 if k in ("lat", "lon", "rating") else 0
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


def ingest(docs_path: Path, force: bool = False) -> Dict[str, Any]:
    docs = load_docs(docs_path)

    collection = get_or_create_collection()

    if force:
        try:
            get_client().delete_collection(COLLECTION_NAME)
        except Exception:
            pass
        reset_collection_cache()
        collection = get_or_create_collection()

    existing_ids = set()
    try:
        existing = collection.get(include=[])
        existing_ids = set(existing["ids"])
    except Exception:
        pass

    new_docs = [d for d in docs if d["doc_id"] not in existing_ids]

    if not new_docs:
        print(f"All {len(docs)} documents already indexed")
        return {"indexed": 0, "skipped": len(docs), "total": len(docs)}

    # Load the embedding model lazily (only when there's something to embed).
    model = get_model()

    ids = [d["doc_id"] for d in new_docs]
    texts = [d["text"] for d in new_docs]
    metadatas = [_sanitize_metadata(d["metadata"]) for d in new_docs]

    # bge-m3 supports an 8192-token context, so a batch of long docs produces a
    # huge attention buffer ([B,H,S,S]) and crashes with "Invalid buffer size".
    # Cap each doc to a safe char budget and encode in small batches.
    # Note (Sprint 11): e5-small truncates at 512 tokens (~1 500-2 000 chars)
    # natively; the cap below is still a safe upper bound for either model.
    # See docs/sprint-10/reports/ for the truncation analysis (9.6% of docs
    # exceed 512 tokens with e5-small — accepted trade-off).
    MAX_DOC_CHARS = 4000
    # Apply asymmetric-retrieval prefix (e5-family models). No-op for bge-m3.
    safe_texts = [prefix_passage(t[:MAX_DOC_CHARS]) for t in texts]
    print(f"Embedding {len(new_docs)} documents...")
    embeddings = model.encode(
        safe_texts, batch_size=8, show_progress_bar=True
    ).tolist()

    print(f"Inserting into ChromaDB ({COLLECTION_NAME})...")
    collection.add(ids=ids, embeddings=embeddings, documents=texts, metadatas=metadatas)

    return {
        "indexed": len(new_docs),
        "skipped": len(docs) - len(new_docs),
        "total": len(docs),
    }


if __name__ == "__main__":
    import sys
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/cleaned/cengkareng_docs.json")
    force = "--force" in sys.argv
    result = ingest(path, force=force)
    print(f"Done: {result}")
