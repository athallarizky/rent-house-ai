# RCA-005 — Indexing District Baru Crash (`Invalid buffer size: 14.34 GiB`)

> **Tanggal:** 2026-06-19
> **Sprint:** 2 — Rev-001 (Session-Scoped Dataset)
> **Severity:** High (district baru tak bisa di-index → tak bisa dipakai)
> **Komponen:** `services/rag-engine/src/ingest.py`
> **Status:** ✅ Resolved
> **Hubungan dgn RCA-001:** RCA-001 (SDPA crash) dan RCA-005 ini **sama-sama melibatkan model
> bge-m3**, tapi **akar masalahnya berbeda** — lihat §3.

---

## 1. Ringkasan

Switch ke district baru (cth **Kebon Jeruk**) gagal saat indexing:
`RuntimeError: Invalid buffer size: 14.34 GiB` di `modeling_xlm_roberta.forward`.
Padahal Cengkareng (district pertama) tidak pernah crash. Penyebabnya **bukan** regresi
RCA-001 — Cengkareng aman karena sudah ter-index (lazy load skip encoding), sementara
district baru harus encode dokumen → baru crashnya keliahatan.

Akar masalah sebenarnya: **bge-m3 punya konteks 8192 token** (bukan 512 seperti model
biasa), sehingga dokumen panjang × ukuran batch menghasilkan buffer attention `[B,H,S,S]`
yang meledak ke ~14 GiB.

---

## 2. Gejala

```
POST /area/load {"district":"Kebon Jeruk", ...}
→ 500 {"detail":"Indexing failed: ...
    File \".../modeling_xlm_roberta.py\", line 225, in forward
      attention_scores = torch.matmul(query_layer, key_layer.transpose(-1, -2))
RuntimeError: Invalid buffer size: 14.34 GiB"}
```

- Trace menunjuk **line 225** (matmul, jalur **eager**) — BUKAN line 364 (scaled_dot_product_attention / SDPA)
- Hanya terjadi saat **meng-index district baru**; district yang sudah ter-index (Cengkareng) aman

---

## 3. Root Cause

### Kenapa RCA-001 (eager attention) "tidak cukup"?

RCA-001 memperbaiki **default attention implementation** (`sdpa` → `eager`) agar model bisa
dimuat & meng-encode query pendek. Itu **perlu tapi tidak cukup**:

| RCA-001 | RCA-005 |
|---------|---------|
| Akar: default `attn_implementation="sdpa"` bermasalah di env ini | Akar: **shape input** — batch × seq_len terlalu besar |
| Gejala: crash saat **load/encode query** (model load + 1 teks) | Gejala: crash saat **batch encode banyak dokumen** indexing |
| Path: line 364 (SDPA) | Path: line 225 (matmul eager) — eager PUN meledak |
| Fix: `attn_implementation="eager"` | Fix: **potong input + batch kecil** |

Inti: eager mengganti cara hitung attention, tapi **tetap menghitung** `[B,H,S,S]`. Kalau `S`
(seq_len) dan `B` (batch) besar, hasilnya tetap raksasa, tak peduli implementation.

### Kenapa 14.34 GiB?

Estimasi shape `[B, H, S, S]` (fp32, 4 byte/element):

- bge-m3: **max context 8192 token** (XLM-R base umumnya 512, tapi bge-m3 khusus 8192 untuk
  embedding dokumen panjang)
- Per dokumen di batch, `S` bisa mendekati 8192 → `S²` ≈ 67 juta
- Dengan `H=16` heads dan batch beberapa dokumen:
  `B × H × S² × 4 byte` ≈ 14.34 GiB → melebihi batas alokasi PyTorch → RuntimeError

### Kenapa baru keliahatan sekarang?

- **Cengkareng** sudah ter-index di sprint-1. Fix RCA-001 (lazy load) membuat `ingest` skip
  encoding kalau semua doc sudah ada → Cengkareng **tidak pernah encode ulang** → tidak crash.
- **Kebon Jeruk** district baru → `new_docs` tidak kosong → encoding berjalan → crash.
- Jadi bug ini **sudah ada sejak sprint-1**, hanya tidak terpicu karena hanya Cengkareng yang
  pernah di-index (kebetulan doc-nya cukup pendek / env saat itu beda).

**Klasifikasi:** model embedding long-context × batch ingest tanpa kap → ledakan memori
kuadratik (`O(S²)` per attention).

---

## 4. Perbaikan

`services/rag-engine/src/ingest.py` — **potong dokumen + batch kecil** sebelum encode:

```python
MAX_DOC_CHARS = 1500
safe_texts = [t[:MAX_DOC_CHARS] for t in texts]
embeddings = model.encode(safe_texts, batch_size=8, show_progress_bar=True).tolist()
```

- `1500 char ≈ 400–500 token` → jauh di bawah 8192; untuk embedding RAG, segmen awal dokumen
  (nama + alamat + review teratas) sudah cukup representative
- `batch_size=8` → alokasi buffer tetap kecil meski ada doc mendekati limit

> Trade-off: sebagian review di ekor dokumen terpotong dari embedding. Untuk kualitas RAG
> bisa diakali nanti (chunking per review) — lihat §6.

---

## 5. Verifikasi

| Skenario | Sebelum | Sesudah |
|----------|---------|---------|
| `/area/load Kebon Jeruk` (district baru) | 500 crash 14.34 GiB | ✅ 131 kos ter-load |
| `/area/load Cengkareng` (sudah indexed) | OK (skip encode) | ✅ OK (skip encode) |
| Query refine (encode 1 teks pendek) | OK (eager, RCA-001) | ✅ OK |

---

## 6. Pencegahan / Action Items

| # | Action | Status |
|---|--------|--------|
| 1 | Kap panjang dokumen (`MAX_DOC_CHARS`) + `batch_size` kecil saat ingest | ✅ done |
| 2 | Set eksplisit `model.max_seq_length` lebih rendah (cth 512) di config RAG, bukan andal default 8192 | 🟡 backlog |
| 3 | **Chunking per review** saat build doc → embedding lebih representatif tanpa dokumen raksasa | 🟡 backlog (kualitas RAG) |
| 4 | Unit test ingest: dokumen 10K char tidak crash | 🟡 backlog |
| 5 | Catat di doc: bge-m3 = 8192 context, WASPADA memori saat batch encode | 🟡 backlog |

---

## 7. Referensi

| File | Peran |
|------|-------|
| `services/rag-engine/src/ingest.py` | fix: `MAX_DOC_CHARS` + `batch_size` |
| `services/rag-engine/src/search.py` | RCA-001 fix (eager) — masih berlaku, pelengkap |
| `services/rag-engine/src/config.py` | `EMBED_MODEL = BAAI/bge-m3` (8192 context) |

---

## 8. Pelajaran

- **Long-context model mahal secara kuadratik.** bge-m3 mendukung 8192 token, tapi attention
  `O(S²)` → buffer ledakan untuk dokumen panjang. Kap input wajib.
- **"Sudah jalan" belum tentu benar.** Cengkareng tidak crash bukan karena aman, tapi karena
  **skip encoding** (lazy load). District baru adalah tes sebenarnya — dan ia gagal.
- **Dua RCA bisa melibatkan komponen yang sama tapi akar berbeda.** RCA-001 (attention impl)
  dan RCA-005 (input shape) sama-sama bge-m3; memperbaiki yang satu tidak otomatis menutup
  yang lain. Jangan asumsikan "ini lagi bug model yang sama".
- **Batch + seqlen = dua kenop memori.** Ingat keduanya saat pakai transformer untuk ingest
  bulk, bukan hanya query tunggal.
