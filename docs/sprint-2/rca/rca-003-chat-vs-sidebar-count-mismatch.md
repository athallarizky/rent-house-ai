# RCA-003 — Chat vs Sidebar Relevance Count Mismatch (5 vs 8)

> **Tanggal:** 2026-06-19
> **Sprint:** 2 — Rev-001 (Session-Scoped Dataset)
> **Severity:** Low (kosmetik/fungsional, tidak crash)
> **Komponen:** `api/src/orchestrator.py`, `services/rag-engine/src/summarize.py`, `web/src/components/ChatInterface.tsx`
> **Status:** ✅ Resolved

---

## 1. Ringkasan

Saat RAG refinement, **sidebar kanan men-highlight 8 kos** tapi **chat hanya membahas 5**.
Akar masalahnya: dua limit yang **tidak terhubung** — context LLM di-hardcode `results[:5]`,
sedangkan jumlah hasil (highlight) memakai parameter request `top_k` (saat itu 8). Karena tidak
ada satu sumber kebenaran, keduanya berdesinkronisasi.

---

## 2. Gejala

- Sidebar kanan: 8 kartu kos di-highlight (border primary + badge "Cocok")
- Chat: ringkasan LLM hanya menyebut 5 kos
- Tidak ada error — hanya inkonsistensi jumlah

---

## 3. Root Cause

Dua batas independen untuk hal yang seharusnya sama ("berapa kos top-relevant"):

| Path | Sumber limit | Nilai (sebelum) |
|------|--------------|-----------------|
| Highlight sidebar | request `top_k` → `search_and_rank` → `ranked[:top_k]` | 8 (default `SearchRequest`) / 8 (kirim frontend) |
| Context LLM | `results[:5]` hardcoded di `format_results_stream` + `_build_user_message` + `_format_fallback` | **5** (magic number) |

`top_k` mengalir dari request → search → `results` event (10 di frontend pasca-fix), tapi
ringkasan LLM tetap memotong `results[:5]` tanpa membaca `top_k`. Tidak ada single source of truth.

---

## 4. Perbaikan

Samakan ke **10** di kedua sisi:

- Frontend `queryDataset`: `streamSearch({ ..., top_k: 10 })`
- Backend: `results[:5]` → `results[:10]` di `format_results`, `format_results_stream`,
  `_build_user_message`, `_format_fallback` (orchestrator + summarize)
- `max_tokens` LLM `800` → `1200` (biar 10 kos muat di ringkasan)

> Catatan: batas hardcode masih ada (10). Tindakan pencegahan permanen lihat §6.

---

## 5. Verifikasi

Smoke `/search` refine `top_k=10`: `results: 10 highlighted`, `73 tokens` streamed →
sidebar & chat keduanya kerja dengan 10 kos.

---

## 6. Pencegahan / Action Items

| # | Action | Status |
|---|--------|--------|
| 1 | Naikkan ke 10 di kedua sisi | ✅ done |
| 2 | **Single source of truth:** derive context LLM dari `top_k` yang sama (kirim `top_k` ke summarize, jangan hardcode slice terpisah) | 🟡 backlog |
| 3 | Hilangkan magic number `5`/`10` → konstanta `RAG_TOP_K` di config | 🟡 backlog |

---

## 7. Pelajaran

- **Dua sumber kebenaran untuk satu konsep = desinkronisasi yang pasti.** Jumlah "kos relevan"
  harusnya satu nilai, tidak boleh ada `top_k` (request) dan `[:5]` (hardcode) berdampingan.
- Magic number yang tersebar di beberapa file harus dilacak saat review — kalau satu berubah,
  yang lain gampang tertinggal.
