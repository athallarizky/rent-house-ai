# Rev-001 — Task Tracker

> **Revisi:** [rev-001-session-dataset-model.md](./rev-001-session-dataset-model.md) — Session-Scoped Dataset (Browse + Refine)
> **Status:** ✅ Core implemented + 4 post-impl issues fixed
> **Dibuat:** 2026-06-19
>
> Status legend: ⬜ pending | 🔵 in_progress | ✅ completed | ❌ blocked

Task tracker untuk Revisi 001 — memisahkan implementasi inti dari bug yang ketemu
pas eksekusi (masing-masing punya RCA terpisah di [`../rca/`](../rca/)).

---

## A. Implementasi Inti — Backend

| ID | Task | File | Status |
|----|------|------|--------|
| B1 | `list_kos(kecamatan)` — list semua kos via `collection.get` (no semantic) | `services/rag-engine/src/search.py` | ✅ |
| B2 | `_format_kos_items()` helper (shape raw → KosResult) | `api/src/orchestrator.py` | ✅ |
| B3 | `load_area(district, regency)` — pipeline (cached) + list_kos + siblings | `api/src/orchestrator.py` | ✅ |
| B4 | `_list_kos_subprocess()` wrapper | `api/src/orchestrator.py` | ✅ |
| B5 | `POST /area/load` endpoint | `api/src/search.py` | ✅ |
| B6 | Refactor `POST /search` → refine-only (flag `ensure_pipeline`, default false) | `api/src/search.py` | ✅ |
| B7 | SSE `_stream_response`: pipeline event conditional (skip di mode refine) | `api/src/search.py` | ✅ |
| B8 | Smoke test `/area/load` (104 kos Cengkareng + 8 sibling) & `/search` refine | — | ✅ |

---

## B. Implementasi Inti — Frontend

| ID | Task | File | Status |
|----|------|------|--------|
| F1 | `AreaLoadResponse` type + `loadArea()` API client | `lib/types.ts`, `lib/api.ts` | ✅ |
| F2 | `KosCard`: prop `relevant` + highlight (border/tint/badge "Cocok %") | `components/KosCard.tsx` | ✅ |
| F3 | `KosCardList`: baca `dataset`, sort relevant-first, toggle "Semua/Relevant only" | `components/KosCardList.tsx` | ✅ |
| F4 | `DistrictSwitcher`: breadcrumb `regency › district ▾` + dropdown sibling | `components/DistrictSwitcher.tsx` (new) | ✅ |
| F5 | `ChatInterface`: state sesi (`dataset`, `relevantIds`, `currentDistrict`, `currentRegency`, `siblingDistricts`) | `components/ChatInterface.tsx` | ✅ |
| F6 | Flow: `loadDistrict()` vs `queryDataset()` + deteksi load-vs-refine-vs-picker | `components/ChatInterface.tsx` | ✅ |
| F7 | Header chat: pasang `DistrictSwitcher` (ganti label "Area" statis) | `components/ChatInterface.tsx` | ✅ |
| F8 | Right panel: `dataset` filtered by chips → panel; `relevantIds` → highlight | `components/ChatInterface.tsx` | ✅ |
| F9 | `search.astro` shell tetap `client:only="react"` | `pages/search.astro` | ✅ (tidak berubah) |

---

## C. Verifikasi

| ID | Task | Status |
|----|------|--------|
| V1 | `astro check` 0 errors / 0 warnings / 0 hints | ✅ |
| V2 | `npm run build` 3 pages OK | ✅ |
| V3 | E2E manual: kota → picker → load all → chat refine (highlight) → switch district | ✅ |

---

## D. Bug Pasca-Implementasi (masing-masing ada RCA)

Issue yang ketemu saat verifikasi Rev-001. Bukan bagian dari plan awal, tapi blockers UX.

| ID | Issue | RCA | Root Cause Singkat | Status |
|----|-------|-----|--------------------|--------|
| D1 | Chat 5 kos vs sidebar 8 highlight (desync) | [RCA-003](../rca/rca-003-chat-vs-sidebar-count-mismatch.md) | Dua limit tak terhubung: LLM context `results[:5]` vs sidebar `top_k`. No single source of truth | ✅ |
| D2 | Switch ke Taman Sari → 400 "is a POI" | [RCA-004](../rca/rca-004-taman-sari-poi-misclassification.md) | geo-router POI classifier keyword-only ("taman") false-positive pada nama kecamatan; resolve direct vs regency inkonsisten | ✅ |
| D3 | Switch ke district baru → 500 `Invalid buffer size 14.34 GiB` | [RCA-005](../rca/rca-005-indexing-new-district-14gb-crash.md) | bge-m3 konteks 8192 token → doc panjang × batch ledak buffer attention. Bukan regresi RCA-001 (akar beda) | ✅ |
| D4 | Switch district: dataset tampil tapi chat kosong (tanpa rekomendasi awal) | [RCA-006](../rca/rca-006-no-initial-recommendation-on-switch.md) | `loadDistrict` hanya RAG kalau ada `initialQuery`; switch/bootstrap `?area=` luput wiring | ✅ |

### Ringkasan Fix D1–D4

- **D1** → `top_k` & semua `results[:N]` disamakan ke 10; `max_tokens` 800→1200
- **D2** → `load_area` resolve via regency (cari district di daftar regency) saat regency disediakan → bypass POI classifier
- **D3** → `ingest.py`: `MAX_DOC_CHARS=1500` + `batch_size=8` sebelum encode
- **D4** → `loadDistrict` selalu jalan rekomendasi awal (default `kos di <district>`); `queryDataset` + flag `saveSearch` (auto = tidak disimpan)

---

## E. Backlog (dari RCA action items, belum dikerjakan)

| ID | Task | Dari |
|----|------|------|
| E1 | Single source of truth `RAG_TOP_K` (hilangkan magic number 5/10) | RCA-003 §6 |
| E2 | Perbaikan `classify.ts`: cek exact district name sebelum label POI + unit test | RCA-004 §6 |
| E3 | Set eksplisit `model.max_seq_length` lebih rendah / chunking per review | RCA-005 §6 |
| E4 | Persistent RAG server (model warm) biar follow-up tidak reload bge-m3 | rev-001 §11 |
| E5 | Cross-district search ("Cari di SEMUA") — wiring UI switcher/picker | rev-001 §11 |
| E6 | Cache dataset di IndexedDB antar refresh | rev-001 §11 |

---

## F. Ringkasan

| Kelompok | Jumlah | Status |
|----------|--------|--------|
| Backend core | 8 | ✅ |
| Frontend core | 9 | ✅ |
| Verifikasi | 3 | ✅ |
| Bug pasca-impl (D1–D4) | 4 | ✅ |
| Backlog | 6 | 🟡 |
| **Total dikerjakan** | **24** | ✅ |

> **Ref plan:** [`rev-001-session-dataset-model.md`](./rev-001-session-dataset-model.md)
> **Ref RCAs:** [`../rca/`](../rca/) (RCA-003 s/d RCA-006)
