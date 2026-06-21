# RCA-004 — "Taman Sari" Salah Klasifikasi sebagai POI (400)

> **Tanggal:** 2026-06-19
> **Sprint:** 2 — Rev-001 (Session-Scoped Dataset)
> **Severity:** Medium (district tak bisa di-load walau valid)
> **Komponen:** `services/geo-router/src/classify.ts`, `api/src/orchestrator.py` (`load_area`)
> **Status:** ✅ Resolved (workaround backend); classifier geo-router belum diperbaiki

---

## 1. Ringkasan

Switch district ke **Taman Sari** lewat switcher gagal `400`:
`"'Taman Sari' is a Point of Interest, not an area."`
Padahal Taman Sari adalah **kecamatan valid** di Jakarta Barat (muncul di daftar sibling!).

Akar masalah: geo-router POI classifier memakai keyword sederhana — kata **"taman"**
(dll: kebun, mall, stasiun) → langsung dilabeli POI. "Taman Sari" kebetulan mengandung
kata "taman" → **false positive**. Ironisnya, resolve tingkat **regency** tetap mendaftarnya
sebagai district (karena pencocokan exact nama district), jadi data inkonsisten antara
resolve direct vs regency.

---

## 2. Gejala

```
POST /area/load {"district":"Taman Sari","regency":"Administrasi Jakarta Barat"}
→ 400 {"detail":"'Taman Sari' is a Point of Interest, not an area."}
```

Tapi `GET /resolve?q=Administrasi+Jakarta+Barat` (regency) **menyertakan** "Taman Sari"
di daftar districts. Jadi nama valid sebagai district, tapi di-flag POI kalau di-resolve sendiri.

---

## 3. Root Cause

**Lokasi:** `services/geo-router/src/classify.ts` (`isPoi()`)

```ts
// skema sederhana: cek apakah query mengandung kata-kata POI
const POI_WORDS = ["taman", "kebon", "kebun", "mall", "stasiun", ...];
```

Mekanisme kegagalan:

```
load_area("Taman Sari", regency)
  └─ resolve_area("Taman Sari")           ← resolve direct
      └─ isPoi("taman sari") → true        ❌ (kata "taman")
          └─ return {type: "POI"}
  └─ load_area return error 400
```

Kenapa regency resolve tidak kena? Karena `resolve()` tingkat regency memakai **pencocokan
exact nama regency** (bukan fuzzy/keyword), lalu membangun daftar district dari entri kodepos
— klasifikasi POI hanya dijalankan di jalur direct. Maka terjadi inkonsistensi:
"Taman Sari" district valid di konteks regency, tapi POI saat berdiri sendiri.

**Klasifikasi:** false-positive classifier berbasis keyword; kata benda umum (taman, kebon)
bentrok dengan nama kecamatan proper.

---

## 4. Perbaikan

Karena classifier geo-router adalah kode sprint-1 dan perbaikan menyeluruh di luar lingkup
rev-001, diterapkan **workaround di backend** yang 100% memperbaiki jalur switcher:

`load_area` — kalau `regency` disediakan, **resolve via regency** dan cari district di daftar-nya
(bukan resolve direct):

```python
if regency:
    regency_geo = resolve_area(regency)
    for d in regency_geo.get("districts", []):
        if d.get("name", "").lower() == district.lower():
            matched_district = d          # ✅ ditemukan via regency, bypass POI classifier
            break
```

Switcher **selalu** mengirim `regency` (`currentRegency`), jadi semua district sibling — termasuk
yang namanya mengandung kata POI — bisa di-load. Resolve direct (tanpa regency) tetap memakai
jalur lama; kasus itu langka (user ngetik nama district mentah).

---

## 5. Verifikasi

| Skenario | Sebelum | Sesudah |
|----------|---------|---------|
| `POST /area/load Taman Sari (+regency)` | 400 POI | ✅ proceed (scrape → dataset) |
| `POST /area/load Kebon Jeruk (+regency)` | OK | ✅ OK |
| Switcher: pilih district sibling mana pun | gagal untuk nama ber-POI-word | ✅ semua jalan |

---

## 6. Pencegahan / Action Items

| # | Action | Status |
|---|--------|--------|
| 1 | `load_area`: resolve via regency saat regency disediakan (bypass POI) | ✅ done |
| 2 | **Perbaikan geo-router `classify.ts`:** sebelum label POI, cek apakah query cocok exact dengan nama district yang ada di kodepos → kalau ya, bukan POI | 🟡 backlog (proper fix) |
| 3 | Tambah unit test geo-router: "Taman Sari", "Kebon Jeruk", "Tambora" → bukan POI | 🟡 backlog |
| 4 | Konsistensi: POI check hanya di satu jalur (tidak direct-vs-regency berbeda hasil) | 🟡 backlog |

---

## 7. Pelajaran

- **Classifier berbasis keyword itu rapuh.** Nama tempat Indonesia banyak yang pakai kata benda
  umum (Taman Sari, Kebon Jeruk, Tanjung Duren) — keyword-only akan false-positive.
- **Validasi sebelum label.** Sebelum menandai POI, pastikan bukan nama administratif yang
  dikenal (district/regency di dataset).
- **Inkonsistensi antar-jalur adalah bau bug.** Kalau "Taman Sari" district di satu resolve tapi
  POI di resolve lain, itu sinyal classifier terlalu agresif — bukan data yang salah.
- Workaround di lapis yang lebih dekat pemanggil (backend) valid untuk MVP, tapi proper fix
  tetap di sumber (classifier).
