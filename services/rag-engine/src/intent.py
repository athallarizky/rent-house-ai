"""LLM-powered intent extraction — parse natural language kos query into structured params.

Called as a subprocess by the API orchestrator. Uses the same Z.AI key/model as summarize.py.
"""

import json
import os
import sys
from typing import Dict, Any

from .config import LLM_BASE_URL, LLM_API_KEY, LLM_MODEL

INTENT_PROMPT = """You are an intent parser for an Indonesian kos (boarding house) search system.
Extract structured search parameters from the user's natural-language query.

Return ONLY valid JSON (no markdown, no explanation):
{
  "area": "<city/district/regency from query, or null>",
  "poi": "<the POI/landmark name (stasiun, mall, terminal, universitas, etc.), or null>",
  "tags": ["<facility tags from query>"],
  "gender": "putri" | "putra" | "campur" | null,
  "budget_min": "<number in rupiah or null>",
  "budget_max": "<number in rupiah or null>",
  "keywords": ["<important descriptive search terms>"]
}

Facility tags to detect (only include if explicitly mentioned or strongly implied):
wifi, ac, parkir, dapur, kamar_mandi_dalam, laundry, tv, kasur, lemari, listrik, keamanan.

Area detection:
- "Cengkareng", "Jakarta Barat", "Bandung", "Surabaya", "Yogyakarta", "Tangerang", "Bekasi", "Depok", "Bogor", "Semarang", etc.
- Returns the area name if a specific district/regency/city is mentioned.
- IMPORTANT: If the query mentions a province only (e.g., "Bali", "Jawa Barat", "Jawa Timur"), return the provincial capital city instead. Example: "kos di Bali" → area: "Denpasar". "kos di Jawa Barat" → area: "Bandung".
- IMPORTANT: If the query mentions a landmark/POI (stasiun, mall, terminal, universitas, etc.), return area=null AND set the "poi" field to the landmark name. Example: "kos sekitar stasiun poris" → area: null, poi: "stasiun poris".
- Returns null for both if no specific area can be determined.

Gender detection:
- "cewek/perempuan/putri/wanita/cewe" → putri
- "cowok/pria/putra/laki/cowo" → putra
- "campur" → campur
- null otherwise.

Budget detection:
- "di bawah 2 juta" → budget_max=2000000
- "1.5jt" or "1.5 jt" → budget_min=1500000
- "800rb-1jt" → budget_min=800000, budget_max=1000000
- "Rp 500.000" → budget_min=500000
- null if no price mentioned.

Keywords: important descriptive terms not captured in tags/gender/budget (e.g. "kenceng", "bersih", "nyaman", "luas", "dekat stasiun", "strategis")."""


def extract_intent(query: str) -> Dict[str, Any]:
    """Parse a natural-language query into structured search params via LLM."""
    api_key = LLM_API_KEY or os.environ.get("ZAI_API_KEY", "")
    if not api_key:
        return _empty_result()

    try:
        import openai
        client = openai.OpenAI(api_key=api_key, base_url=LLM_BASE_URL)

        response = client.chat.completions.create(
            model=LLM_MODEL,
            messages=[
                {"role": "system", "content": "You are a JSON-only API. Return ONLY valid JSON, no markdown, no explanation."},
                {"role": "user", "content": f"{INTENT_PROMPT}\n\nQuery: {query}"},
            ],
            max_tokens=200,
            temperature=0,
        )

        content = response.choices[0].message.content.strip()

        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:]) if len(lines) > 1 else content[3:]
            if content.endswith("```"):
                content = content[:-3]
        content = content.strip()

        parsed = json.loads(content)

        return {
            "area": parsed.get("area"),
            "poi": parsed.get("poi"),
            "tags": [t.lower() for t in (parsed.get("tags") or [])],
            "gender": parsed.get("gender"),
            "budget_min": parsed.get("budget_min"),
            "budget_max": parsed.get("budget_max"),
            "keywords": parsed.get("keywords") or [],
        }
    except Exception as e:
        print(f"[intent] extraction failed: {e}", file=sys.stderr)
        return _empty_result()


def _empty_result() -> Dict[str, Any]:
    return {"area": None, "poi": None, "tags": [], "gender": None, "budget_min": None, "budget_max": None, "keywords": []}


if __name__ == "__main__":
    query = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else ""
    if not query:
        query = sys.stdin.read().strip()
    result = extract_intent(query)
    print(json.dumps(result))
