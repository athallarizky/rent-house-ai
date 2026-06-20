# RCA-011 — District Switch Fallback Menyesatkan ke District Lama

> **Tanggal:** 2026-06-20
> **Sprint:** 3 — Phase 8 (Workflow Fixes)
> **Severity:** Medium (UX — hasil pencarian tidak sesuai ekspektasi)
> **Layanan terdampak:** Web frontend `ChatInterface.tsx`
> **Status:** ✅ Resolved

---

## 1. Ringkasan

User bertanya "kos di tambora" (district baru), tetapi bot merespon:

> Menampilkan 10 kos di **Cengkareng** yang relevan dengan "kos di tambora"

District lama (Cengkareng) digunakan sebagai fallback padahal user sudah eksplisit
meminta district berbeda.

---

## 2. Gejala

1. User sebelumnya di district Cengkareng (Jakarta Barat)
2. User mengetik query dengan area berbeda: `"kos di tambora"`
3. Chat menampilkan hasil pencarian di **Cengkareng**, bukan Tambora
4. Tidak ada error message bahwa Tambora tidak tersedia
5. User bingung — hasil tidak sesuai query

---

## 3. Root Cause

**Error handler `handleSendMessage` fallback ke district lama tanpa indikasi
ke user.**

### Alur:

1. `handleSendMessage("kos di tambora")` dipanggil
2. Area di-resolve: Tambora (ditemukan oleh geo-router)
3. Karena Tambora ≠ Cengkareng → `loadDistrict("Tambora", ...)`
4. `loadDistrict` gagal — Tambora belum pernah di-scrape → `POST /area/load` error
5. Exception naik ke `catch` di `handleSendMessage`:

```typescript
catch (e) {
  // ... error handling ...
  if (currentDistrict) await queryDataset(text, currentDistrict, { chatHistory });
  // ← FALLBACK: query "kos di tambora" terhadap data Cengkareng
}
```

6. `queryDataset("kos di tambora", "Cengkareng")` → RAG search di Cengkareng
7. Hasil: daftar kos di Cengkareng, tapi label query "kos di tambora"

**Kenapa fallback ada?** Dari Sprint 2, fallback ini dimaksudkan sebagai
"degradasi graceful" — jika pencarian spesifik gagal, coba di district saat ini.
Tapi untuk perubahan district, ini kontra-produktif.

---

## 4. Perbaikan

Hapus fallback ke district lama. Ganti dengan error message yang informatif:

```typescript
catch (e) {
  console.error("handleSendMessage failed", e);
  const msg = friendlyError(e, "Gagal memproses pencarian.");
  setError(msg);
  setMessages((prev) => [...prev, {
    role: "assistant",
    content: `Maaf, terjadi kesalahan saat memproses **${text}**: ${msg}`,
  }]);
  setIsLoading(false);
  // ↑ tidak ada fallback ke currentDistrict
}
```

---

## 5. Verifikasi

| Check | Result |
|-------|--------|
| `npm run check` | 0/0/0 |
| `npm run build` | 3 pages |
| District baru tersedia (cached) | Load berfungsi normal |
| District baru tidak tersedia (no scrape) | Error message muncul, tidak fallback ke district lama |
| Same-district refine | Tidak terdampak — refine path terpisah |

---

## 6. Action Items

- [x] Hapus fallback `queryDataset` di catch handler
- [x] Ganti error message dengan nama query
- [x] Set `setIsLoading(false)` setelah error
- [ ] **Future:** Tambahkan indikator loading progress saat scrape district baru (saat ini loading spinner saja)

---

## 7. Pelajaran

1. **Fallback yang "pintar" bisa lebih buruk daripada error** — user lebih memilih
   error jelas ("Tambora belum tersedia") daripada hasil yang menyesatkan.
2. **Konteks query harus dipertahankan** — kalau user minta district X, jangan
   diam-diam berikan district Y.
3. **Debug error silent** — fallback terjadi tanpa log atau indikasi ke user,
   membuat bug ini sulit ditemukan tanpa membandingkan input vs output.
