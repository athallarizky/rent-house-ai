# RCA-001 — Phase 3 Search 500 & SSE Kosong

> **Tanggal:** 2026-06-19
> **Sprint:** 2 — Phase 3 (3-Panel Dashboard)
> **Severity:** High (memblokir verifikasi Phase 3 sepenuhnya)
> **Layanan terdampak:** FastAPI `POST /search` (stream & non-stream), RAG engine
> **Status:** ✅ Resolved
> **Durasi insiden:** ~menit (ditemukan saat verifikasi Phase 3)

---

## 1. Ringkasan (Executive Summary)

Saat verifikasi Phase 3, dashboard `/search` gagal menjalankan pencarian apa pun.
Ditemukan **dua akar masalah yang berdiri sendiri** pada backend, keduanya sudah
ada sejak sprint-1 namun baru tersinggung karena Phase 3 pertama kali mengaktifkan
jalur SSE streaming end-to-end:

1. **RC-1 (fatal, terlihat user):** model embedding `BAAI/bge-m3` crash saat dimuat
   dengan `RuntimeError: Invalid buffer size: 14.34 GiB` akibat default attention
   `sdpa` bermasalah di PyTorch environment mesin ini → `POST /search` mengembalikan **500**.
2. **RC-2 (tersembunyi, baru muncul setelah RC-1 diperbaiki):** SSE stream tidak
   memancarkan token apa pun (`results` → `done` tanpa `token`) karena command
   inline `python -c "..."` di orchestrator punya `SyntaxError` (statement `for`
   compound ditaruh setelah `;`).

Keduanya **bukan kesalahan Phase 3** — Phase 3 hanya berhasil mengekspornya ke
permukaan. Frontend (error handling, struktur event) bekerja sesuai desain.

---

## 2. Dampak (Impact)

| Aspek | Detail |
|-------|--------|
| User-facing | Setiap pencarian dari dashboard gagal; tidak ada kos / summary yang muncul |
| API | `POST /search` 500; SSE stream tidak mengirim token ringkasan LLM |
| Scope | Hanya path pencarian; landing page, layout, komponen UI tidak terdampak |
| Data | Tidak ada korupsi/kehilangan data — murni runtime failure |

---

## 3. Timeline

| Waktu | Kejadian |
|-------|----------|
| T0 | Phase 3 selesai dibangun; `astro check` & `npm run build` lulus (0 error) |
| T1 | Web dev server dijalankan, user membuka `/search?q=wifi kenceng` |
| T2 | **Gejala muncul:** console browser → `Search stream failed (500): Indexing failed: ... Invalid buffer size: 14.34 GiB` (RC-1) |
| T3 | Diagnosis: traceback menunjuk `transformers/models/xlm_roberta/.../scaled_dot_product_attention` → hubungan ke model embedding |
| T4 | **Fix RC-1:** `attn_implementation="eager"` + lazy model load di `ingest.py` & `search.py`; FastAPI di-restart dengan `--reload` |
| T5 | Re-test SSE: `progress → pipeline → results → done` — **token hilang** (RC-2 tersingkap) |
| T6 | Diagnosis: jalankan subprocess orchestrator langsung → `SyntaxError: invalid syntax` pada `for` setelah `;` |
| T7 | **Fix RC-2:** helper `stream_to_stdout()` di `summarize.py` agar inline command jadi satu simple statement |
| T8 | Re-test SSE: `progress → pipeline → results → 25× token → done` ✅ |
| T9 | Search end-to-end berfungsi penuh |

---

## 4. Gejala (Symptoms)

### Gejala awal (RC-1) — yang user lihat

```
ChatInterface.tsx:217  search failed Error: Search stream failed (500):
{"detail":"Indexing failed: ...
  File \".../transformers/models/xlm_roberta/modeling_xlm_roberta.py\", line 364, in forward
    attn_output = torch.nn.functional.scaled_dot_product_attention(
RuntimeError: Invalid buffer size: 14.34 GiB\n"}
```

Browser juga menampilkan `Failed to load resource: 500` untuk request `/search`.

### Gejala kedua (RC-2) — setelah RC-1 diperbaiki

SSE stream kembali `200`, tapi event hanya:
```
data: {"type": "progress", ...}
data: {"type": "pipeline", ...}
data: {"type": "results", ...}
data: {"type": "done"}        ← langsung selesai, TANPA token ringkasan
```
Frontend menampilkan pesan assistant kosong (summary `""`).

---

## 5. Root Cause Analysis

### RC-1 — `Invalid buffer size: 14.34 GiB` (model embedding crash)

**Lokasi:** `services/rag-engine/src/ingest.py:52` & `search.py:40`

```python
model = SentenceTransformer(EMBED_MODEL)   # ← default attn = "sdpa"
```

**Mekanisme kegagalan (rantai panggilan):**

```
POST /search
  └─ ensure_indexed(area)                      [orchestrator.py]
      └─ subprocess: ingest()                  [rag-engine]
          └─ SentenceTransformer("BAAI/bge-m3")
              └─ AutoModel.from_pretrained(...)
                  └─ XLM-Roberta forward
                      └─ scaled_dot_product_attention()
                          └─ ❌ Invalid buffer size: 14.34 GiB
```

`bge-m3` berbasis arsitektur **XLM-Roberta**. `transformers` modern memilih
`attn_implementation="sdpa"` (PyTorch scaled-dot-product) sebagai default.
Pada build PyTorch di mesin ini, backend SDPA menghitung ukuran buffer yang
salah secara absurd (14.34 GiB) → `RuntimeError`.

**Kenapa baru muncul sekarang padahal sprint-1 sukses indexing?**
- Sprint-1 melakukan indexing sekali di awal; setelah itu `bge-m3` tetap di-load
  ulang pada setiap `ingest()`/`search()`, tapi environment saat itu
  kemungkinan besar masih menggunakan attention `eager`/lama.
- Ada indikasi **regresi environment**: bump versi `transformers`/`torch` mengubah
  default attention dari `eager` → `sdpa`, sehingga kode sprint-1 yang tidak
  berubah jadi bermasalah.
- **Pemberat tambahan:** `ingest.py` memuat model **secara tidak kondisional** —
  sebelum cek apakah ada dokumen baru. Karena Cengkareng sudah ter-index (152 doc),
  model sebetulnya tidak perlu di-load sama sekali, tapi tetap dimuat → crash
  di setiap request.

**Klasifikasi:** Bug environment × desain yang kurang defensif (model load
tidak lazy + tidak mengikat attention implementation).

---

### RC-2 — SSE 0 token (SyntaxError pada inline subprocess)

**Lokasi:** `api/src/orchestrator.py` — `format_results_stream()`

```python
proc = subprocess.Popen(
    [sys.executable, "-u", "-c",
     "import json, sys; "
     "from src.summarize import summarize_stream; "
     "data = json.loads(sys.stdin.read()); "
     "for tok in summarize_stream(data['query'], data['results']): "   # ← ❌
     "    sys.stdout.write(json.dumps({'t': tok}) + '\\n'); sys.stdout.flush()"],
    ...
)
```

**Mekanisme kegagalan:**

```
format_results_stream()
  └─ subprocess: python -c "...; for tok in ...: ..."
      └─ ❌ SyntaxError: invalid syntax   (for compound setelah ';')
          └─ stdout kosong, proses exit 1
  └─ for line in proc.stdout:   (tidak ada baris)
  └─ generator selesai tanpa yield apa pun
→ tidak ada event "token" yang dipancarkan
```

**Akar sintaksis:** Grammar Python hanya mengizinkan **simple statements**
(assignment, expression, `print`, `return`, dll.) dipisah oleh `;`.
`for`/`if`/`while`/`with`/`try` adalah **compound statements** — mereka memulai
block dan **tidak boleh** muncul setelah `;`. Maka:

```python
data = json.loads(...); for tok in ...: ...   # SyntaxError
```

**Kenapa bug ini senyap (silent failure):**
1. Subprocess crash saat parse (sebelum eksekusi) → `stdout` kosong total.
2. Parent membaca `proc.stdout` per-baris → tidak dapat apa-apa → generator
   berakhir normal (bukan exception).
3. `stderr` di-`PIPE` tapi **tidak pernah diperiksa** → `SyntaxError` terkubur.
4. Frontend menerima `results` + `done` (status 200) tapi tanpa `token` →
   pesan assistant kosong. Tidak ada error yang dilempar.

**Kenapa bug serupa tidak terjadi di fungsi orchestrator lain?**
`search_and_rank` dan `format_results` (non-stream) memakai inline command yang
semuanya **simple statements** — assignment, list comprehension, `print(...)`:

```python
"...; ranked = rank(results); output = [...]; print(json.dumps(output))"   # ✅ valid
```

`format_results_stream` adalah **fungsi pertama** yang menaruh loop `for` di
inline `-c` → jadi satu-satunya yang melanggar aturan grammar.

**Klasifikasi:** Bug logic — salah pemahaman grammar Python untuk statement
compound pada `python -c`, diperparah stderr yang tidak di-surface.

---

## 6. Mengapa Tidak Ketahuan Lebih Awal?

| Pertahanan | Status | Catatan |
|-----------|--------|---------|
| `astro check` / `npm run build` | ✅ lulus | Hanya mengecek **frontend**; backend Python tidak tercakup |
| `python3 -c "ast.parse(...)"` | ⚠️ tidak ada | Tidak ada CI/lint Python; `SyntaxError` inline command tidak dicek otomatis |
| Smoke test SSE | ❌ tidak ada | Sprint-1 menguji `/search` non-stream manual; jalur SSE baru aktif di Phase 3 |
| Lazy-load model | ❌ tidak | `ingest.py` selalu load model walau tidak dibutuhkan → setiap request rentan crash |
| Surface subprocess stderr | ❌ tidak | `stderr=PIPE` tanpa pernah dibaca → error subprocess terkubur |

**Inti:** Kedua bug hidup di celah antara **frontend yang ter-otomasi** (astro
check/build) dan **backend yang diuji manual saja**. Phase 3 menyalakan jalur
streaming end-to-end untuk pertama kalinya, sehingga kedua celah itu terekspos
bersamaan.

---

## 7. Perbaikan (Fix)

### RC-1

**`services/rag-engine/src/ingest.py`** — model jadi lazy + attention `eager`:

```python
# model hanya di-load kalau ada dokumen baru
if not new_docs:
    return {"indexed": 0, "skipped": len(docs), "total": len(docs)}

model = SentenceTransformer(
    EMBED_MODEL, model_kwargs={"attn_implementation": "eager"}
)
```

**`services/rag-engine/src/search.py`** — query embedding juga pakai `eager`:

```python
model = SentenceTransformer(
    EMBED_MODEL, model_kwargs={"attn_implementation": "eager"}
)
```

### RC-2

**`services/rag-engine/src/summarize.py`** — helper baru agar inline command
cukup memanggil **satu simple statement**:

```python
def stream_to_stdout(query, results, model=LLM_MODEL):
    for tok in summarize_stream(query, results, model):
        sys.stdout.write(json.dumps({"t": tok}) + "\n")
        sys.stdout.flush()
```

**`api/src/orchestrator.py`** — `format_results_stream` memanggil helper,
bukan loop inline:

```python
"import json, sys; "
"from src.summarize import stream_to_stdout; "
"data = json.loads(sys.stdin.read()); "
"stream_to_stdout(data['query'], data['results'])"   # ✅ semua simple statements
```

> Bonus: juga sudah ditambahkan `--reload` pada FastAPI agar perubahan kode
> backend langsung di-pickup tanpa restart manual.

---

## 8. Verifikasi

| Skenario | Sebelum | Sesudah |
|----------|---------|---------|
| `SentenceTransformer` load `bge-m3` | ❌ 14.34 GiB crash | ✅ encode OK (dim 1024) |
| `POST /search stream=true` HTTP | ❌ 500 | ✅ 200 |
| Event SSE | progress/pipeline/results/done (0 token) | progress/pipeline/results/**25× token**/done |
| Dashboard `/search?q=wifi kenceng` | error banner | kartu kos + ringkasan streaming muncul |

---

## 9. Pencegahan / Action Items

| # | Action | Prioritas | Status |
|---|--------|-----------|--------|
| 1 | Selalu set `attn_implementation="eager"` saat load `SentenceTransformer` (bge-m3) | High | ✅ done |
| 2 | `ingest.py`: load model hanya saat ada dokumen baru (lazy) | High | ✅ done |
| 3 | Hindari compound statement pada `python -c` inline; kapsulkan ke helper module bila perlu loop | High | ✅ done |
| 4 | Surface `stderr` subprocess orchestrator ke log FastAPI (jangan `PIPE` tanpa dibaca) | Medium | 🟡 backlog |
| 5 | Tambah smoke test SSE minimal: `curl POST /search stream=true` pastikan ada ≥1 event `token` | Medium | 🟡 backlog |
| 6 | `python -m py_compile` (atau AST parse) untuk semua file `api/` & `services/**/src/` sebagai pre-commit | Medium | 🟡 backlog |
| 7 | Pin `transformers`/`torch` version + catat default attention yang aman di `services/rag-engine/requirements` | Low | 🟡 backlog |

---

## 10. Referensi File

| File | Peran |
|------|-------|
| `services/rag-engine/src/ingest.py` | RC-1: lazy model load + eager attention |
| `services/rag-engine/src/search.py` | RC-1: eager attention untuk query embedding |
| `services/rag-engine/src/summarize.py` | RC-2: helper `stream_to_stdout()` + `summarize_stream()` |
| `api/src/orchestrator.py` | RC-2: `format_results_stream()` pakai helper (simple statement) |
| `api/src/search.py` | Konteks: `_stream_response()` SSE event sequence |
| `web/src/lib/api.ts` | Konsumen frontend (`streamSearch`) — tidak diubah, sudah benar |

---

## 11. Pelajaran (Lessons)

- **"Build hijau" tidak berarti jalan.** `astro check`/`build` hijau hanya
  membuktikan frontend sehat; backend Python tidak punya gate otomatis setara.
- **Subprocess dengan `stderr=PIPE` yang tidak dibaca = black box.** Error
  terkubur dan kegagalan terlihat seperti "kosong" biasa.
- **Grammar Python `python -c`:** `;` hanya untuk simple statements. Inline
  command yang panjang perlu diuji terisolasi dulu, atau dipindah ke helper.
- **Default library bisa bergerak diam-diam.** Perubahan default
  `attn_implementation` dari upstream `transformers` bisa mematahkan kode lama
  tanpa kode kita berubah — versi pin + eksplisit parameter adalah pertahanan.
- **Lazy initialization menang ganda:** mempercepat (skip model load 2.3 GB)
  sekaligus mengurangi surface area bug.
