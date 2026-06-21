# RCA-008 — Geo-Router Resolve Mis-resolves Districts (Buahbatu→Blahbatuh, Taman Sari→POI)

> **Tanggal:** 2026-06-19
> **Sprint:** 2 — Phase 5 (ditemukan saat verifikasi history re-run)
> **Severity:** High (district salah lokasi / salah flag POI → chat jawab data kota lain)
> **Komponen:** `services/geo-router/src/resolve.ts`, `services/geo-router/src/server.ts`
> **Status:** ✅ Resolved (root cause)
> **Hubungan:** **supersedes** workaround RCA-004 (Taman Sari) & RCA-004 (Buahbatu) —
> perbaikan ini di sumber (geo-router), bukan lagi band-aid di backend.

---

## 1. Ringkasan

Dua gejala berbeda, dua akar masalah di geo-router, fix di sumber:

1. **"Buahbatu" → "Blahbatuh, Gianyar"** (Bali!) padahal harusnya Buahbatu, Bandung.
   `resolve()` fuzzy-search + `findBestMatch` count-based (abaikan Fuse score) → Blahbatuh
   menang karena lebih banyak entri di top-20.
2. **"Taman Sari" / "Kebon Jeruk" → POI** padahal kecamatan valid. `server.ts`
   short-circuit `isPoi(q)` di handler SEBELUM `resolve()` → exact-district check
   tidak pernah jalan untuk nama district yang mengandung kata POI.

Konsekuensi user-facing: klik history "kos di bandung" → malah load Blahbatuh/Gianyar,
LLM bilang "data ada di Gianyar". Padahal user mau pindah ke Bandung + lihat district picker.

---

## 2. Gejala

```
GET /resolve?q=Buahbatu    → matchedAs "Blahbatuh", regency Gianyar   ❌
GET /resolve?q=Taman Sari  → type POI                                  ❌
GET /resolve?q=Bandung     → (setelah fix naif) district "Bandung" di Tulungagung ❌ (regression)

User: klik history "kos di bandung"
  → loadDistrict("Buahbatu" [area tersimpan], tanpa regency)
  → load_area → resolve_area("Buahbatu") → Blahbatuh/Gianyar
  → dataset + chat jadi Gianyar, bukan Bandung
```

---

## 3. Root Cause

### RC-A — `resolve.ts`: `findBestMatch` count-based, abaikan Fuse score

```ts
const results = fuse.search(aliased, { limit: 20 });   // ada score per result
const entries = results.map((r) => r.item);            // ← score dibuang
const bestDistrict = findBestMatch(entries, "district"); // count-only
```
Untuk "Buahbatu", top-20 berisi lebih banyak entri "Blahbatuh" (fuzzy) dibanding
"Buahbatu" (exact) → count menang → salah district. Exact match (score 0) tidak
diprioritaskan.

### RC-B — `server.ts`: isPoi short-circuit sebelum resolve

```ts
app.get("/resolve", async (req) => {
  if (isPoi(q)) return { type: "POI", ... };   // ← "Taman Sari" kena "taman"
  const result = resolve(fuse, rawData, q, regencyNames);
});
```
`isPoi("Taman Sari")` true (kata "taman") → balas POI langsung, `resolve()` tidak
dipanggil. Akibatnya exact-district check (yang ada di `resolve()`) tidak sempat
menyelamatkan nama district bermuatan kata POI.

### RC-C — order: exact-district sebelum regency check = regression

Fix naif (exact-district paling depan) bikin "Bandung" (yang adalah regency
**dan** ada district "Bandung" di Tulungagung) malah jadi district → picker 61
kecamatan hilang. Order harus: **regency check → exact district → isPoi → fuzzy**.

---

## 4. Perbaikan (di sumber)

### `services/geo-router/src/resolve.ts`
- Cek **regency exact** dulu (lewat `regencyNames`) — regency-level intent menang.
- Lalu **exact district match** (`data.find(district === query)`) — exact selalu
  beat fuzzy. Buahbatu → Buahbatu (Bandung).
- Baru `isPoi` → Fuse fuzzy sebagai fallback.

```ts
if (regencyNames?.has(aliased.toLowerCase())) { ... return regency; }
const exactDistrict = data.find((e) => e.district.toLowerCase() === aliased.toLowerCase());
if (exactDistrict) { return buildDistrictResult(...); }
if (isPoi(aliased)) return null;
// ... fuse fuzzy
```

### `services/geo-router/src/server.ts`
- Hapus `isPoi(q)` short-circuit di handler + import gantung. `resolve()` sudah
  handle isPoi internal (setelah exact-district). Sehingga "Taman Sari" lewat
  exact-district dulu → jadi district, bukan POI.

### Frontend (`ChatInterface.tsx`)
- `handleSendMessage`: `extractArea(text)` didahulukan daripada hint → query
  "kos di bandung" tetap terdeteksi sebagai regency meski di-re-run dari history
  yang menyimpan district spesifik.
- `handleSelectSaved`: lewat `handleSendMessage(query_text, hint?)` (hint hanya
  kalau query tanpa area) → re-run "kos di bandung" → **Bandung picker muncul
  lagi**, bukan langsung load district.

> RCA-007 (regency-scoped resolve di `load_area`/`search_and_rank`) tetap dipertahankan
> sebagai defense-in-depth, tapi sekarang bukan lagi satu-satunya penjaga — akar
> masalah sudah ditambal di geo-router.

---

## 5. Verifikasi

| Query | Sebelum | Sesudah |
|-------|---------|---------|
| `Buahbatu` | Blahbatuh, Gianyar ❌ | **Buahbatu, Bandung** ✅ |
| `Taman Sari` | POI ❌ | **AREA, district Taman Sari** ✅ ( ambiguity: Pangkal Pinang first; via switcher/regency → Jakarta Barat) |
| `Kebon Jeruk` | (sudah OK di RCA-007) | **Kebon Jeruk, Jakarta Barat** ✅ |
| `Bandung` | (fix naif → Tulungagung) | **regency, 61 districts** ✅ (picker) |
| `Cengkareng` | OK | OK (no regression) |
| `Jakarta Barat` | OK | **8 districts** ✅ |
| `Stasiun Duri` (POI asli) | type POI | "Location not found" (resolve→null via isPoi) — acceptable |
| `/area/load Buahbatu` tanpa regency | Gianyar ❌ | **Bandung, 25 kos** ✅ |

`astro check` 0/0/0; build OK; geo-router reload OK.

---

## 6. Pencegahan / Action Items

| # | Action | Status |
|---|--------|--------|
| 1 | exact-district match di `resolve()` (after regency check) | ✅ done |
| 2 | hapus isPoi short-circuit di `server.ts` | ✅ done |
| 3 | re-run history via `handleSendMessage` (re-detect intent) | ✅ done |
| 4 | Unit test geo-router: Buahbatu→Bandung, Taman Sari→district, Bandung→regency, Stasiun Duri→not-found | 🟡 backlog |
| 5 | Disambiguasi district multi-regency (Taman Sari ada di beberapa kota) — perlu scope provinsi/regency kalau tanpa konteks | 🟡 backlog |
| 6 | `findBestMatch` pertimbangkan Fuse score (bukan count-only) sebagai backup kalau exact gagal | 🟡 backlog |

---

## 7. Pelajaran

- **Fix akar > band-aid berlapis.** RCA-004 (Taman Sari) & RCA-007 (Buahbatu)
  sama-sama menambal di backend (resolve via regency). Tapi akarnya di geo-router
  (count-based + POI short-circuit). Sekali fix di sumber, kasus seribu ikut selesai.
- **Order pengecekan itu krusial.** exact-district sebelum regency check = regression
  (Bandung jadi district). Harus: regency → exact district → POI → fuzzy.
- **Short-circuit di layer atas bisa mematikan logika layer bawah.** isPoi di handler
  mem-block exact-district di resolve(). Audit tidak hanya isi fungsi, tapi juga urutan
  layer.
- **Resolve query harus deterministic untuk input valid.** Nama district exact tidak
  boleh kalah sama fuzzy lintas provinsi.
