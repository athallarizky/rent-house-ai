# RCA-027 — Pipeline started/queued di-cek di nesting salah → spurious region drill-down + chip loop

> **Tanggal:** 2026-06-20
> **Sprint:** 8 — testing POI + pipeline concurrency
> **Severity:** High (search POI memberikan hasil salah + loop saat klik chip saat pipeline sibuk)
> **Layanan terdampak:** frontend loadDistrict, POI flow, chip picker
> **Status:** ✅ Resolved

## 1. Ringkasan

`"kos sekitar smk telkom jakarta"` → POI benar temu **Cengkareng** (message "📍 SMK Telkom di Cengkareng"), tapi message kedua muncul **"'DKI Jakarta' adalah area luas..."** (province drill-down salah). Klik chip → loop drill-down yg sama.

## 2. Gejala

- POI message 1 benar (📍 SMK Telkom, Cengkareng).
- POI message 2: drill-down DKI Jakarta (provinsi) — tidak expected.
- Klik chip "[Administrasi Jakarta Barat]" → drill-down DKI Jakarta lagi (loop).
- Terjadi saat pipeline lain (Cipondoh) sedang running.

## 3. Root Cause

**Frontend cek `pipeline_started`/`pipeline_queued` di nesting yg salah.**

Backend `/area/load` return:
```json
{"success":false, "pipeline_queued":true, "pipeline":{...state...}}
```
Flag `pipeline_queued`/`pipeline_started` di **top-level**.

Frontend `loadDistrict`:
```ts
const pipelineInfo = res.pipeline;                    // = state dict
if (pipelineInfo?.pipeline_started || pipelineInfo?.pipeline_queued) { ... }
//     ^^^ lihat di dalem res.pipeline — TIDAK ADA (flag ada di top-level)
```
Jadi early-return **tidak pernah fire** utk response queued/started.

**Rantai dampak:**
1. POI temu Cengkareng → `loadDistrict("Cengkareng")`.
2. `loadArea` → `pipeline_queued` (Cipondoh masih running) → response success:False.
3. Early-return tidak fire (nesting salah) → lanjut ke `setDataset(res.dataset=[])`, `setCurrentDistrict(res.district=undefined)`.
4. `queryDataset(initialQ, undefined)` → streamSearch area=undefined.
5. Backend `/search` area=None → `_resolve_query("kos sekitar smk telkom jakarta")` → match alias "jakarta" → **DKI Jakarta province** → region event.
6. Frontend render drill-down DKI Jakarta.
7. Klik chip → `loadDistrict` lagi → pipeline masih sibuk → loop.

## 4. Perbaikan

Cek flag di **top-level**:
```ts
const resFlags = res as { pipeline_started?: boolean; pipeline_queued?: boolean };
if (resFlags.pipeline_started || resFlags.pipeline_queued) {
    // early-return: set context, show "pipeline/queued" message, poll
    return;
}
```
+ pesan dibedakan: queued ("antri di belakang <running>") vs started ("pipeline dimulai").

## 5. Verifikasi

| Check | Result |
|-------|--------|
| pipeline_queued response | early-return (sebelumnya fall-through) ✓ |
| POI "smk telkom" saat pipeline sibuk | "📋 antri di belakang ..." (bukan DKI drill-down) ✓ |
| Klik chip saat sibuk | message queued (bukan loop) ✓ |
| Klik chip saat idle | load district → search ✓ |

## 6. Action Items

- [x] loadDistrict: cek `res.pipeline_started`/`res.pipeline_queued` top-level
- [x] pesan queued vs started dibedakan
- [ ] **Future:** typed response schema (Pydantic model utk /area/load) biar kontrak frontend-backend strict — nesting mismatch ketahuan di compile time

## 7. Pelajaran

1. **Kontrak response shape harus explicit & typed** — flag di top-level vs nested adlh keputusan arbitrary; frontend nebak nesting = bug静静地. Pakai shared type/schema.
2. **Bug concurrency paling susah di-trace** — hanya muncul saat pipeline sibuk (race dgn state lain). Test wajib simulasikan pipeline running.
3. **Cascading fall-through** — satu guard gagal (nesting) → undefined district → fallback resolve → drill-down salah → loop. Satu bug root bikin 3 gejala.
