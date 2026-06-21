# RCA-033 — POI radius search tidak terlihat oleh user (count sama di wide radius)

> **Tanggal:** 2026-06-21
> **Sprint:** 9 — POI radius search testing
> **Severity:** Medium (user pikir radius tidak dihitung padahal sebenarnya jalan)
> **Layanan terdampak:** ChatInterface POI flow, user perception
> **Status:** ✅ Resolved

## 1. Ringkasan
POI radius search (5km) **sudah dihitung** di backend (filter + proximity rank),
tapi user **tidak bisa lihat efeknya** — count hasil sama dgn non-radius krn di
5km semua kos district termasuk. Hanya ranking proximity yg berubah (tidak
obvious secara visual).

## 2. Gejala
- "kos sekitar smk telkom jakarta" → hasil muncul cepat, count sama (~5-10).
- User: "seharusnya hitung radius 5km" (pikir ga dihitung).
- Backend log: RADIUS query tercatat → geo DITERIMA, filter+rank jalan.

## 3. Root Cause
**Bukan bug algoritma — bug komunikasi UX.** Radius 5km di area padat (Cengkareng
~5km across) → semua kos within radius → filter removes 0 → count identical.
Ranking proximity berubah (closest first) tapi user tidak bisa distinguish order
change dari count. Tidak ada indikator visual radius aktif.

## 4. Perbaikan
Buat radius EKSPLISIT di chat:
- POI message: "Mencari kos **dalam radius 5km** dari lokasi ini…"
- Result message: "**Dalam radius 5km dari {landmark}** — menampilkan N kos
  terdekat"
- Backend log: `[/search] RADIUS query: area=... lat=... lon=... radius_km=...`
  (diagnostic utk verifikasi)
- `geoLabel` (landmark name) di-thread POI→loadDistrict→queryDataset→message.

## 5. Pelajaran
**"Sudah benar tapi tidak terlihat" = setara dgn "tidak bekerja" dari user POV.**
Feature yg berjalan diam-diam butuh explicit feedback (message, indicator). Radius
search wajib tampilkan context (radius value + landmark name) biar user tau itu
active.
