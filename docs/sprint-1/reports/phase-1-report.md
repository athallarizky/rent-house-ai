# Phase 1 Report — Geo-Router Service

> Completed: 2026-06-19

---

## 1. How to Run

All commands from the project root (`rent-house-ai/`).

### Start the Server

```bash
cd services/geo-router
npm install       # first time only
npm run dev       # starts on http://localhost:3001
```

Or from project root:

```bash
cd services/geo-router && npm run dev
```

### Test Endpoints

```bash
# Resolve a regency (returns ALL kecamatan)
curl "http://localhost:3001/resolve?q=Jakarta+Barat"

# Resolve a district (returns single kecamatan with postal codes)
curl "http://localhost:3001/resolve?q=Cengkareng"

# Resolve using alias
curl "http://localhost:3001/resolve?q=jakbar"

# Resolve any regency in Indonesia
curl "http://localhost:3001/resolve?q=Bandung"
curl "http://localhost:3001/resolve?q=Surabaya"
curl "http://localhost:3001/resolve?q=Yogyakarta"

# Expand regency → list of kecamatan names only
curl "http://localhost:3001/expand?q=Jakarta+Barat"
curl "http://localhost:3001/expand?q=Bandung"

# POI detection
curl "http://localhost:3001/resolve?q=Stasiun+Duri"

# Health check
curl "http://localhost:3001/health"
```

### Run Tests

```bash
cd services/geo-router && npm test
# Output: 14 tests, 3 suites, 0 failures
```

---

## 2. API Reference

### `GET /resolve?q=<query>`

Resolves a location name to structured geo data.

**Response (Regency-level):**
```json
{
  "success": true,
  "data": {
    "type": "AREA",
    "query": "Jakarta Barat",
    "matchedAs": "Administrasi Jakarta Barat",
    "province": "DKI Jakarta",
    "regency": "Administrasi Jakarta Barat",
    "districts": [
      {
        "name": "Cengkareng",
        "postalCodes": [11710, 11720, 11730, 11740, 11750],
        "villages": [
          { "name": "Cengkareng Barat", "code": 11730, "lat": -6.135, "lon": 106.723 }
        ]
      }
    ]
  }
}
```

**Response (District-level):**
```json
{
  "success": true,
  "data": {
    "type": "AREA",
    "query": "Cengkareng",
    "matchedAs": "Cengkareng",
    "province": "DKI Jakarta",
    "regency": "Administrasi Jakarta Barat",
    "districts": [
      {
        "name": "Cengkareng",
        "postalCodes": [11710, 11720, 11730, 11740, 11750],
        "villages": [
          { "name": "Cengkareng Barat", "code": 11730, "lat": -6.135, "lon": 106.723 },
          { "name": "Cengkareng Timur", "code": 11730, "lat": -6.144, "lon": 106.739 },
          { "name": "Duri Kosambi", "code": 11750, "lat": -6.175, "lon": 106.717 },
          { "name": "Kapuk", "code": 11720, "lat": -6.143, "lon": 106.752 },
          { "name": "Kedaung Kali Angke", "code": 11710, "lat": -6.150, "lon": 106.759 },
          { "name": "Rawa Buaya", "code": 11740, "lat": -6.168, "lon": 106.738 }
        ]
      }
    ]
  }
}
```

**Response (POI):**
```json
{
  "success": true,
  "data": {
    "type": "POI",
    "query": "Stasiun Duri"
  }
}
```

**Response (Not Found):**
```json
{
  "success": false,
  "error": "Location not found: \"...\""
}
```

### `GET /expand?q=<regency>`

Returns kecamatan names for a regency.

```json
{
  "success": true,
  "data": {
    "regency": "Administrasi Jakarta Barat",
    "province": "DKI Jakarta",
    "districts": [
      "Cengkareng",
      "Grogol Petamburan",
      "Kalideres",
      "Kebon Jeruk",
      "Kembangan",
      "Pal Merah",
      "Taman Sari",
      "Tambora"
    ]
  }
}
```

---

## 3. Service Architecture

```
                   ┌─────────────────────────────────┐
                   │         src/server.ts             │
                   │  Fastify HTTP server (port 3001)  │
                   │  83,761 entries loaded at startup │
                   │  Fuse.js index built in memory    │
                   └──────────────┬──────────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
┌────────▼─────────┐  ┌───────────▼──────────┐  ┌─────────▼──────────┐
│   src/resolve.ts  │  │   src/expand.ts      │  │  src/classify.ts   │
│  Area → postal    │  │  Regency → list of   │  │  AREA vs POI       │
│  codes + villages │  │  kecamatan names     │  │  (stasiun, mall,   │
│  Auto-detects     │  │                      │  │   universitas...)  │
│  regency vs       │  │                      │  │                    │
│  district level   │  │                      │  │                    │
└───────────────────┘  └──────────────────────┘  └────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  src/alias.ts                                                │
│  "Jakarta Barat" → "Administrasi Jakarta Barat"              │
│  "jakbar" → "Administrasi Jakarta Barat"                     │
│  "jaksel" → "Administrasi Jakarta Selatan"                   │
│  "jaktim" → "Administrasi Jakarta Timur"                     │
│  "jakpus" → "Administrasi Jakarta Pusat"                     │
│  "jakut"  → "Administrasi Jakarta Utara"                     │
│  "Kepulauan Seribu" → "Administrasi Kepulauan Seribu"        │
└─────────────────────────────────────────────────────────────┘
```

### Regency vs District Detection Logic

```
Input query
  │
  ├── Alias match? (jakbar, etc.) → REGENCY level
  ├── Exact regency name match? → REGENCY level
  ├── Fuse search → analyze result distribution
  │     ├── regency entries > district entries × 1.5 → REGENCY level
  │     └── otherwise → DISTRICT level
  └── POI word detected? → POI response
```

### Fuse.js Configuration

| Parameter | Value | Reason |
|-----------|-------|--------|
| `keys` | `searchText` (0.6), `fulltext` (0.4) | `searchText` prioritizes regency/district/village/province in order |
| `threshold` | 0.3 | Balance between fuzzy matching and precision (kodepos uses 0.1) |
| `ignoreLocation` | true | Match anywhere in the search text |
| `useExtendedSearch` | false | Plain fuzzy — the `'` prefix approach from kodepos is too strict for area names |

### Data Loading

- Reads `kodepos/data/kodepos.json` (15.7 MB, 83,761 entries) at startup
- Builds `fulltext` (20 pairwise key combinations per entry) + `searchText` (concatenated: regency district village province code)
- Creates Fuse.js index in memory (~2s startup)
- No database or cache needed

---

## 4. Test Coverage

```
▶ alias                          5/5 passing
  ✔ maps Jakarta Barat to Administrative name
  ✔ maps jakbar to Administrative name
  ✔ maps jaksel
  ✔ passes through unknown names
  ✔ normalizes lowercase administrasi

▶ classify                       5/5 passing
  ✔ detects stasiun as POI
  ✔ detects mall as POI
  ✔ detects universitas as POI
  ✔ does not detect city name as POI
  ✔ does not detect Jakarta as POI

▶ expand                         4/4 passing
  ✔ returns all districts for a regency
  ✔ returns districts for Bandung
  ✔ returns null for unknown regency
  ✔ case insensitive match
```

---

## 5. Know Issues & Limitations

| Issue | Impact | Mitigation |
|-------|--------|-----------|
| "Bandung" regency and "Bandung" village disambiguation | Fuse.js can't distinguish | Pre-computed `regencyNames` set for exact match |
| Jakarta aliases must be lowercase in alias table | "JAKARTA BARAT" works, "JaKaRtA bArAt" works | `toLowerCase()` in alias lookup |
| No spatial index for `/detect` (not implemented) | N/A for Phase 1 | kodepos `/detect` can be used if needed later |
| Startup takes ~2s for 83K entries | Acceptable for local | Can serialize Fuse index to disk for production |
| No kota/kabupaten prefix detection | "Kota Bandung" resolved as district | Added "kota" prefix to regency detection regex |
| Postal codes in complete_address sometimes empty (10%) | Scraper data gap | Fallback to lat/lon → kodepos detect in Phase 3 |

---

## 6. Reference Files

| File | Purpose |
|------|---------|
| `services/geo-router/src/server.ts` | Fastify HTTP server entry point |
| `services/geo-router/src/resolve.ts` | Core resolve logic (alias → regency/district detection → result builder) |
| `services/geo-router/src/expand.ts` | Regency → kecamatan list expander |
| `services/geo-router/src/alias.ts` | Colloquial → administrative name mappings |
| `services/geo-router/src/classify.ts` | AREA vs POI classifier |
| `services/geo-router/src/types.ts` | TypeScript type definitions |
| `services/geo-router/src/geo-router.test.ts` | 14 unit tests |
| `services/geo-router/kodepos/data/kodepos.json` | Source data (83,761 Indonesian locations) |
