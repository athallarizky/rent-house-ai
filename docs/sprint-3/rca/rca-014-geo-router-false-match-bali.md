# RCA-014 — Geo-Router False Match (Bali → Cibaliung)

> **Tanggal:** 2026-06-20
> **Sprint:** 3 — Phase 8 (Workflow Fixes)
> **Severity:** Medium (UX — hasil pencarian di district yang salah total)
> **Layanan terdampak:** Geo-router (:3001), Web frontend `ChatInterface.tsx`
> **Status:** ✅ Resolved

---

## 1. Ringkasan

User mengetik `"Kos di Bali"` mengharapkan hasil di Bali (Denpasar atau sekitarnya),
tetapi bot merespon dengan hasil di **Cibaliung** — sebuah kecamatan di Pandeglang,
Banten, yang tidak ada hubungannya dengan Bali.

```
User: Kos di Bali
Bot:  Menampilkan 2 kos di Cibaliung yang cocok dengan "Kos di Bali":
      PENGINAPAN SAUNG KURING — 4.2★
      PENGINAPAN KARUNIA — 4.7★
```

---

## 2. Gejala

1. User mengetik query dengan nama area pendek: `"Kos di Bali"`
2. LLM intent (atau regex `extractArea`) mengembalikan `area: "Bali"`
3. `resolveLocation("Bali")` → geo-router fuzzy-match ke **"Cibaliung"** (substring "bali")
4. District Cibaliung di-load → hasil kos di Pandeglang, bukan Bali

---

## 3. Root Cause

### RC-1: Geo-router fuzzy match terlalu agresif

Geo-router menggunakan substring match: "Bali" terdapat dalam "Ci**bali**ung".
Query 4 karakter cocok dengan substring di nama district, tanpa mempertimbangkan
skala atau lokasi geografis.

```json
// curl http://localhost:3001/resolve?q=Bali
{
  "matchedAs": "Cibaliung",
  "province": "Banten",
  "regency": "Jembrana",   // ← juga salah (Cibaliung di Pandeglang, bukan Jembrana)
  "districts": [{ "name": "Cibaliung" }]
}
```

### RC-2: Tidak ada validasi hasil resolve

Frontend langsung menggunakan hasil `resolveLocation` tanpa memvalidasi apakah
match-nya masuk akal. Tidak ada pengecekan string similarity atau substring overlap.

---

## 4. Perbaikan

### Fix 1 — LLM Intent: province → capital city

Update intent prompt agar untuk query province-only (seperti "Bali", "Jawa Barat"),
LLM mengembalikan ibukota provinsi alih-alih nama provinsi mentah:

```
"kos di Bali" → area: "Denpasar" (bukan "Bali")
"kos di Jawa Barat" → area: "Bandung" (bukan "Jawa Barat")
```

Prompt update:
```
If the query mentions a province only (e.g., "Bali", "Jawa Barat"),
return the provincial capital city instead.
Example: "kos di Bali" → area: "Denpasar".
```

### Fix 2 — Frontend guard: false match detection

Tambahkan validasi di `handleSendMessage` setelah `resolveLocation`. Jika match
mencurigakan (query pendek, tidak ada substring overlap), tolak dan tampilkan error:

```typescript
const isBadMatch = (
  districts.length === 1 &&
  matchedLower !== areaLower &&
  !matchedLower.includes(areaLower) &&
  !areaLower.includes(matchedLower) &&
  areaLower.length <= 6
);
if (isBadMatch) {
  // Show error: "Tidak dapat menemukan area 'Bali'"
  return;
}
```

**Kondisi false match:**
- Hanya 1 district (bukan regency)
- Nama matched ≠ nama query
- Tidak ada substring overlap (dua arah)
- Query pendek (≤ 6 karakter) — query pendek lebih rentan false match

---

## 5. Verifikasi

| Check | Result |
|-------|--------|
| `npm run check` | 0/0/0 |
| `npm run build` | 3 pages |
| "Kos di Bali" (via LLM intent) | intent → area: "Denpasar" → resolve berfungsi normal |
| "Kos di Bali" (via regex, mode Cepat) | area: "Bali" → resolve → guard detect false match → error message |
| "Kos di Cengkareng" (normal, pendek) | area: "cengkareng" → resolve → matchedAs "Cengkareng" → OK (match persis) |
| "Kos di Jakarta Barat" (regency, >6 char) | Bypass guard → regency picker normal |

---

## 6. Action Items

- [x] LLM intent: province → capital city mapping
- [x] Frontend guard: string similarity check untuk false match
- [ ] **Future:** Laporkan bug geo-router ke tim/upstream — "Bali" seharusnya resolve
  ke Province Bali, bukan substring match ke "Cibaliung"

---

## 7. Pelajaran

1. **Substring matching berbahaya untuk nama pendek** — "Bali" (4 char) muncul di
   banyak nama tempat di Indonesia ("Cibaliung", "Balikpapan", "Baliu"). Tanpa
   konteks geografis, fuzzy match tidak bisa diandalkan.
2. **Defense-in-depth** — jangan percaya hasil resolve 100%. Tambahkan validasi
   client-side sebagai lapisan keamanan UX.
3. **LLM intent bisa jadi solusi untuk kualitas data** — dengan prompt yang tepat,
   LLM bisa "memperbaiki" query ambigu (Bali → Denpasar) sebelum masuk ke pipeline
   yang rawan error.
