# RCA-016 — POI Geocode Gagal untuk Chat-Style Queries + Fused Indonesian Forms

> **Tanggal:** 2026-06-20
> **Sprint:** 3 — Phase 8 (Workflow Fixes) + Phase 10 (POI Geocoding)
> **Severity:** Medium (UX — POI search gagal di berbagai format query Indonesia)
> **Layanan terdampak:** Backend `api/src/geocode.py`, Frontend `ChatInterface.tsx`
> **Status:** ✅ Resolved

---

## 1. Ringkasan

Query POI dalam format chat Indonesia seperti "Kos disekitaran mall One Belpark" atau
"Kos di sekitar mall One Belpark" gagal di-geocode. Nominatim tidak mengenali full
chat query — hanya nama lokasi mentah ("One Belpark") yang berfungsi. User mendapat
error "Tidak dapat menemukan lokasi" meskipun lokasi tersebut ada di database OSM.

---

## 2. Gejala

| Query | Sebelum | Sesudah |
|-------|---------|---------|
| `Kos di sekitar mall One Belpark` | Error: tidak ditemukan | Cilandak, Jakarta Selatan ✅ |
| `Kos disekitaran mall One Belpark` | Error: tidak ditemukan | Cilandak, Jakarta Selatan ✅ |
| `Kos sekitaran One Belpark, Jakarta Selatan` | Fallback ke Jakarta Selatan picker (intent timeout) | Tetap ke picker (ada regex area) ✅ |
| `Kos di sekitar Jakarta Barat` | Auto-load Cengkareng (salah) | Jakarta Barat picker ✅ |

Semua query mengandung nama lokasi valid yang SEHARUSNYA bisa di-geocode, tapi
gagal karena format chat.

---

## 3. Root Cause

### RC-1: Full chat query tidak dikenal Nominatim

Frontend mengirim `intentPoi = text` (full query seperti "Kos disekitaran mall One
Belpark") ke `POST /poi/resolve`. Nominatim tidak memahami frasa "kos di sekitar"
atau "mall" sebagai search term — hanya nama tempat spesifik yang berfungsi.

### RC-2: Prefix stripping berbasis exact match gagal di fused forms

Prefix stripping versi awal hanya menangani kata terpisah (`"kos di sekitar "`).
Bahasa Indonesia colloquial sering menggabungkan prefix menjadi satu kata:
- `disekitaran` (fused: "di" + "sekitaran")
- `disekitar` (fused: "di" + "sekit")
- `didekat` (fused: "di" + "dekat")

Exact string matching tidak bisa menangani ini.

### RC-3: Area regex kalah prioritas dari POI flow

Query seperti "Kos di sekitar Jakarta Barat" mengandung kata "sekitar" (trigger
POI) DAN area dikenal "Jakarta Barat" (regex). POI flow jalan duluan → geocode
"Jakarta Barat" → Nominatim return district spesifik (Cengkareng) alih-alih
regency. User dapat auto-load Cengkareng padahal maunya Jakarta Barat.

---

## 4. Perbaikan

### Fix 1 — Regex-based query wrapper stripping

Ganti exact prefix matching dengan regex yang handle fused forms:

```python
wrappers = [
    r"\bkos\s+(?:di\s*)?sekitar(?:an|in)?\s+",
    r"\bkosan\s+(?:di\s*)?sekitar(?:an|in)?\s+",
    r"\b(?:di\s*)?sekitar(?:an|in)?\s+",
    r"\b(?:di\s*)?dekat\s+",
    r"\bdisekitar(?:an|in)?\s+",
]
```

Key: `di\s*sekitar` — nol atau lebih spasi antara "di" dan "sekitar". Handle:
- `di sekitar` (dua kata)
- `disekitar` (fused, tanpa spasi)
- `sekitar` (tanpa "di")
- `disekitaran`, `disekitarin` (colloquial suffixes)

Setelah wrapper di-strip, lanjut strip POI type prefix (`mall`, `stasiun`, dll).

### Fix 2 — Area regex priority over POI

Di `handleSendMessage`, cek `extractArea()` SEBELUM masuk POI flow:

```typescript
const regexArea = extractArea(text);
if (intentPoi && !intentArea && !regexArea) {
  // POI flow — only if no known area found
}
```

"Kos di sekitar Jakarta Barat" → regex nemu "jakarta barat" → skip POI → langsung
area resolution → regency picker.

### Fix 3 — POI fallback error context-aware

Saat POI gagal, cek regex area dulu sebelum tampilkan error:

```typescript
if (!poiResult) {
  const regexFallback = extractArea(text);
  if (regexFallback) {
    intentArea = regexFallback;  // gunakan area yang dikenal
  } else {
    // tampilkan error
  }
}
```

---

## 5. Verifikasi

| Query | Expected | Result |
|-------|----------|--------|
| `Kos di sekitar mall One Belpark` | Cilandak, Jaksel | ✅ |
| `Kos disekitaran mall One Belpark` | Cilandak, Jaksel | ✅ |
| `Kos sekitaran One Belpark, Jakarta Selatan` | Jaksel picker (area regex) | ✅ |
| `Kos di sekitar Jakarta Barat` | Jakbar picker (area regex) | ✅ |
| `Kos di sekitar stasiun poris` | Batuceper, Tangerang | ✅ |
| `kos di taman kota` (typo, ga ada) | Error message | ✅ |

---

## 6. Action Items

- [x] Regex-based wrapper stripping (fused forms: disekitaran, didekat)
- [x] Area regex priority before POI flow
- [x] POI error → regex area fallback
- [x] Prefix list: `mall`, `stasiun`, `terminal`, `bandara`, `universitas`, `kampus`, `pasar`, `alun-alun`, `taman`

---

## 7. Pelajaran

1. **Bahasa Indonesia colloquial butuh regex, bukan exact match** — "disekitaran",
   "disekitarin", "dideket" adalah varian yang umum. Exact prefix matching tidak
   scalable untuk natural language.
2. **Area detection harus punya prioritas tertinggi** — kalau user sebut nama area
   yang dikenal, jangan biarkan POI flow "membajak" query tersebut.
3. **Geocoding bukan pengganti NLP** — Nominatim tidak mengerti format chat. Kita
   harus jadi jembatan: bersihkan query → kirim nama tempat murni → geocode.
4. **Test dengan real user queries** — "Kos disekitaran mall X" adalah format 100%
   natural untuk user Indonesia. Test case harus mencakup varian colloquial, bukan
   cuma format "bersih".
