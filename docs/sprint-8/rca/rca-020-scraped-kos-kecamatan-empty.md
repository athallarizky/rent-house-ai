# RCA-020 — Kos hasil scrape tidak ter-searchable (kecamatan kosong)

> **Tanggal:** 2026-06-20
> **Sprint:** 8 — saat smoke test area baru (Tenjo)
> **Severity:** High (area hasil scrape sama sekali tidak bisa di-search meski sudah di-index)
> **Layanan terdampak:** search (`POST /search`), pipeline data dashboard
> **Status:** ✅ Resolved

## 1. Ringkasan

Setelah scrape Tenjo (50 kos asli dari Google Maps) → process → index (48 docs
masuk ChromaDB), pencarian `"kos di tenjo"` tetap mengembalikan **0 results**.
Area hasil scrape tampak tidak berfungsi end-to-end.

## 2. Gejala

- Scrape Tenjo → 50 kos asli (ada `place_id`, `title`, rating, reviews)
- Pipeline: "Done: 47 new for Tenjo" — docs ter-index di ChromaDB
- `POST /search {"query":"kos di tenjo"}` → `results: []`
- Dashboard: Tenjo `indexed: ✗` (karena grouping per kecamatan)

## 3. Root Cause

Distribusi kecamatan pada docs Tenjo:

```
'(empty)': 19, 'Karawaci': 15, 'Cibodas': 6, 'Tangerang': 6, 'Periuk': 1, ...
→ NOL yg kecamatan="Tenjo"
```

Alur gagal:
1. Scraper Google Maps **sering tidak mengembalikan `postal_code`** pada raw
   entry (field `complete_address.postal_code` kosong).
2. data-processor `enrich()` di `services/data-processor/src/enrich.py` resolve
   kecamatan **dari postal_code via kodepos**:
   ```python
   pc = entry.get("postal_code", "")
   if pc and pc in _postal_lookup: ...   # ← pc kosong → else
   else:
       entry.setdefault("kecamatan", "")  # ← kosong
   ```
3. `build_document()` pakai `entry.get("kecamatan", "")` → doc ter-index dgn
   kecamatan `""`.
4. Search memfilter `where kecamatan = "Tenjo"` → tidak ada yg cocok → 0 hasil.

19/48 docs Tenjo dapat kecamatan kosong. Sisanya resolve ke kecamatan tetangga
(Karawaci/Cibodas/Tangerang) karena Google Maps mengembalikan kos di perbatasan.

## 4. Perbaikan

`enrich()` menerima parameter `area` (nama area scrape, selalu tersedia di
`process_area`). Saat lookup postal gagal, **fallback ke nama area**:

```python
def enrich(entry, area=None):
    ...
    if pc and pc in _postal_lookup:
        ...  # kecamatan dari kodepos (valid)
    else:
        entry.setdefault("kelurahan", "")
        entry["kecamatan"] = area or entry.get("kecamatan") or ""  # ← fallback
        ...

# pipeline.py
entries = [enrich(e, area) for e in entries]   # pass area
```

Doc dgn postal valid tetap dapat kecamatan real dari kodepos; doc tanpa postal
ditag dgn nama area scrape → minimal searchable di area itu.

## 5. Verifikasi

| Check | Result |
|-------|--------|
| Sebelum fix | Tenjo: 0 docs dgn kecamatan="Tenjo" |
| Setelah fix | Tenjo: 19 docs kecamatan="Tenjo" |
| `POST /search "kos di tenjo"` | 5 results (~100ms) ✓ |
| `POST /search "kos putri murah di tenjo"` | 3 results ✓ |

## 6. Action Items

- [x] `enrich(entry, area)` + `process_area` pass area
- [ ] **Future:** scraper ekstrak postal_code lebih andal (dari `address`/`plus_code`);
      atau enrich fallback ke koordinat (reverse-geocode ke kecamatan terdekat)
- [ ] Pertimbangkan validasi: doc dgn kecamatan kosong di-flag saat validate

## 7. Pelajaran

1. **Source data (Google Maps) tidak reliable** untuk field terstruktur spt
   postal_code. Pipeline harus punya fallback, tidak boleh assume field terisi.
2. **Konteks area scrape adalah signal kuat** — `process_area` selalu tahu nama
   area-nya; gunakan sbg fallback saat resolution otomatis gagal.
3. **Bug "data masuk tapi tidak keluar"** paling insidious — index berhasil
   (tidak error), tapi search miss karena metadata salah. Perlu query cek
   distribusi metadata pasca-index, bukan hanya cek count.
