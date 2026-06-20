# RCA-018 — Dashboard `/pipeline/data` indexed counts selalu 0

> **Tanggal:** 2026-06-20
> **Sprint:** 8 (In-Process RAG) — ditemukan saat validasi Sprint 7 dashboard
> **Severity:** Medium (dashboard Pipeline menunjukkan status salah — semua area `indexed:✗` meski data ada di ChromaDB)
> **Layanan terdampak:** `GET /pipeline/data` (Sprint 7), UI `/pipeline`
> **Status:** ✅ Resolved

---

## 1. Ringkasan

Halaman Pipeline dashboard menampilkan `indexed: ✗` dan `kos: 0` untuk **semua
area**, padahal ChromaDB berisi data (113+ entries). User tidak bisa membedakan
area yg benar-benar belum ter-index dari area yg sudah.

## 2. Gejala

- `GET /pipeline/data` → `totals.indexed: 0`, semua area `indexed_count: 0`
- Query chroma manual (`col.count()`) → 113 entries (data ADA)
- Tidak ada error di log — response 200, hanya datanya kosong
- Saat Sprint 7 di-test lokal (tanpa chromadb terpasang), `indexed:0` dianggap
  wajar ("tidak ada chroma") — **bug tertutup oleh kondisi environment**

## 3. Root Cause

`_get_indexed_counts()` di `api/src/pipeline_data.py` menjalankan query chroma
via **subprocess one-liner**:

```python
subprocess.run([sys.executable, "-c",
  "import json, chromadb; ...; "
  "for m in res.get('metadatas', []) or []: "
  "    k = (m or {}).get('kecamatan') or 'unknown'; "
  "    counts[k] = counts.get(k, 0) + 1; "   # ← dua statement setelah ':'
  "print(json.dumps(counts))"], ...)
```

**`for ... : a; b` adalah SyntaxError di Python.** Body one-liner `for` hanya
boleh **satu** simple statement; setelah `:` tidak boleh ada `;` untuk statement
kedua. Subprocess gagal (returncode 1, stdout kosong) → `json.loads("")` →
`except` → return `{}` → semua indexed count 0.

## 4. Perbaikan

Konversi ke **in-process** via `rag_bridge.get_collection()` (sekaligus selaras
dengan tujuan Sprint 8 — eliminasi subprocess):

```python
def _get_indexed_counts():
    try:
        from .rag_bridge import get_collection
        col = get_collection()
        res = col.get(include=["metadatas"])
    except Exception:
        return {}
    counts = {}
    for m in res.get("metadatas", []) or []:
        k = (m or {}).get("kecamatan") or "unknown"
        counts[k] = counts.get(k, 0) + 1
    return counts
```

## 5. Verifikasi

| Check | Result |
|-------|--------|
| `python -c` one-liner asli | returncode 1 (SyntaxError) |
| Reproduce subprocess exact | stdout kosong, stderr menunjukkan syntax error |
| Setelah fix | dashboard: Bekasi Timur 54, Cakung 29, Pulogadung 30 ✓ |

## 6. Action Items

- [x] Konversi `_get_indexed_counts` ke in-process via `rag_bridge`
- [x] Hapus import `subprocess`/`sys` yg jadi unused di pipeline_data.py

## 7. Pelajaran

1. **One-liner `python -c` berbahaya** untuk logic bercabang (`for`/`if` dengan
   multi-statement body). Gunakan file temp atau multi-line string `"""..."""`.
2. **Bug tertutup environment** — saat test lokal tanpa chromadb, gejala
   (`indexed:0`) tampak wajar. Seharusnya unit test mengisolasi logic dari
   dependency agar bug syntactic seperti ini tertangkap terlepas dari env.
3. **Subprocess sbg abstraction boundary menyembunyikan error** — kegagalan
   silent (return `{}`) tanpa exception membuat debugging sulit. In-process
   call memunculkan error secara natural.
