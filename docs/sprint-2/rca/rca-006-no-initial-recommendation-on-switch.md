# RCA-006 — Rekomendasi Awal Tidak Muncul Saat Switch District

> **Tanggal:** 2026-06-19
> **Sprint:** 2 — Rev-001 (Session-Scoped Dataset)
> **Severity:** Medium (UX terganggu — district ter-load tapi chat sepi, tidak ada highlight)
> **Komponen:** `web/src/components/ChatInterface.tsx` (`loadDistrict`, `onSwitchDistrict`)
> **Status:** ✅ Resolved

---

## 1. Ringkasan

Setelah Rev-001, switch district via switcher **berhasil memuat dataset** (panel kanan
terisi), tapi **chat kosong** — tidak ada rekomendasi awal seperti "Pencarian: kos di
kebon jeruk", dan tidak ada kos yang di-highlight.

Akar masalah: `loadDistrict` hanya menjalankan RAG kalau diberi `initialQuery` eksplisit.
`onSwitchDistrict` memanggil `loadDistrict(name, regency)` **tanpa** `initialQuery` → RAG
tidak jalan → tidak ada ringkasan & tidak ada relevance set. Jalur switch (dan bootstrap
`?area=`) terlewat dari wiring "rekomendasi awal", padahal rev-001 plan §13 Q1 sudah
memutuskan "jalankan RAG awal saat load".

---

## 2. Gejala

- Switch ke Kebon Jeruk: panel kanan terisi ~131 kos (dataset loaded ✓)
- Chat: **kosong** — tidak ada pesan asisten / ringkasan
- Sidebar: **tidak ada highlight** (semua kartu sama, tidak ada yang "Cocok")
- Bootstrap `?area=Cengkareng` (tanpa `?q=`): gejala sama — dataset tampil, chat sepi

Jalur yang **tidak** terdampak (sudah benar): picker pick, direct district search, `?q=` —
semuanya meneruskan query pengguna sebagai `initialQuery` → RAG jalan → rekomendasi muncul.

---

## 3. Root Cause

**Lokasi:** `ChatInterface.tsx`

```ts
// onSwitchDistrict — TIDAK kirim initialQuery
const onSwitchDistrict = (name) => {
  ...
  void loadDistrict(name, currentRegency || undefined);   // ❌ tanpa initialQuery
};

// loadDistrict — RAG hanya kalau ada initialQuery
async function loadDistrict(district, regency, initialQuery?) {
  ...
  if (initialQuery && initialQuery.trim()) {              // ❌ false saat switch
    await queryDataset(initialQuery.trim(), res.district);
  }
}
```

**Mekanisme:**

```
switch district
  └─ loadDistrict(name, regency)        ← initialQuery = undefined
      └─ load dataset ✓
      └─ if (initialQuery) → false      ← RAG di-skip
          (tidak ada queryDataset → tidak ada ringkasan, tidak ada relevantIds)
```

Kenapa jalur lain jalan? Karena mereka kasih `initialQuery`:
- `onPickKecamatan` → `loadDistrict(name, regency, pendingArea.query)`
- `handleSendMessage` (direct district) → `loadDistrict(name, regency, text)`
- bootstrap `?q=` → `handleSendMessage(q)` → akhirnya `loadDistrict(..., q)`

Jadi wiring "rekomendasi awal" hanya tersambung di jalur yang punya teks query eksplisit.
Switch & bootstrap `?area=` (tidak punya teks query) luput.

**Klasifikasi:** bug logika — kondisional "jalan RAG hanya jika ada query" salah untuk model
sesi; di model sesi, load = selalu butuh rekomendasi awal biar panel & chat sinkron.

---

## 4. Perbaikan

`loadDistrict` **selalu** menjalankan rekomendasi awal:

```ts
const explicit = initialQuery && initialQuery.trim();
const initialQ = explicit ? initialQuery.trim() : `kos di ${res.district}`;
await queryDataset(initialQ, res.district, { saveSearch: !!explicit });
```

- Query eksplisit (picker/direct/`?q=`) → pakai query itu + **simpan ke history**
- Tidak eksplisit (switch/bootstrap) → fallback `kos di <district>` + **tidak disimpan**
  (biar history tidak berisih entri "kos di X" berulang tiap switch)

`queryDataset` ditambah opsi `{ saveSearch?: boolean }` (default `true`) untuk membedakan
rekomendasi otomatis vs query pengguna. `onSwitchDistrict` tidak lagi menambah pesan
"Beralih ke X" (rekomendasi otomatis sudah menyebut district, jadi redundant).

---

## 5. Verifikasi

| Skenario | Sebelum | Sesudah |
|----------|---------|---------|
| Switch ke Kebon Jeruk | dataset tampil, chat kosong, 0 highlight | ✅ rekomendasi "kos di Kebon Jeruk" + top kos highlight |
| Bootstrap `?area=Cengkareng` | dataset tampil, chat kosong | ✅ rekomendasi awal muncul |
| Switch berulang (Cengkareng→Kebon Jeruk→…) | — | ✅ history tidak terisi entri "kos di X" otomatis |
| Picker pick (query eksplisit) | sudah benar | ✅ tetap benar + tersimpan ke history |

`astro check` 0/0/0, `npm run build` OK.

---

## 6. Pencegahan / Action Items

| # | Action | Status |
|---|--------|--------|
| 1 | `loadDistrict` selalu jalan rekomendasi awal (default `kos di <district>`) | ✅ done |
| 2 | Bedakan rekomendasi otomatis vs query pengguna via flag `saveSearch` | ✅ done |
| 3 | Konsistensi: semua jalur "load district" (switch/picker/bootstrap/search) → rekomendasi muncul | ✅ done |
| 4 | E2E test: switch ke N district berturut-turut, pastikan rekomendasi selalu muncul + history tidak polusi | 🟡 backlog |

---

## 7. Pelajaran

- **"Load data" vs "tanya" perlu dibedakan, tapi load tetap butuh tampilan awal.** Di model
  sesi, memuat dataset tanpa rekomendasi terasa mati — pengguna tidak tahu harus ngapain.
- **Wiring inconsistent antar-jalur adalah bau bug.** Sebagian jalur kirim `initialQuery`,
  sebagian tidak → seharusnya load itu satu perilaku (selalu rekomendasi), bukan bergantung
  pemanggilnya.
- **Hindari efek samping tersembunyi.** Rekomendasi otomatis yang ikut tersimpan ke history
  akan polusi data — perlu flag eksplisit (`saveSearch`) untuk membedakan aksi pengguna vs
  sistem.
