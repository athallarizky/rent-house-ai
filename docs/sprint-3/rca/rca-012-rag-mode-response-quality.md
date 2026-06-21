# RCA-012 — RAG Mode Response Quality (Score Filtering + Area Detection)

> **Tanggal:** 2026-06-20
> **Sprint:** 3 — Phase 8 (Workflow Fixes) + Phase 9 (AI Chat Toggle)
> **Severity:** Medium (UX — chat body generik, area detection lemah di mode Cepat)
> **Layanan terdampak:** Web frontend `ChatInterface.tsx`
> **Status:** ✅ Resolved

---

## 1. Ringkasan

Mode **Cepat** (RAG) memiliki dua masalah kualitas response:

1. **Response selalu sama:** query apapun menampilkan daftar 10 kos top-rated
   tanpa memfilter berdasarkan relevance score. "listrik" vs "parkiran"
   menghasilkan daftar yang hampir identik.
2. **Area detection mati:** setelah "Pencarian Baru" (no district loaded),
   query seperti "kos sekitaran stasiun poris" selalu fallback ke Cengkareng
   karena LLM intent extraction di-skip di mode Cepat.

---

## 2. Gejala

### Masalah 1 — Response generik

```
user: listrik
bot:  Menampilkan 10 kos — ... (mayoritas TIDAK punya tag "listrik")

user: kos dengan parkiran
bot:  Menampilkan 10 kos — ... (mayoritas TIDAK punya tag "parkir")
```

Kos yang tidak relevan ditampilkan karena tidak ada filter score.

### Masalah 2 — Area detection

```
(Pencarian Baru → no district)
user: kos sekitaran stasiun poris
bot:  Menampilkan 10 kos di Cengkareng... (seharusnya Tangerang/Poris)
```

Area selalu Cengkareng karena:
- LLM intent di-skip (mode Cepat)
- `extractArea()` regex tidak punya "poris" dalam daftar
- `currentDistrict` null → fallback ke `DEFAULT_AREA = "Cengkareng"`

---

## 3. Root Cause

### RC-1: Tidak ada filter relevance score

```typescript
if (chatMode === "rag" && relItems.length > 0) {
    const lines = [ ... header ... ];
    for (let i = 0; i < Math.min(relItems.length, 10); i++) {
        // ↑ selalu ambil 10 item pertama tanpa filter score
        const r = relItems[i];
        lines.push(`${i + 1}. **${r.name}** — ...`);
    }
}
```

`relItems` dari backend sudah di-sort, tapi ada dua kategori item:
- Item dengan `score > 0` → benar-benar match secara semantik
- Item dengan `score = 0` → disertakan sebagai top-rated tapi tidak match query

Tanpa filter score, user melihat kos top-rated yang tidak relevan dengan query.

### RC-2: LLM intent di-skip di semua skenario

```typescript
if (chatMode === "ai") {
    // extractIntent() dipanggil
}
// RAG mode: intentArea tetap null
```

Ini benar untuk **refinement queries** (district sudah loaded) — tidak perlu LLM.
Tapi salah untuk **initial queries** (district belum loaded) — butuh LLM untuk
mendeteksi area dari natural language.

---

## 4. Perbaikan

### Fix 1 — Filter by relevance score

```typescript
if (chatMode === "rag" && relItems.length > 0) {
    const relevant = relItems.filter((r) => (r.score || 0) > 0);
    const shown = relevant.length > 0 ? relevant : relItems.slice(0, 5);
    const lines = [
        relevant.length > 0
            ? `Menampilkan **${shown.length} kos** yang cocok...`
            : `Tidak ada kos yang persis cocok... Menampilkan **${shown.length} kos** teratas:`,
    ];
}

### Fix 2 — Conditional LLM intent in RAG mode

```typescript
if (chatMode === "ai" || !currentDistrict) {
    // Extract intent when: AI mode, OR RAG mode with no district loaded
    const intent = await extractIntent(text);
    intentArea = intent.area;
}
// Filters only pre-fill in AI mode
if (chatMode === "ai" && (intentTags.length > 0 || intentGender)) {
    setFilters(...)
}
```

---

## 5. Verifikasi

| Check | Result |
|-------|--------|
| `npm run check` | 0/0/0 |
| `npm run build` | 3 pages |
| Query "listrik" → hanya tampil kos dgn tag listrik | Hanya 2 hasil (yang benar-benar punya listrik) |
| Query "parkiran" → hanya tampil kos dgn tag parkir | Hanya hasil dengan fasilitas parkir |
| Fallback: query tanpa match → top 5 teratas | "Tidak ada yang persis cocok... 5 kos teratas" |
| "Pencarian Baru" + "stasiun poris" → LLM intent detect Tangerang | Area terdeteksi, tidak default ke Cengkareng |
| Refinement di district sama → tidak panggil LLM | Tanpa penalti latency di mode Cepat |

---

## 6. Action Items

- [x] Filter `relItems` by score > 0 sebelum display di RAG mode
- [x] Fallback: 5 top-rated kos jika tidak ada match persis
- [x] RAG mode: panggil `extractIntent()` saat `!currentDistrict`
- [x] Filter tags/gender hanya pre-fill di AI mode
- [ ] **Future:** Pertimbangkan menyimpan `intentArea` di state agar RAG refinement
  berikutnya tidak perlu panggil LLM lagi (jika area sudah diketahui)

---

## 7. Pelajaran

1. **"Cepat" bukan berarti "bodoh"** — mode RAG harus tetap bisa mendeteksi area
   untuk initial queries. LLM intent extraction (~500ms) adalah harga yang pantas
   untuk akurasi area detection.
2. **Relevance score penting** — jangan asumsikan semua hasil di RAG search adalah
   relevan. Backend mengembalikan campuran hasil match + top-rated sebagai fallback.
   Frontend harus memfilter di sisi display.
3. **Konteks menentukan behaviour** — mode yang sama (Cepat) bisa punya behaviour
   berbeda tergantung state (district loaded vs tidak). Hindari rule "selalu" atau
   "tidak pernah" — gunakan "tergantung" dengan kondisi yang jelas.
