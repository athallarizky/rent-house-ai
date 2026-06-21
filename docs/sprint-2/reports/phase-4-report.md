# Phase 4 Report — Settings Page

> Completed: 2026-06-19

---

## 1. How to Run / Configure

```bash
# Backend (FastAPI, :8080) — already running from earlier phases
cd api && python3 -m uvicorn src.main:app --port 8080 --reload

# Web (:4321)
cd web && npm run dev
```

Open **http://localhost:4321/settings**:

1. **API Key** — paste your Z.AI key
2. **Base URL** — `https://api.z.ai/api/coding/paas/v4/` for the **coding plan** (default),
   or `https://api.z.ai/api/paas/v4/` for PAYG
3. **Model** — type or pick from the live-fetched list (default `glm-4.5-air`)
4. **Test Connection** → ✅ Terhubung (with a reply snippet) / ❌ (error)
5. **Simpan** → persisted to `data/settings.json` (server)

Once saved, the RAG engine reads the key/model from that file — `/search` summaries switch
from the formatted fallback to a real LLM narrative.

---

## 2. Component & Endpoint Map

```
settings.astro (DashboardLayout)
└── ProviderSettings  client:load
    ├── LLM Provider card
    │   ├── Provider (readonly: Z.AI)
    │   ├── Model (free-text input + <datalist> live-fetched)
    │   ├── API Key (password) + masked hint when set
    │   ├── Base URL (editable)
    │   ├── [Test Connection]  → POST /settings/test
    │   └── [Simpan]           → PUT  /settings
    └── Data card (ChromaDB / raw / cleaned paths, read-only)

Backend (api/src/settings.py)
├── GET  /settings        → masked (provider/model/base_url/api_key_set/api_key_hint)
├── PUT  /settings        → persist to data/settings.json
├── POST /settings/test   → proxy Z.AI "hi" (server-side, avoids browser CORS)
└── POST /settings/models → proxy Z.AI /models (live model id list)
```

---

## 3. Settings Persistence Design

| Aspect | Decision |
|--------|----------|
| Storage | `data/settings.json` (server-side, gitignored) |
| Read path | `services/rag-engine/src/config.py` reads `api_key`/`model`/`base_url` from this file first, then env (`ZAI_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`) |
| Write path | `PUT /settings` (empty `api_key` = "keep existing") |
| **Key echo on GET** | **Never.** `GET /settings` returns `api_key_set: bool` + a masked `api_key_hint` (`abcd…wxyz`). The raw key is NOT sent to the browser. |
| Form load | API-key field is empty by design. Placeholder reads: `Tersimpan (abcd…wxyz) — ketik untuk ganti`. User retypes only to change it. |

> **"Token looks missing" is intentional.** Because the raw key is never echoed back, the
> password field appears empty on every page load even though the key **is** saved and the
> RAG engine **is** using it. This is the standard security pattern for secrets — don't
> round-trip them to the client.

---

## 4. The Model-Name Discovery (important lessons)

The model field went through four iterations — captured here so it doesn't recur:

| Attempt | Model / Endpoint | Result |
|---------|------------------|--------|
| sprint-1 default | `glm-air` (never tested with real key, fallback only) | worked as fallback, wrong as real |
| Phase 4 try 1 | `glm/glm-4.5-air` | `400 Unknown Model` |
| Queried `/models` | ids are `glm-4.5-air`, `glm-4.6`, … (**no `glm/` prefix**) | corrected default |
| `glm-4.5-air` on `/paas/v4/` | correct model, PAYG key | `429 Insufficient balance` |
| `glm-4.5-air` on **`/api/coding/paas/v4/`** | ✅ **works** (coding plan endpoint) | connected |

Two takeaways baked back into the code:

1. **Model list is dynamic** — `POST /settings/models` proxies Z.AI `/models`; the form
   populates the `<datalist>` live (on mount if a key is saved, on API-key blur otherwise).
   Hardcoded names are only a fallback. No more model-name drift.
2. **Coding plan uses a different endpoint** — `/api/coding/paas/v4/` (not `/paas/v4/`).
   Default `base_url` is now the coding endpoint; PAYG users switch it in the field.

---

## 5. Backend Changes

**`api/src/settings.py`** (new) — router under `/settings`:
- `Settings` / `SettingsTestRequest` / `ModelsRequest` Pydantic models
- `_read()` / `_write(s)` — JSON persistence at `data/settings.json`
- `GET /settings` (masked), `PUT /settings`, `POST /settings/test`, `POST /settings/models`
- Registered in `main.py`

**`services/rag-engine/src/config.py`** — now loads `LLM_BASE_URL` / `LLM_API_KEY` /
`LLM_MODEL` from `data/settings.json` first (so the form's key actually reaches the model),
falling back to env. Default model `glm-4.5-air`.

**`.gitignore`** — added `data/settings.json` + `data/search_history.db` (Phase 5).

---

## 6. Frontend Changes

**`web/src/lib/api.ts`** — `getSettings()`, `saveSettings()`, `testConnection()`,
`listModels()`; `BackendSettings` type (masked); `ProviderSettings` type + defaults.

**`web/src/components/ProviderSettings.tsx`** (new) — form with: live model datalist,
password key field with masked hint, Test Connection (✅/❌ banner with reply/error),
Simpan (+ toast), Data paths section. Fetches live model list on mount + on key blur.

**`web/src/pages/settings.astro`** — `DashboardLayout` + heading + `<ProviderSettings client:load />`.

---

## 7. Verification

| Check | Result |
|-------|--------|
| `npm run check` (astro check) | **0 errors / 0 warnings / 0 hints** (24 files) |
| `npm run build` | 3 pages built |
| `/settings` island | `astro-island` → `ProviderSettings.tsx` |
| `GET /settings` | returns masked (no key leak) |
| `PUT /settings` → `GET` | `api_key_set: true` + hint |
| `POST /settings/models` (coding endpoint) | `[glm-4.5, glm-4.5-air, glm-4.6, glm-4.7, glm-5, glm-5-turbo, glm-5.1, glm-5.2]` |
| `POST /settings/test` (coding endpoint, `glm-4.5-air`) | ✅ `"Hi there! I'm the GLM language model…"` |
| End-to-end `/search` summary | uses real LLM (coding-plan credits via `/api/coding/paas/v4/`) |

---

## 8. Known Issues / Notes

| Issue | Detail | Mitigation / Status |
|-------|--------|---------------------|
| "API key field looks empty after reload" | By design — raw key never echoed to client (security) | Placeholder shows masked hint; key IS saved & used. Documented in §3 |
| Default `base_url` is the coding endpoint | Coding-plan users work out-of-box; PAYG users must switch to `/paas/v4/` | Editable in form; documented |
| `data/settings.json` stores key in plaintext | Local single-user MVP (no auth) per AGENTS.md | File gitignored; acceptable for MVP |
| No auth on `/settings` | Anyone reaching :8080 can read/write settings | MVP-only assumption (`architecture.md` §9) |

---

## 9. Reference Files

| File | Purpose |
|------|---------|
| `api/src/settings.py` | `/settings` router (GET/PUT/test/models) + JSON persistence |
| `api/src/main.py` | registers `settings_router` |
| `services/rag-engine/src/config.py` | reads key/model/base_url from `data/settings.json` (fallback env) |
| `web/src/components/ProviderSettings.tsx` | settings form + live model list + test connection |
| `web/src/pages/settings.astro` | settings route (DashboardLayout + island) |
| `web/src/lib/api.ts` | `getSettings` / `saveSettings` / `testConnection` / `listModels` |

> **Ref:** `docs/sprint-2/ux-flow.md` §4 Settings
> **Ref:** `docs/sprint-2/AGENTS.md` §8 Settings Page
