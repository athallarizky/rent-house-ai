# RCA-032 — Warning suggestion tidak cocok dgn button yg tersedia (Kembangan)

> **Tanggal:** 2026-06-21
> **Sprint:** 9 — Pipeline action dashboard
> **Severity:** Medium (admin melihat saran "Index" tapi tidak ada tombol Index)
> **Layanan terdampak:** PipelineDashboard warning icon + action buttons
> **Status:** ✅ Resolved

## 1. Ringkasan
Kembangan (`scraped ✓, processed ✗, indexed ✓` — inkonsisten, index leftover
tapi docs kosong) → warning ⚠️ bilang "butuh **Index**", tapi tombol **Index
tidak muncul** (syarat `scraped && !indexed` → `indexed=true` → hidden).

## 2. Root Cause
**Warning rules & button conditions tidak aligned:**
- Warning rule: `scraped && !processed` → "needs Index"
- Button Index: `scraped && !indexed`

Kembangan `indexed=true` → button hidden. Tapi `!processed` → warning fires.
Suggestion menunjuk action yg tidak ada.

## 3. Perbaikan
Redesign `warnFor` — setiap suggestion HARUS map ke button yg visible:
- **"needs Index"** hanya fire saat `!indexed` (cocok dgn Index button).
- **State inkonsisten** (`indexed && !processed`, `docs_count===0`,
  `indexed_count===0`) → suggest **Rebuild** (button selalu ada saat scraped).

## 4. Verifikasi
Kembangan sekarang: ⚠️ "Indexed tapi docs hilang (inkonsisten) — butuh
**Rebuild**" + button Rebuild muncul. Konsisten.

## 5. Pelajaran
Suggestion system harus **selalu map ke action yg available**. Test semua
kombinasi state (scraped/processed/indexed × true/false) — verifikasi setiap
suggestion punya button.
