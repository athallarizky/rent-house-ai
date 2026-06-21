# RCA-025 — Broad-region drill-down message tidak muncul (streaming SSE contract)

> **Tanggal:** 2026-06-20
> **Sprint:** 8 — testing E2E broad-region (lanjutan RCA-021)
> **Severity:** Medium (region drill-down tidak tampil di chat; user tidak tahu area luas perlu dipilih sub-area)
> **Layanan terdampak:** `POST /search` (stream:true), frontend ChatInterface
> **Status:** ✅ Resolved

## 1. Ringkasan

Query region luas (`"Aceh Jaya"`, stream:true) mengembalikan response broad_region
yg benar di backend, tapi **message-nya tidak muncul di chat**. User melihat
kosong/tidak ada respons.

## 2. Gejala

- `POST /search {"query":"Aceh Jaya","stream":true}` → backend return JSON
  `{success:false, broad_region:true, region:"Aceh Jaya", regions:[...]}` dgn
  `Content-Type: application/json`.
- Frontend `streamSearch` hanya parse baris yg diawali `data:` (SSE) → JSON plain
  **di-skip semua** → tidak ada event → chat kosong.
- Non-stream (stream:false) → JSON langsung, frontend handle biasa → muncul.

## 3. Root Cause

**Mismatch streaming contract.** broad_region di-return **sebelum** branching
streaming di handler `/search`. Jadi walau `stream:true`, response-nya plain
JSON, bukan SSE. Frontend SSE reader (`streamSearch`, api.ts) implementasi:

```ts
for (const line of lines) {
  if (!trimmed.startsWith("data:")) continue;   // ← JSON plain di-skip
  ...
}
```

JSON plain tidak punya prefix `data:` → semua di-skip → tidak ada event yield.

## 4. Perbaikan

**Backend:** saat broad_region DAN `stream:true`, emit SSE event:

```python
if req.stream:
    return StreamingResponse(_region_response(region, message), media_type="text/event-stream")

async def _region_response(region, message):
    yield _sse({"type":"region", "region_type":..., "region":..., "regions":..., "message":...})
    yield _sse({"type":"done"})
```

**Frontend:** handle event `region` di `queryDataset` stream loop → render
`isPicker` + chips (reuse pattern KecamatanPicker) + `setPendingArea`. Klik chip
→ `loadDistrict(name, region)` re-search.

## 5. Verifikasi

| Check | Result |
|-------|--------|
| stream:true Content-Type | `text/event-stream` (sebelumnya application/json) |
| stream:true body | `data: {"type":"region",...}` + `data: {"type":"done"}` |
| Frontend chat | message + chips sub-area muncul ✓ |
| Non-stream | tetap JSON ✓ (regresi aman) |

## 6. Action Items

- [x] Backend: SSE `_region_response` saat stream:true
- [x] Frontend: handle event `region` (picker chips)
- [ ] **Future:** front-end test utk kontrak SSE (pastikan semua response stream:true berformat SSE)

## 7. Pelajaran

1. **Endpoint yg support streaming HARUS return SSE utk SEMUA path saat stream:true** — termasuk early-return (error, region, pipeline_started). Plain JSON di stream reader = silent drop.
2. **Kontrak Content-Type mengikat** — frontend SSE reader validasi prefix `data:`; backend harus konsisten emit format itu atau response hilang tanpa error.
3. **Bug "tidak muncul tanpa error" paling insidious** — ga ada exception, ga ada log, cuma response konsumen drop. Test end-to-end (bukan cuma backend) wajib.
