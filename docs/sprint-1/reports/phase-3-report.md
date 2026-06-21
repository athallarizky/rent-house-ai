# Phase 3 Report — Data Processor

> Completed: 2026-06-19

---

## 1. How to Run

All commands from the project root (`rent-house-ai/`).

### Process a Single Area

```bash
cd services/data-processor && python3 -m src.pipeline cengkareng
```

### Output Files

| File | Description | Size (Cengkareng) |
|------|-------------|-------------------|
| `data/cleaned/<area>.json` | Clean entries (full records with reviews) | 344 KB |
| `data/cleaned/<area>_docs.json` | RAG documents (ready for ChromaDB) | 186 KB |

---

## 2. Pipeline Stages

```
data/raw/cengkareng/*.jsonl (5 files, 208 entries)
        │
        ▼
[parse.py]         — JSONL → Python dicts
                     Normalize longitude/longtitude duplication
                     Normalize review casing (PascalCase → text field)
                     Extract review texts
        │
        ▼
[normalize.py]     — Phone → E.164 (+62...)
                     Address → de-anglicize (West → Barat)
                     Names → trim whitespace
        │
        ▼
[enrich.py]        — Match postal_code → kodepos
                     Resolve: kelurahan, kecamatan, regency, province
        │
        ▼
[extract.py]       — Scan ALL review texts for:
                     • Facilities: wifi, ac, parkir, dapur, km_dalam, laundry, tv, kasur, lemari, listrik
                     • Gender: putri, putra, campur
                     • 24h access
                     • Filter noise reviews (<30 chars, questions)
        │
        ▼
[dedup.py]         — Dedup by place_id (primary)
                     Proximity <50m (same-building catch)
                     Merge reviews for merged entries
        │
        ▼
[build_doc.py]     — Construct RAG document text per kos:
                     ## Name
                     Alamat: ...
                     Rating: X/5 dari N reviews
                     Fasilitas: wifi, ac, ...
                     Tipe asrama: putri/putra/campur
                     Review tamu:
                     [5★] text...
                     [1★] text...
        │
        ▼
[validate.py]      — Check: place_id, name, coordinates
                     In-bounds: -11 ≤ lat ≤ 6, 95 ≤ lon ≤ 141
        │
        ▼
data/cleaned/cengkareng.json       (full records)
data/cleaned/cengkareng_docs.json  (RAG documents)
```

---

## 3. Test Results — Cengkareng

| Stage | Count |
|-------|-------|
| Raw entries (5 JSONL files) | 208 |
| After dedup (place_id) | 177 |
| After proximity <50m | **152** |
| Invalid (missing coords) | 0 |

### Facility Distribution (152 kos)

| Facility | Count | % |
|----------|-------|---|
| ac | 29 | 19% |
| wifi | 21 | 14% |
| parkir | 19 | 13% |
| dapur | 14 | 9% |
| kasur | 12 | 8% |
| lemari | 9 | 6% |
| listrik | 9 | 6% |
| kamar_mandi_dalam | 7 | 5% |
| laundry | 7 | 5% |
| tv | 5 | 3% |

### Gender Distribution

| Type | Count |
|------|-------|
| unknown | 129 |
| putri | 14 |
| putra | 6 |
| campur | 4 |

> Note: Most kos don't explicitly mention gender in reviews. Detection relies on review text and kos name.

---

## 4. Service Architecture

```
services/data-processor/
├── src/
│   ├── __init__.py
│   ├── pipeline.py     — orchestrator (main entry)
│   ├── parse.py        — JSONL parser, review normalization
│   ├── normalize.py    — phone E.164, address de-anglicize
│   ├── enrich.py       — kodepos postal_code → area lookup
│   ├── extract.py      — facility/gender/24h detection from reviews
│   ├── dedup.py        — place_id + haversine proximity dedup
│   ├── build_doc.py    — RAG document text builder
│   └── validate.py     — coordinate bounds, required fields
└── pyproject.toml
```

### Key Design Decisions

| Decision | Reason |
|----------|--------|
| Scan REVIEWS not about fields | Reviews contain actual living experience (wifi quality, cleanliness) |
| Filter noise reviews | ~40% of reviews are "ada kamar kosong?" — skip them |
| 50m proximity dedup | Same building, different Google Maps entries. 100m too aggressive for dense urban Cengkareng |
| All reviews preserved in full records | Flexibility for future review-level RAG or analytics |
| Top 20 reviews per RAG doc | 10 worst + 10 best — ensures both positive and negative signals |

---

## 5. RAG Document Format

```json
{
  "doc_id": "ChIJ...",
  "text": "## Kost A\nAlamat: Jl. ...\nRating: 4.5/5 dari 35 reviews\nFasilitas: wifi, ac, parkir\nTipe asrama: campur\n\nReview tamu:\n[5★] Wifi lancar. Kamar nyaman...\n[1★] Listrik sering mati...",
  "metadata": {
    "place_id": "ChIJ...",
    "name": "Kost A",
    "kecamatan": "Cengkareng",
    "kelurahan": "Cengkareng Barat",
    "province": "DKI Jakarta",
    "postal_code": "11730",
    "lat": -6.135,
    "lon": 106.723,
    "rating": 4.5,
    "review_count": 35,
    "tags": "wifi|ac|parkir",
    "gender": "campur",
    "is_24h": false
  }
}
```

---

## 6. Reference Files

| File | Purpose |
|------|---------|
| `services/data-processor/src/pipeline.py` | Full pipeline orchestrator |
| `services/data-processor/src/parse.py` | JSONL parser + longitude normalization |
| `services/data-processor/src/normalize.py` | Phone E.164 + address de-anglicize |
| `services/data-processor/src/enrich.py` | Kodepos postal_code → area |
| `services/data-processor/src/extract.py` | Facility/gender detection from reviews |
| `services/data-processor/src/dedup.py` | Place_id + haversine dedup |
| `services/data-processor/src/build_doc.py` | RAG document text builder |
| `services/data-processor/src/validate.py` | Coordinate validation |
| `data/cleaned/cengkareng.json` | Clean entries (344 KB, 152 kos) |
| `data/cleaned/cengkareng_docs.json` | RAG documents (186 KB, 152 docs) |
