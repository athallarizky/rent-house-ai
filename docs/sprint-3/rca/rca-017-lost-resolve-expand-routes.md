# RCA-017 — `/locations/resolve` and `/expand` Routes Lost During Edit

> **Tanggal:** 2026-06-20
> **Sprint:** 3 — Phase 8 (Workflow Fixes) + Sprint 4 Phase 6 (Area Switcher)
> **Severity:** High (seluruh pencarian gagal — area tidak bisa di-resolve)
> **Layanan terdampak:** FastAPI `GET /locations/resolve`, `GET /locations/expand`
> **Status:** ✅ Resolved

---

## 1. Ringkasan

Saat menambahkan endpoint `GET /locations/areas` untuk Area Switcher, route
`/resolve` dan `/expand` tidak sengaja terhapus dari file `locations.py`.
Semua pencarian yang bergantung pada area resolution gagal dengan error
"Gagal memproses pencarian".

---

## 2. Gejala

1. Setiap query pencarian gagal: "Maaf, terjadi kesalahan saat memproses..."
2. Area Switcher dropdown berfungsi, tapi setelah pilih regency → error
3. `curl http://localhost:8080/locations/resolve?q=Jakarta%20Selatan` → **404**
4. `curl http://localhost:8080/locations/areas?q=jakarta` → 200 OK
5. Geo-router langsung (`:3001/resolve`) berfungsi normal

---

## 3. Root Cause

**Edit tool mengganti seluruh konten file, bukan append endpoint baru.**

### Alur:

1. File awal `locations.py` berisi 3 route: `/resolve`, `/expand`, dan import
2. Edit dilakukan untuk menambahkan endpoint `/areas` + `_load_regencies()`
3. `oldString` di edit tool match dari awal file sampai akhir `/expand` route
4. `newString` hanya berisi kode baru (`/areas`) tanpa `/resolve` dan `/expand`
5. Hasil: `/resolve` dan `/expand` hilang dari file

```python
# Sebelum edit:
@router.get("/resolve")   # ← ADA
@router.get("/expand")    # ← ADA

# Setelah edit (bug):
@router.get("/areas")     # ← BARU
# /resolve dan /expand HILANG
```

### Kenapa tidak ketemu saat test?

Test pertama hanya verify `GET /locations/areas` (endpoint baru), tidak retest
endpoint existing (`/resolve`, `/expand`). Regression test tidak dilakukan
karena asumsi edit hanya menambah, bukan mengganti.

---

## 4. Perbaikan

Tambahkan kembali route `/resolve` dan `/expand` ke `locations.py`:

```python
@router.get("/resolve")
async def resolve_location(q: str = Query(..., description="Location name")):
    try:
        url = f"{GEO_ROUTER_URL}/resolve?q={urllib.parse.quote(q)}"
        resp = urllib.request.urlopen(url, timeout=5)
        return json.loads(resp.read())
    except Exception as e:
        raise HTTPException(502, f"Geo-router unavailable: {e}")

@router.get("/expand")
async def expand_location(q: str = Query(..., description="Regency name")):
    try:
        url = f"{GEO_ROUTER_URL}/expand?q={urllib.parse.quote(q)}"
        resp = urllib.request.urlopen(url, timeout=5)
        return json.loads(resp.read())
    except Exception as e:
        raise HTTPException(502, f"Geo-router unavailable: {e}")
```

---

## 5. Verifikasi

| Check | Result |
|-------|--------|
| Python AST parse | OK |
| `GET /locations/resolve?q=Jakarta Selatan` | 200, 10 districts |
| `GET /locations/expand?q=Jakarta Selatan` | 200 |
| `GET /locations/areas?q=jakarta` | 200, filtered results |
| Pencarian normal via UI | Berfungsi |

---

## 6. Action Items

- [x] Tambahkan kembali route `/resolve` dan `/expand`
- [x] Tambahkan debounce 250ms di AreaSwitcher search input
- [ ] **Future:** Tambahkan integration test untuk semua endpoint locations setelah setiap perubahan file

---

## 7. Pelajaran

1. **Edit tool bisa mengganti lebih dari yang dimaksud** — pastikan `oldString`
   match tepat pada blok yang ingin diganti, bukan seluruh file. Lebih aman:
   append di akhir file daripada replace dari awal.
2. **Regression test wajib setelah edit file existing** — test endpoint baru
   tidak cukup. Harus retest semua endpoint di file yang sama. Checklist:
   `GET /resolve`, `GET /expand`, `GET /areas`.
3. **Log 404 adalah sinyal kuat** — `INFO: "GET /locations/resolve... 404 Not Found"`
   langsung menunjukkan route hilang. Monitor log setelah deploy.
