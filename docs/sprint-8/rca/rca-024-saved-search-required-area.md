# RCA-024 — Save search gagal 422 saat area kosong (broad-region/POI query)

> **Tanggal:** 2026-06-20
> **Sprint:** 8 — testing E2E
> **Severity:** Low (history tidak tersimpan untuk search region luas; tidak memblokir fungsi utama)
> **Layanan terdampak:** `POST /searches` (saved search history)
> **Status:** ✅ Resolved

## 1. Ringkasan

Setelah search broad-region (`"kos di maluku"`), frontend mencoba simpan ke
history via `POST /searches` **tanpa field `area`** → backend 422
`"Field required"` → search tidak tersimpan.

## 2. Gejala

```
POST /searches {"id":"...","query_text":"kos di maluku","result_count":0,"created_at":"..."}
→ 422 {"detail":[{"type":"missing","loc":["body","area"],"msg":"Field required"}]}
```
- Search broad-region/POI tidak punya area spesifik (region luas atau POI)
- Frontend kirim payload tanpa `area` → validasi Pydantic reject

## 3. Root Cause

Model `SavedSearch` di `api/src/searches.py`:
```python
class SavedSearch(BaseModel):
    id: Optional[str] = None
    query_text: str
    area: str            # ← REQUIRED (tidak ada default)
    result_count: int = 0
    created_at: Optional[str] = None
```

`area` required, tapi secara semantik search history bisa saja tidak punya area
spesifik — terutama setelah RCA-021/023 menambah region drill-down & POI flow
(query provinsi/POI tidak resolve ke 1 area).

## 4. Perbaikan

Buat `area` opsional dgn default string kosong:

```python
class SavedSearch(BaseModel):
    id: Optional[str] = None
    query_text: str
    area: str = ""       # optional: broad-region/POI search mungkin tidak punya area
    result_count: int = 0
    created_at: Optional[str] = None
```

DB schema `area TEXT NOT NULL` tetap puas (`""` bukan NULL). Insert dgn `""`
valid.

## 5. Verifikasi

| Check | Result |
|-------|--------|
| Sebelum | 422 `"area": Field required` |
| Setelah | HTTP 200, tersimpan dgn `area:""` |

## 6. Action Items

- [x] `SavedSearch.area` → `str = ""` (optional)
- [ ] **Frontend:** idealnya kirim region name (`"Maluku"`) sbg area untuk history
      yg lebih informatif — tapi backend tetap tolerant

## 7. Pelajaran

1. **Model Pydantic harus match realitas data.** Saat produk menambah tipe query
   baru (region/POI), field yg dulu selalu ada (`area`) mungkin jadi opsional.
   Review skema saat flow baru ditambah.
2. **History/log harus tolerant** — tujuannya mencatat, bukan validasi. Field
   wajib di model history membatasi tipe input yg bisa dicatat.
3. **422 silentry genuine** — payload frontend tidak kirim field, validasi
   tolak. Pastikan kontrak frontend-backend sinkron saat model berubah.
