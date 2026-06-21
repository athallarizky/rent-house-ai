# Rev-001 — Session-Scoped Dataset (Browse + Refine)

> **Status:** 🟡 Proposed (pending approval) | Created: 2026-06-19
> **Type:** Architecture revision to Phase 3 dashboard
> **Supersedes:** Phase 3 per-message search model (and `ux-flow.md §6` "follow-up → new search")
> **Related:** `rca/rca-001-*.md`, `rca/rca-002-*.md`

---

## 1. Latar Belakang & Masalah

### Flow yang dimaksud (benar)
1. User: "kosan di cengkareng" → **pilih dataset** (district) → scrape + index → **semua ~152 kos tampil** di panel kanan
2. Sesi chat = RAG / Q&A **di atas 152 kos itu** — memperdetail, bukan cari ulang
3. Panel kanan = working set yang bisa di-browse; filter chips mempersempit in-memory

### Yang sekarang terjadi (salah)
- Tiap `handleSendMessage` → `doSearch` → `POST /search` full pipeline → `setResults(top 5)` → panel kanan **ditimpa** jadi top-5
- "yang wifi kenceng" memicu **search baru**, bukan refinement
- Akar penyebab: saya mengikuti `ux-flow.md §6` ("follow-up → new search") yang **konflik** dengan model session. Ini koreksi desain, bukan bug murni.

### Tiga gejala yang muncul dari model lama
- Panel kanan cuma top-5 (bukan semua kos)
- Chat "mengganti" data, bukan "menyoroti" — hilang kesan browsing
- Embedding model reload per pesan (cost), walau scrape sudah cached

---

## 2. Tujuan

- [G1] Panel kanan menampilkan **semua kos** di district aktif (dataset), sekali load per district
- [G2] Chat = RAG refinement: jawaban LLM + kos relevan **di-highlight** di dataset (border/warna), **sort ke atas**
- [G3] Pindah district via **switcher di chat header** (list sibling district di kota yang sama) → re-fetch
- [G4] Input berupa **kota** (Jakarta Barat) → tetap pakai **picker district** (existing) → pilih satu → load
- [G5] Follow-up di district yang sama → **tidak reload** dataset (cached di state frontend)
- [G6] Filter chips tetap in-memory di atas dataset utuh

---

## 3. Model Konseptual Baru

**Satu "sesi" = satu district ter-load.**

```
State frontend:
  dataset          : KosResult[]      ← SEMUA kos district aktif (panel kanan)
  relevantIds      : Set<string>      ← place_id kos relevan dgn chat terakhir (highlight)
  currentDistrict  : string | null
  currentRegency   : string | null
  siblingDistricts : District[]       ← district lain di kota yg sama (untuk switcher)
  datasetLoading   : boolean
  + messages, filters, selectedKos, rightPanelMode (tetap)
```

**Tiga aksi inti:**

| Aksi | Trigger | Apa yang terjadi |
|------|---------|------------------|
| **Load district** | pick dari picker, atau switcher, atau search district baru | pipeline (cached) → fetch ALL kos → `dataset`; reset `relevantIds`; (opsional) jalankan RAG awal |
| **Refine (chat follow-up)** | pesan chat saat district sudah load | RAG di dalam district → update `relevantIds` + sort + jawaban LLM. **Tidak sentuh `dataset`** |
| **Switch district** | klik switcher di header | konfirmasi → load district baru (re-fetch) → reset relevance |

---

## 4. Perilaku Panel Kanan (Q1 — kamu putuskan)

Panel kanan **selalu** menampilkan `dataset` utuh (setelah di-filter chip).

### Highlight kos relevan (UI saya putuskan)
- Kos relevan (`id ∈ relevantIds`):
  - border lebih tebal + warna primary: `border-2 border-primary`
  - tint background halus: `bg-primary/5`
  - badge "Cocok" / persen match di-pin dengan warna primary, lebih menonjol
- Kos tidak relevan: style normal, sedikit di-muted (`opacity-80`) agar fokus ke yang relevan
- **Sort:** relevan dulu (by score desc), sisanya by rating desc
- Toggle kecil di header panel: **"Semua / Relevant only"** (default "Semua") — biar user bisa fokus kalau dataset besar

### Filter chips
Tetap in-memory di atas `dataset`. Berlaku di kedua mode tampilan (Semua / Relevant only). Active count = jumlah filter aktif.

---

## 5. Switcher District di Chat Header (Q2 — approach 2)

Header chat saat ini: `[☰] Kos AI · Area: Cengkareng [◫]`

Direvisi jadi **breadcrumb + dropdown**:

```
[☰]  📍 Jakarta Barat › Cengkareng ▾   [◫]
                  └─────────────┬─────────────┘
                          (klik → menu)
        ┌──────────────────────────────┐
        │ Kota: Jakarta Barat           │
        ├──────────────────────────────┤
        │ ✓ Cengkareng       152 kos    │
        │   Grogol Petamburan   ?       │
        │   Kalideres           ?       │
        │   Kebon Jeruk         ?       │
        │   Kembangan           ?       │
        │   ...                          │
        └──────────────────────────────┘
```

- Breadcrumb: `regency › district` (district bisa diabaikan kalau direct district tanpa regency)
- Klik `▾` / area → buka menu list sibling district + jumlah kos (dari `siblingDistricts`)
- Pilih district lain → **confirm** ("Pindah ke Kalideres? chat relevance akan reset") → re-fetch dataset
- Setelah switch: `dataset` diganti, `relevantIds` dikosongkan, chat history **tetap** (tapi tidak ada highlight sampai user nanya lagi). Tambah 1 system message kecil: "Beralih ke district X."
- Hidden kalau tidak ada regency/sibling (misal direct kecamatan tanpa konteks kota)

### Komponen baru: `DistrictSwitcher.tsx`
Props: `regency`, `currentDistrict`, `siblings`, `onSwitch(district)`. Render breadcrumb + dropdown.

---

## 6. Flow Detail

### 6.1 Load district (first time / switch / new search)

```
trigger: pick picker | switcher | search yg resolve ke district berbeda
   │
   ▼
POST /area/load { district, regency? }
   ├── backend: ensure_scraped → ensure_processed → ensure_indexed  (cached setelah sekali)
   ├── backend: list_kos(kecamatan=district) via collection.get(where=...)  ← SEMUA kos, no semantic
   └── return { dataset, district, regency, province, siblings }
   │
   ▼
setDataset(dataset); setCurrentDistrict/Regency; setSiblingDistricts
relevantIds = new Set(); selectedKos = null; filters = reset
   │
   ▼ (opsional, default: YA — supaya chat langsung ada jawaban)
RAG awal: POST /search { query: originalText, district }
   ├── update relevantIds (dari event results)
   └── stream LLM summary ke chat
```

### 6.2 Refine (follow-up chat, district sama)

```
trigger: pesan chat, dan (area == currentDistrict atau tidak ada area)
   │
   ▼
POST /search { query, district: currentDistrict }   ← ringan, asumsi sudah indexed
   ├── event results → set relevantIds (relevant top-N)
   └── event token... → stream jawaban
   │
   ▼
panel kanan: dataset tetap, highlight + sort by relevantIds
```

### 6.3 Deteksi "load baru" vs "refine"

Heuristik di `handleSendMessage`:
```
areaHint = extractArea(text) atau explicit
resolved = resolveLocation(areaHint)

if resolved.regency-level (districts > 1):
    → picker (existing) → user pick → LOAD district
elif resolved single district:
    if currentDistrict == null OR district != currentDistrict:
        → LOAD district (+ RAG awal dgn text)
    else:
        → REFINE (queryDataset)
else: (no area extractable)
    if currentDistrict != null: → REFINE
    else: → fallback LOAD district default (Cengkareng)
```

---

## 7. Perubahan Backend

### 7.1 Endpoint baru: `POST /area/load`
```json
// request
{ "district": "Cengkareng", "regency": "Administrasi Jakarta Barat" }

// response
{
  "success": true,
  "district": "Cengkareng",
  "regency": "Administrasi Jakarta Barat",
  "province": "DKI Jakarta",
  "siblings": [
    { "name": "Cengkareng", "postalCodes": [...] },
    { "name": "Kalideres", "postalCodes": [...] },
    ...
  ],
  "dataset": [ { ...KosResult }, ... ],   // SEMUA kos district, by collection.get
  "pipeline": { "scrape": "cached", "process": "cached", "index": "0 new, 152 skipped" }
}
```

**Fungsi baru di RAG engine** (`services/rag-engine/src/search.py`):
```python
def list_kos(kecamatan, limit=500):
    """Return all kos for a kecamatan (metadata-only filter, no semantic)."""
    # pakai collection.get(where={"kecamatan": kecamatan}) bukan collection.query
```

Dipanggil via subprocess oleh `orchestrator.load_area(district, regency)` (mirip `search_and_rank`).

### 7.2 Refactor `POST /search` jadi "refine-only"
- **Tidak lagi** jalan `ensure_scraped/processed/indexed` di sini (pindah ke `/area/load`)
- Asumsi sudah indexed (kalau belum, return 409 + pesan "load area dulu")
- Tetap: semantic search (`kecamatan` filter) + stream LLM (`progress → results → token → done`)
- `top_k` default dinaikkan ke ~10 (buat highlight subset yang lebih kaya)
- Pipeline field di response di-drop (atau kosong)

> Catatan migration: agar tidak break yang existing, `/search` bisa tetap jalan pipeline kalau diberi flag `ensure_pipeline: true` (default false). Tapi untuk revisi ini, frontend cukup pakai `/area/load` lalu `/search` (refine).

### 7.3 Performa follow-up
Masih ada cost: **embedding model reload per query** (subprocess load 2.3GB bge-m3). Ini inherent dari arsitektur subprocess sprint-1. **Out of scope** untuk revisi ini, tapi catat sebagai future work: rag-engine jadi proses persistent (server) agar model warm. Untuk MVP tetap OK karena scrape (bagian berat) sudah cached.

---

## 8. Perubahan Frontend (per komponen)

| File | Perubahan |
|------|-----------|
| `lib/api.ts` | + `loadArea(district, regency?)` (GET dataset+siblings); `streamSearch` tetap (sekarang jadi "refine"); sisa tetap |
| `lib/types.ts` | + `AreaLoadResponse`; `KosResult` tetap. (mungkin + `relevant?: boolean` di runtime) |
| `ChatInterface.tsx` | **Besar**: state `dataset/relevantIds/currentDistrict/currentRegency/siblingDistricts/datasetLoading`; `handleSendMessage` rework (deteksi load vs refine); `loadDistrict()`, `queryDataset()`; header pakai `DistrictSwitcher`; panel kanan baca `dataset` |
| `KosCardList.tsx` | Props: `dataset` (bukan `results`), `relevantIds`, `relevantOnlyMode`, `onToggleRelevantOnly`. Sort: relevan dulu. Render tetap |
| `KosCard.tsx` | + prop `relevant?: boolean` → styling highlight (`border-2 border-primary bg-primary/5`); non-relevant `opacity-80` |
| `DistrictSwitcher.tsx` | **Baru**: breadcrumb `regency › district ▾` + dropdown sibling + confirm switch |
| `SavedSearches.tsx` | `SavedSearch.area` sekarang = district; re-run → `loadDistrict`. Tetap |
| `KecamatanPicker.tsx` | Tetap (flow regency→district) |
| `FilterChips.tsx` | Tetap (filter di atas `dataset`) |

### Highlight styling konkret (KosCard)
```tsx
className={cn(
  "w-full text-left rounded-xl border bg-card p-3 transition-all",
  relevant
    ? "border-2 border-primary bg-primary/5 shadow-sm"
    : "border border-border opacity-80 hover:opacity-100"
)}
// + badge "Cocok · 78%" dengan warna primary saat relevant
```

---

## 9. Edge Cases

| Kasus | Penanganan |
|-------|-----------|
| User search district baru tanpa lewat regency | `resolveLocation` single district → langsung load |
| Switch ke district yg belum di-scrape | `/area/load` jalan scrape (sekali, lalu cached). Tampilkan loading skeleton "Mengambil data Kalideres…" |
| Switcher tidak punya sibling (direct district, no regency) | Switcher hidden, hanya tampilkan nama district |
| `/search` dipanggil sebelum `/area/load` | Backend return 409; frontend fallback: auto-call `/area/load` dulu |
| Dataset kosong (district tidak ada kos) | Empty state "Tidak ada kos di district ini" + saran switch district |
| Saved search re-run | `loadDistrict(saved.district)` → muat ulang (cached) + RAG(saved.query_text) |
| User ganti kota ("kos di bandung") saat sudah di Cengkareng | resolve ke regency Bandung → picker baru → load district Bandung (dataset diganti total) |

---

## 10. Rencana Eksekusi (urutan)

1. **Backend**
   1. `rag-engine/search.py`: + `list_kos(kecamatan)` (collection.get where)
   2. `api/orchestrator.py`: + `load_area(district, regency)` (pipeline + list_kos + siblings via resolve)
   3. `api/searches` router skip (Phase 5) — tidak relevan
   4. `api/search.py`: + `POST /area/load`; refactor `/search` jadi refine-only (skip pipeline; flag `ensure_pipeline`)
   5. Smoke test curl: `/area/load Cengkareng` → 152 kos; `/search refine` → SSE relevan
2. **Frontend**
   6. `lib/api.ts`: + `loadArea()`; sesuaikan `streamSearch` (refine)
   7. `ChatInterface.tsx`: state + flow rework (loadDistrict / queryDataset / deteksi)
   8. `KosCard.tsx`: prop `relevant` + styling
   9. `KosCardList.tsx`: baca `dataset`, sort by relevant, toggle "Semua/Relevant only"
   10. `DistrictSwitcher.tsx`: baru, pasang di header
3. **Verifikasi**
   11. E2E: search kota → picker → load all → chat refine (highlight) → switch district → re-fetch
   12. `astro check` 0/0/0; `npm run build` OK

> Setiap step bisa di-commit terpisah (backend dulu, lalu frontend state, lalu UI).

---

## 11. Out of Scope / Future

- **Persistent RAG server** (model warm) — biar follow-up tidak reload bge-m3
- **Cross-district search** ("Cari di SEMUA") — sudah ada handle `kecamatan=None`, tinggal sambungkan ke UI switcher/picker
- **Relevance threshold** — sekarang semua `results` dianggap relevan; nanti bisa threshold score
- **Persistensi dataset antar refresh** — sekarang reload saat refresh; future: cache di IndexedDB

---

## 12. Risiko

| Risiko | Mitigasi |
|--------|---------|
| Dataset besar (ribuan kos) bikin panel berat | Limit `list_kos` + virtual scroll future; untuk MVP (152) aman |
| `/search` refine butuh district sudah indexed | Validasi + auto-fallback ke `/area/load` |
| Heuristik load-vs-refine salah deteksi | Explicit: kalau teks mengandung nama district/kota lain → load; else refine. Plus switcher manual |
| Migration break pemakai lama `/search` | `/search` tetap support `ensure_pipeline: true` (default false) — non-breaking |

---

## 13. Pertanyaan Terbuka (minor, tidak block)

1. Saat **load** district, jalankan RAG awal dengan teks asli, atau cukup tampilkan dataset (RAG baru di pesan berikutnya)?
   - **Rekomendasi:** jalankan RAG awal (UX lebih responsif, chat langsung ada jawaban + highlight).
2. Saat **switch district**, chat history: tetap atau reset?
   - **Rekomendasi:** tetap (tambah system note "Beralih ke X"), relevance reset sampai user nanya lagi.

> Kalau tidak ada keberatan, saya eksekusi sesuai rekomendasi di atas.
