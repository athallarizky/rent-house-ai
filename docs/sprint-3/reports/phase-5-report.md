# Phase 5 Report — Follow-up Chat Context

> Completed: 2026-06-20 | Sprint 3 — P0 #2

---

## 1. Overview

Before Phase 5, every chat message was an independent RAG query — the LLM had
no memory of prior turns. A follow-up like "yang di bawah 2 juta" would be
treated as a standalone query, losing the previous context (area, facilities,
recommendations).

Phase 5 passes the last conversation turn as `chat_history` through the full
pipeline, so the LLM can refine its previous answer.

```
Before:                          After:
"kos di Cengkareng wifi"         "kos di Cengkareng wifi"
  → LLM recommends 10 kos          → LLM recommends 10 kos

"yang di bawah 2 juta"           "yang di bawah 2 juta"
  → LLM sees ONLY this query       → LLM sees both messages
  → generic price-based search     → filters previous results by budget
```

---

## 2. How to Test

1. Start the stack, open `/search`
2. Type: `"kos di Cengkareng wifi kenceng"` → wait for LLM response
3. Type follow-up: `"yang di bawah 2 juta"`
4. The LLM response should reference prior context — e.g., it knows you're
   asking about kos in Cengkareng with wifi, not just "kos murah secara umum"
5. Type another follow-up: `"ada yang dekat stasiun?"` — context accumulates

**What to look for:**
- LLM mentions the previous area ("di Cengkareng") without being told again
- LLM references facilities from prior query ("wifi") 
- Follow-up is treated as a refinement, not a fresh search

**Verification via API:**
```bash
curl -X POST http://localhost:8080/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "yang di bawah 2 juta",
    "area": "Cengkareng",
    "stream": true,
    "chat_history": [
      {"role": "user", "content": "kos di Cengkareng wifi kenceng"},
      {"role": "assistant", "content": "Berikut rekomendasi kos dengan wifi di Cengkareng..."}
    ]
  }'
```

---

## 3. Changes

### 3a. `services/rag-engine/src/summarize.py` — Chat history in prompt

**`_build_user_message()`** now accepts optional `chat_history` param (list of
`{role, content}` dicts). When present, it adds a "Riwayat percakapan sebelumnya"
section at the top of the LLM prompt, limited to the last 6 messages (3 turns):

```
Riwayat percakapan sebelumnya:
User: kos di Cengkareng wifi kenceng
Asisten: Berikut rekomendasi kos dengan wifi di Cengkareng...

Pertanyaan user: yang di bawah 2 juta
```

**Function signatures updated:**
- `summarize(query, results, model, chat_history=None)`
- `summarize_stream(query, results, model, chat_history=None)`
- `stream_to_stdout(query, results, model, chat_history=None)`

All three pass `chat_history` through to `_build_user_message()`. Backward
compatible — `chat_history` defaults to `None` (no context).

### 3b. `api/src/orchestrator.py` — Pass chat_history via stdin

`format_results()` and `format_results_stream()` now:
- Accept optional `chat_history` param
- Include it in the JSON passed via stdin to the RAG subprocess
- The inline `-c` script reads `data.get('chat_history')` and passes it to
  `summarize()` / `stream_to_stdout()`

### 3c. `api/src/search.py` — `chat_history` in request + streaming

`SearchRequest` model now includes:
```python
chat_history: Optional[List[dict]] = None
```

Both streaming and non-streaming paths pass `req.chat_history` to
`format_results()` / `_stream_response()`.

### 3d. `web/src/lib/types.ts` — `SearchRequest.chat_history`

Added `chat_history?: Array<{ role: string; content: string }>` to the
`SearchRequest` interface.

### 3e. `web/src/components/ChatInterface.tsx` — History collection

`handleSendMessage()` now:
1. Collects the last assistant message + current user message from `messages` state
2. Passes them as `chatHistory` to `queryDataset()` (refine path on same district)
3. `queryDataset()` passes `chat_history` in the `streamSearch()` request

Fresh district loads (via `loadDistrict`) and error fallback paths do NOT
pass chat history — context is only relevant when refining within the same
district session.

---

## 4. Verification

| Check | Result |
|-------|--------|
| Python AST parse (`summarize.py`, `orchestrator.py`, `search.py`) | OK |
| `npm run check` | 0/0/0 (30 files) |
| `npm run build` | 3 pages built |
| `_build_user_message` with history | Correctly formats "Riwayat percakapan" section |
| `_build_user_message` without history | Identical to pre-Phase 5 output (backward compat) |
| Subprocess stdin passes `chat_history` | JSON includes `"chat_history": [...]` |
| Follow-up query in same district | Includes prior assistant+user pair |
| Follow-up across district switch | No history passed (fresh context) |

---

## 5. Findings / Notes

| Item | Detail |
|------|--------|
| No RCA needed | Straightforward extension, no runtime issues |
| History limited to 1 pair | Only last assistant message + current user message captured. Could expand to N pairs with a config constant. |
| Not persisted to saved searches | Re-running a saved search starts fresh — no prior context. Acceptable for now; saved search replay is a "start over" action. |
| React state staleness handled | `handleSendMessage` reads `messages` BEFORE the new user message is set via `setMessages`, so `messages` reflects the prior conversation state accurately. |
| Subprocess JSON size | Chat history adds ~200-500 bytes to the stdin payload — negligible. |

---

## 6. Reference Files

| File | Purpose |
|------|---------|
| `services/rag-engine/src/summarize.py` | `_build_user_message()` with history section; updated function signatures |
| `api/src/orchestrator.py` | `format_results()` / `format_results_stream()` accept + pass `chat_history` |
| `api/src/search.py` | `SearchRequest.chat_history`, `_stream_response` passes it through |
| `web/src/lib/types.ts` | `SearchRequest.chat_history` field |
| `web/src/components/ChatInterface.tsx` | History collection in `handleSendMessage` → `queryDataset` |
| `web/src/lib/api.ts` | `streamSearch()` passes `chat_history` in request body (existing, no change needed) |

> **Ref:** `docs/sprint-3/AGENTS.md` §5 P0 #2 — Follow-up chat context
> **Ref:** `docs/sprint-3/tasks.md` — Phase 5 task tracking
