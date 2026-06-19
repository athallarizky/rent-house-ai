"""Semantic search + metadata filter + geo radius."""

import math
from typing import List, Dict, Any, Optional

import chromadb
from sentence_transformers import SentenceTransformer

from .config import CHROMA_PATH, COLLECTION_NAME, EMBED_MODEL, SEARCH_TOP_K


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def search(
    query_text: str,
    kecamatan: Optional[str] = None,
    province: Optional[str] = None,
    min_rating: Optional[float] = None,
    tags: Optional[List[str]] = None,
    gender: Optional[str] = None,
    user_lat: Optional[float] = None,
    user_lon: Optional[float] = None,
    radius_km: Optional[float] = None,
    top_k: int = SEARCH_TOP_K,
) -> List[Dict[str, Any]]:
    client = chromadb.PersistentClient(path=CHROMA_PATH)
    collection = client.get_collection(COLLECTION_NAME)

    # attn_implementation="eager" avoids a PyTorch scaled_dot_product_attention
    # "Invalid buffer size" failure seen with bge-m3 on some setups.
    model = SentenceTransformer(
        EMBED_MODEL, model_kwargs={"attn_implementation": "eager"}
    )
    query_embedding = model.encode([query_text]).tolist()

    where: Optional[Dict] = _build_where(kecamatan, province, min_rating)

    results = collection.query(
        query_embeddings=query_embedding,
        n_results=top_k * 3,
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    items: List[Dict[str, Any]] = []
    if not results["ids"] or not results["ids"][0]:
        return items

    for i, doc_id in enumerate(results["ids"][0]):
        metadata = results["metadatas"][0][i] if results["metadatas"] else {}
        distance = results["distances"][0][i] if results["distances"] else 0
        items.append({
            "doc_id": doc_id,
            "metadata": metadata,
            "text": results["documents"][0][i] if results["documents"] else "",
            "distance": distance,
        })

    if tags:
        items = [it for it in items if _has_tags(it, tags)]
    if gender:
        items = [it for it in items if it["metadata"].get("gender") == gender]
    if user_lat is not None and user_lon is not None and radius_km is not None:
        items = [
            it for it in items
            if _within_radius(it, user_lat, user_lon, radius_km)
        ]

    items.sort(key=lambda x: x["distance"])
    return items[:top_k]


def _build_where(
    kecamatan: Optional[str],
    province: Optional[str],
    min_rating: Optional[float],
) -> Optional[Dict]:
    conditions: List[Dict] = []
    if kecamatan:
        conditions.append({"kecamatan": kecamatan})
    if province:
        conditions.append({"province": province})
    if min_rating is not None:
        conditions.append({"rating": {"$gte": min_rating}})

    if len(conditions) == 0:
        return None
    if len(conditions) == 1:
        return conditions[0]
    return {"$and": conditions}


def _has_tags(item: Dict, tags: List[str]) -> bool:
    item_tags = item["metadata"].get("tags", "")
    if not item_tags:
        return False
    tag_set = set(item_tags.split("|"))
    return all(t in tag_set for t in tags)


def _within_radius(item: Dict, lat: float, lon: float, radius_km: float) -> bool:
    ilat = item["metadata"].get("lat", 0)
    ilon = item["metadata"].get("lon", 0)
    if not ilat or not ilon:
        return False
    return haversine_km(lat, lon, ilat, ilon) <= radius_km


if __name__ == "__main__":
    import sys, json
    query = sys.argv[1] if len(sys.argv) > 1 else "wifi kencang"
    results = search(query, kecamatan="Cengkareng", top_k=5)
    for r in results:
        print(f"  {r['metadata']['name']} ({r['metadata']['rating']}★) dist={r['distance']:.3f}")
