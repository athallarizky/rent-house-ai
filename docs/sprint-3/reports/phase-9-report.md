# Phase 9 Report — AI Chat Mode Toggle

> Completed: 2026-06-20 | Sprint 3 — Enhancement

---

## 1. Overview

Previously every query triggered the full LLM pipeline (intent extraction + streaming
summarize), even simple filter queries like "wifi" or "ac". This added 2-3s latency
and consumed Z.AI tokens unnecessarily.

Phase 9 adds a manual mode toggle in the chat input, letting the user choose:

| Mode | Intent Extraction | LLM Summarize | Chat Message | Latency | Token Cost |
|------|------------------|--------------|--------------|---------|------------|
| **AI** | Yes | Yes (stream) | LLM markdown summary | 2-3s | ~200 tokens |
| **RAG** | No | No | "Menampilkan X kos di {area}..." | ~300ms | 0 tokens |

```
┌────────────────────────────────────────────────────────┐
│  [FilterChips: wifi(3)  ac(5)  parkir(2)]              │
├────────────────────────────────────────────────────────┤
│  [textarea                                       ▼]    │
│                                          [AI] [Send]   │
└────────────────────────────────────────────────────────┘

Dropdown options:
  • AI  — Ringkasan + rekomendasi LLM
  • RAG — Hasil langsung tanpa LLM
```

---

## 2. How to Test

1. Open `/search`, load a district
2. Click the mode button next to the send button (shows "AI" or "RAG")
3. Switch to **RAG** mode
4. Type a search query → results appear in right panel instantly (~300ms)
5. Chat shows "Menampilkan 12 kos di Cengkareng yang relevan..."
6. Switch to **AI** mode → full LLM summarize with streaming
7. Refresh the page → mode preference persists (localStorage)

---

## 3. Changes

### 3a. `api/src/search.py` — `mode` parameter

`SearchRequest` now has `mode: str = "ai"` field. When `mode == "rag"`:
- Non-streaming: returns results without `summary` field (no LLM call)
- Streaming: emits `results` → `done` immediately, skips LLM token generator

Response shape (RAG streaming): `progress → pipeline → results → done`
Response shape (AI streaming): `progress → pipeline → results → token… → done`

### 3b. `web/src/lib/types.ts` — `ChatMode` type + `SearchRequest.mode`

```typescript
export type ChatMode = "rag" | "ai";
```

`SearchRequest.mode` added as optional field.

### 3c. `web/src/components/ChatInterface.tsx` — State + logic

- `chatMode` state initialized from localStorage (`kos-ai.chat-mode`), defaults to `"ai"`
- `toggleChatMode(mode)` updates state + persists to localStorage
- `handleSendMessage`: skips `extractIntent()` when RAG mode
- `queryDataset`: passes `mode` to `streamSearch`, shows result count on `done` event for RAG mode:
  ```
  "Menampilkan {N} kos di {district} yang relevan dengan \"{query}\"."
  ```

### 3d. `web/src/components/MessageInput.tsx` — Mode dropdown

New props: `chatMode`, `onToggleMode`. Renders a dropdown button between the
textarea and send button:

- Default: shows current mode icon + label (Brain for AI, Search for RAG)
- Active AI mode: blue-tinted border
- Active RAG mode: muted
- Dropdown popup: 2 options with icon + label + description
- Click-outside-to-close behavior via `useRef` + `useEffect`

### 3e. `web/src/lib/api.ts`

No changes needed — `streamSearch` already passes all `SearchRequest` fields
to the backend (`{ ...req, stream: true }`). The `mode` field is automatically included.

---

## 4. Verification

| Check | Result |
|-------|--------|
| Python AST parse (`search.py`) | OK |
| `npm run check` | 0/0/0 (30 files) |
| `npm run build` | 3 pages built |
| RAG mode: query returns results only | No latency from LLM, backend emits done immediately |
| AI mode: full pipeline unchanged | Streaming tokens + markdown summary |
| Mode toggle persists | localStorage `kos-ai.chat-mode` |
| Mode toggle on refresh | Restores from localStorage |
| AI mode area detection | Intent extraction works for area resolution |
| RAG mode area detection | Falls back to regex `extractArea()` (Phase 3 fallback) |

---

## 5. Findings / Notes

| Item | Detail |
|------|--------|
| No RCA needed | Straightforward feature |
| RAG mode area detection | Uses regex fallback (Phase 3's `extractArea()`) instead of LLM intent — acceptable since RAG mode is for fast results, not free-form queries |
| Backend still does RAG search | Even in RAG mode, the backend runs `search_and_rank()` (embedding + ChromaDB query). Only the LLM summarization is skipped. |
| No token cost in RAG mode | Zero LLM tokens used — only the bge-m3 embedding call (Phase 7 cached) |
| Latency win | RAG mode: ~300ms (results only) vs AI mode: 2-3s (including LLM) |

---

## 6. Reference Files

| File | Purpose |
|------|---------|
| `api/src/search.py` | `SearchRequest.mode`, `_stream_response` RAG skip path |
| `web/src/lib/types.ts` | `ChatMode` type, `SearchRequest.mode` |
| `web/src/components/ChatInterface.tsx` | `chatMode` state + localStorage, mode-aware `handleSendMessage`/`queryDataset` |
| `web/src/components/MessageInput.tsx` | Mode dropdown (Brain/Search icons, click-outside) |

> **Ref:** `docs/sprint-3/tasks.md` — Phase 9 task tracking
