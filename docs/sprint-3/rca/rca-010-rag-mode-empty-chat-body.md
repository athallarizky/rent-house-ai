# RCA-010 — RAG Mode Chat Body Kosong / Minim

> **Tanggal:** 2026-06-20
> **Sprint:** 3 — Phase 8 (Workflow Fixes) + Phase 9 (AI Chat Toggle)
> **Severity:** Medium (UX — chat body tidak informatif di mode Cepat)
> **Layanan terdampak:** Web frontend `ChatInterface.tsx`
> **Status:** ✅ Resolved

---

## 1. Ringkasan

Di mode **Cepat** (RAG), chat response hanya menampilkan teks:

```
Menampilkan 10 kos di Cengkareng yang relevan dengan "kos di cengkareng".
```

Tidak ada konten bermakna di chat body — user harus melihat ke right panel untuk
melihat hasil. Ini membuat mode Cepat terasa "buggy" karena chat response-nya
hampa.

---

## 2. Gejala

1. User memilih mode **Cepat** di dropdown input chat
2. User mengirim query, misalnya `"kos di cengkareng"`
3. Chat menampilkan respons: `"Menampilkan 10 kos di Cengkareng yang relevan..."` 
4. **Chat body kosong** — tidak ada daftar kos, tidak ada rating, tidak ada harga
5. User harus beralih ke right panel untuk melihat hasil aktual
6. User mengira ini bug karena chat tidak menampilkan data apapun

---

## 3. Root Cause

**Response formatter RAG mode terlalu minimal — hanya menghitung jumlah hasil.**

### Alur:

1. Phase 9 menambahkan mode selector (AI / Cepat) ke `ChatInterface.tsx`
2. Di `queryDataset()`, handler event `done` mengecek mode:
   ```typescript
   if (chatMode === "rag") {
     collected = `Menampilkan ${relItems.length} kos di ${district} yang relevan dengan "${query}".`;
   }
   ```
3. `collected` disimpan sebagai chat message — hanya teks count, tanpa detail
4. Detail kos (nama, rating, fasilitas, harga) hanya tersedia di `relItems` (array
   `KosResult`) yang ditampilkan di right panel via `KosCardList`
5. **Chat window tidak menampilkan data apapun** — kontras dengan mode AI yang
   menghasilkan ringkasan LLM kaya informasi

### Kenapa format minimal dipilih?

Asumsi awal: di mode Cepat, user hanya butuh right panel — chat hanya
konfirmasi bahwa pencarian berhasil. Tapi ekspektasi user: chat harus tetap
berguna meskipun tanpa LLM.

---

## 4. Perbaikan

Format ulang response RAG mode menjadi **daftar markdown** yang mencakup detail
hasil pencarian dari `relItems`:

```typescript
if (chatMode === "rag" && relItems.length > 0) {
  const lines = [
    `Menampilkan **${relItems.length} kos** di ${district} yang relevan...`,
    "",
  ];
  for (let i = 0; i < Math.min(relItems.length, 10); i++) {
    const r = relItems[i];
    const stars = r.rating.toFixed(1);
    const tags = (r.tags || []).slice(0, 4).join(", ");
    const price = r.price_max != null
      ? `Rp${(r.price_min / 1_000_000).toFixed(1)}jt`
      : "";
    lines.push(`${i + 1}. **${r.name}** — ${stars}★ ${price} — ${tags}`);
  }
  collected = lines.join("\n");
}
```

Hasil di chat:

```
Menampilkan **10 kos** di Cengkareng yang relevan dengan "kos di cengkareng":

1. **Kost ABC** — 4.5★ · Rp1.5jt — wifi, AC, parkir
2. **Kost XYZ** — 4.2★ · Rp800rb — wifi, kamar mandi dalam
...
```

**Kasus kosong:**
```typescript
else if (chatMode === "rag") {
  collected = `Tidak ada kos di ${district} yang cocok...`;
}
```

---

## 5. Verifikasi

| Check | Result |
|-------|--------|
| `npm run check` | 0/0/0 |
| `npm run build` | 3 pages |
| Mode Cepat: query valid | Daftar 10 kos dengan nama, rating, harga, tags |
| Mode Cepat: query tanpa hasil | Pesan "Tidak ada kos yang cocok..." |
| Mode AI: tidak terdampak | LLM streaming tetap berfungsi seperti sebelumnya |
| Right panel tidak terdampak | `KosCardList` tetap menampilkan dataset + relevance |

---

## 6. Action Items

- [x] Format ulang response RAG mode dengan data dari `relItems`
- [x] Tangani edge case: 0 hasil → pesan informatif
- [x] Null safety untuk `price_min`/`price_max`
- [ ] **Future:** Pertimbangkan menambahkan opsi "Tampilkan sebagai list" di
  mode Cepat untuk toggle antara format ringkas vs lengkap.

---

## 7. Pelajaran

1. **Mode "tanpa AI" bukan berarti "tanpa konten"** — user tetap mengharapkan
   informasi berguna di chat, meskipun tanpa LLM. Data dari RAG search sudah
   cukup kaya untuk diformat secara manual.
2. **Chat body harus mandiri** — jangan bergantung pada right panel untuk
   mengkomunikasikan hasil. User mungkin menutup right panel (mobile) atau
   fokus ke chat.
3. **Markdown di chat window** sudah didukung via `ReactMarkdown` — formatting
   daftar, bold, italic langsung dirender tanpa LLM.
