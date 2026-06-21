# RCA-015 — Review Count Discrepancy + Truncated Kos Text

> **Tanggal:** 2026-06-20
> **Sprint:** 3 — Phase 8 (Workflow Fixes)
> **Severity:** Low (UX — user bingung kenapa 236 review tapi cuma 8 muncul)
> **Layanan terdampak:** Data-processor (`build_doc.py`), RAG engine (`ingest.py`), Web frontend (`KosDetail.tsx`)
> **Status:** ✅ Resolved

---

## 1. Ringkasan

Di sidebar kanan, KosCard menampilkan "236 review". Ketika user klik untuk melihat
detail, hanya muncul 8 review. User mengira sistem membuang data review.

```
KosCard:  ★ 4.4 · 236 review
KosDetail:  Review tamu: (hanya 8 review)
```

---

## 2. Gejala

1. KosCard menampilkan `review_count` dari Google Maps metadata (total review di
   Google Maps, misal 236)
2. KosDetail hanya menampilkan subset kecil review (misal 8)
3. Tidak ada indikasi bahwa data review tidak lengkap
4. Teks review kadang terpotong di tengah kata (misal "wif" bukan "wifi")

---

## 3. Root Cause

Tiga lapis pembatas review yang tidak dikomunikasikan ke user:

### RC-1: Scraper hanya dapat 8-10 review per listing

Google Maps scraper (`gmaps-scraper` binary) hanya mengambil review dari halaman
pertama Google Maps (~8-10 review). 236 adalah total review di Google Maps, tapi
scraper tidak bisa mengambil semuanya.

### RC-2: `_select_reviews` filter noise review

Data-processor memfilter review yang tidak usable (pertanyaan harga, ketersediaan
kamar, dll) via `is_usable_review()`. Dari 8-10 review, biasanya 5-8 yang usable.

### RC-3: `MAX_DOC_CHARS = 1500` terlalu konservatif

RCA-005 menambahkan limit 1500 karakter untuk mencegah crash embedding. Tapi limit
ini terlalu rendah — dokumen kos (nama, alamat, rating, fasilitas, review) biasanya
800-2000 karakter. Review terpotong di tengah.

### RC-4: Tidak ada transparansi di UI

KosDetail menampilkan `review_count` (total Google Maps) tanpa memberitahu user
berapa review yang benar-benar tersedia di data kita.

---

## 4. Perbaikan

### Fix 1 — `MAX_DOC_CHARS`: 1500 → 4000

**Analisis keamanan:**

| Metric | Nilai | Status |
|--------|-------|--------|
| bge-m3 max context | 8192 token (~32K chars) | 4K = 12.5% capacity ✅ |
| Batch encoding (×8 docs) | 32K chars | Jauh di bawah limit ✅ |
| RCA-005 crash threshold | 10K+ chars per doc | 4K aman (2.5× di bawah) ✅ |
| ChromaDB storage impact | +2 MB untuk 1,113 kos | Diabaikan |
| Embedding time impact | +30% per batch (~30ms) | Hanya saat ingest, model cached ✅ |

**Kesimpulan:** Tidak signifikan. Tidak ada risiko crash.

```python
# services/rag-engine/src/ingest.py
MAX_DOC_CHARS = 4000  # was 1500
```

### Fix 2 — KosDetail: tampilkan jumlah review tersedia

```tsx
{parsed.reviews.length > 0 && parsed.reviews.length < kos.review_count && (
  <span className="text-[11px] opacity-60">
    · {parsed.reviews.length} tersedia
  </span>
)}
```

Tampilan: **"236 review · 8 tersedia"**

---

## 5. Verifikasi

| Check | Result |
|-------|--------|
| Python AST parse (`ingest.py`) | OK |
| `npm run check` | 0/0/0 |
| `npm run build` | 3 pages |
| KosDetail: 236 total + 8 stored | "236 review · 8 tersedia" |
| KosDetail: 8 total + 8 stored | "8 review" (tanpa indikator, karena lengkap) |
| Embedding dengan 4K doc | Tidak crash, memory normal |

---

## 6. Action Items

- [x] `MAX_DOC_CHARS`: 1500 → 4000
- [x] KosDetail: tampilkan "N tersedia" jika < total
- [ ] **Future:** Pertimbangkan menambah scraper depth (`depth=2` atau `depth=3`)
  untuk mendapatkan lebih banyak review dari Google Maps
- [ ] **Future:** Re-index data existing untuk manfaatkan 4K limit (trigger via
  TTL Phase 2 atau manual delete chroma_db)

---

## 7. Pelajaran

1. **Limit yang terlalu konservatif bisa jadi UX bug** — 1500 chars cukup untuk
   mencegah crash, tapi merugikan kualitas data. Selalu monitor data aktual untuk
   menentukan limit yang tepat.
2. **Transparansi > asumsi** — user lebih suka tahu keterbatasan data ("236 review,
   8 tersedia") daripada dibuat bingung kenapa data tidak lengkap.
3. **Scraper depth adalah bottleneck sebenarnya** — bukan limit teks. Google Maps
   scraper hanya ambil 8-10 review per listing. Untuk review lengkap, perlu
   pendekatan berbeda (scrape Google Maps review page langsung, atau pakai API).
