# RCA-017 — passlib 1.7.4 incompatible with bcrypt >= 5.0

> Date: 2026-06-20 | Sprint 4 — Phase 1 | Severity: Medium

---

## Ringkasan

`pip install passlib[bcrypt]` menginstal `bcrypt==5.0.0`, yang tidak kompatibel
dengan `passlib==1.7.4`. Startup API gagal saat `seed_admin()` memanggil
`hash_password()`.

---

## Gejala

1. API gagal startup dengan traceback:
   ```
   (trapped) error reading bcrypt version
   AttributeError: module 'bcrypt' has no attribute '__about__'
   ```
2. Kemudian fallback ke path alternatif yang gagal dengan:
   ```
   ValueError: password cannot be longer than 72 bytes, truncate manually if necessary
   ```
3. Error terjadi di `passlib/handlers/bcrypt.py:620` — `_bcrypt.__about__.__version__`
   tidak ditemukan karena `bcrypt >= 5.0` menghapus atribut `__about__`.

---

## Root Cause

`bcrypt` library mengalami restrukturisasi besar di versi 5.0:
- `bcrypt.__about__` dihapus
- API internal berubah (misalnya deteksi wrap bug)

`passlib 1.7.4` (rilis 2020) tidak menangani perubahan ini karena library
tidak lagi di-maintain secara aktif.

---

## Perbaikan

Pin `bcrypt==4.0.1` di `api/pyproject.toml`:

```toml
"bcrypt==4.0.1",
```

Versi 4.0.1 adalah rilis terakhir sebelum breaking changes 5.0, dan
100% kompatibel dengan `passlib 1.7.4`.

---

## Verifikasi

```bash
pip3 install "bcrypt==4.0.1"
cd api && python3 -m uvicorn src.main:app --port 8080
# → Application startup complete.

curl -s -X POST http://localhost:8080/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@kos.ai","password":"admin123"}'
# → 200 OK with valid JWT
```

---

## Action Items

- [x] Pin `bcrypt==4.0.1` di `api/pyproject.toml`
- [ ] Future: evaluasi migrasi dari `passlib` ke `bcrypt` native API (tanpa passlib wrapper) saat passlib benar-benar deprecated

---

## Pelajaran

- Library kriptografi yang tidak aktif di-maintain bisa menjadi sumber masalah saat dependency transitive di-upgrade.
- Selalu test startup API setelah `pip install` — masalah muncul di runtime (lazy load bcrypt), bukan di AST parse.
- Pin versi dependency untuk library kriptografi adalah praktik yang baik.
