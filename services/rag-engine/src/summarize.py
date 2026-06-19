"""LLM summarization via Z.AI glm-air (OpenAI-compatible)."""

import json
import os
import sys
from typing import List, Dict, Any

from .config import LLM_BASE_URL, LLM_API_KEY, LLM_MODEL


SYSTEM_PROMPT = """Kamu adalah asisten pencarian kos (kost) di Indonesia. 
Jawab pertanyaan user dalam Bahasa Indonesia. Gunakan data review kos yang diberikan.

Untuk setiap rekomendasi, sebutkan:
- Nama kos
- Rating dan jumlah review
- Fasilitas yang disebutkan (wifi, AC, parkir, dll)
- Highlight review positif dan negatif yang relevan dengan pertanyaan user
- Estimasi jarak jika user memberikan lokasi

Jika ada review yang menyebutkan masalah (wifi lemot, air mati, dll), jujur sampaikan.
Jangan mengarang informasi yang tidak ada di data."""


def summarize(
    query: str,
    results: List[Dict[str, Any]],
    model: str = LLM_MODEL,
) -> str:
    if not results:
        return "Maaf, tidak ada kos yang cocok dengan kriteria Anda."

    user_message = _build_user_message(query, results)

    api_key = LLM_API_KEY or os.environ.get("ZAI_API_KEY", "")
    if not api_key:
        return _format_fallback(results, query)

    try:
        import openai
        client = openai.OpenAI(api_key=api_key, base_url=LLM_BASE_URL)

        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            max_tokens=800,
            temperature=0.3,
        )
        return response.choices[0].message.content or ""

    except Exception as e:
        return _format_fallback(results, query, error=str(e))


def summarize_stream(
    query: str,
    results: List[Dict[str, Any]],
    model: str = LLM_MODEL,
):
    """Yield summary tokens incrementally. Falls back to chunked fallback text."""
    if not results:
        yield "Maaf, tidak ada kos yang cocok dengan kriteria Anda."
        return

    user_message = _build_user_message(query, results)

    api_key = LLM_API_KEY or os.environ.get("ZAI_API_KEY", "")
    if not api_key:
        for piece in _chunk_text(_format_fallback(results, query)):
            yield piece
        return

    try:
        import openai
        client = openai.OpenAI(api_key=api_key, base_url=LLM_BASE_URL)

        stream = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
            max_tokens=800,
            temperature=0.3,
            stream=True,
        )

        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
    except Exception as e:
        for piece in _chunk_text(_format_fallback(results, query, error=str(e))):
            yield piece


def _build_user_message(query: str, results: List[Dict[str, Any]]) -> str:
    context_parts = []
    for i, item in enumerate(results[:5], 1):
        meta = item["metadata"]
        text = item.get("text", "")
        score = item.get("score", 0)
        context_parts.append(f"=== Kos #{i} (score: {score}) ===\n{text}")

    context = "\n\n".join(context_parts)
    return (
        f"Pertanyaan user: {query}\n\n"
        f"Data kos yang ditemukan:\n\n{context}\n\n"
        f"Berikan rekomendasi kos terbaik berdasarkan data di atas."
    )


def _chunk_text(text: str, size: int = 12):
    """Split a complete string into small pieces for a pseudo-streaming fallback."""
    for i in range(0, len(text), size):
        yield text[i : i + size]


def stream_to_stdout(query: str, results: List[Dict[str, Any]], model: str = LLM_MODEL):
    """Stream summary tokens to stdout as JSON lines ({"t": "<token>"}).

    Designed to be invoked by the API's subprocess bridge so the parent process
    can read tokens incrementally without buffering.
    """
    for tok in summarize_stream(query, results, model):
        sys.stdout.write(json.dumps({"t": tok}) + "\n")
        sys.stdout.flush()


def _format_fallback(results: List[Dict], query: str, error: str = "") -> str:
    lines = [f"Pencarian: {query}"]
    if error:
        lines.append(f"(LLM tidak tersedia: {error})")
    lines.append("")
    for i, item in enumerate(results[:5], 1):
        meta = item["metadata"]
        tags = meta.get("tags", "").replace("|", ", ")
        lines.append(
            f"{i}. {meta['name']} — {meta['rating']}★ "
            f"({meta['review_count']} reviews) "
            f"[{tags}]"
        )
    return "\n".join(lines)
