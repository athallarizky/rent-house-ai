"""LLM summarization via Z.AI glm-air (OpenAI-compatible)."""

import os
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

    context_parts = []
    for i, item in enumerate(results[:5], 1):
        meta = item["metadata"]
        text = item.get("text", "")
        score = item.get("score", 0)
        context_parts.append(f"=== Kos #{i} (score: {score}) ===\n{text}")

    context = "\n\n".join(context_parts)

    user_message = f"Pertanyaan user: {query}\n\nData kos yang ditemukan:\n\n{context}\n\nBerikan rekomendasi kos terbaik berdasarkan data di atas."

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
