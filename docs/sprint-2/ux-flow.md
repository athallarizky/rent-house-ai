# Sprint 2 — UX Flow & Screen Designs

> Screen-by-screen user journey for the Kos AI Dashboard.

---

## 1. Overall Navigation

```
 ┌─────────┐     ┌──────────┐     ┌──────────┐
 │  Home   │────▶│  Search  │────▶│ Settings │
 │   (/)   │     │(/search) │     │(/settings)
 └─────────┘     └──────────┘     └──────────┘
                       │
                 ┌─────┴─────┐
                 │           │
            ┌────▼───┐ ┌────▼───┐
            │ List   │ │  Map   │
            │  View  │ │  View  │
            └────────┘ └────────┘
```

Persistent sidebar (DashboardLayout) with nav links: Home, Search, Settings.

---

## 2. Screen 1 — Landing Page (`/`)

```
╔══════════════════════════════════════════════════════════════════╗
║  🏠 Kos AI                                          [Settings]  ║
║                                                                ║
║                                                                ║
║                                                                ║
║          Cari kos impianmu dengan bahasa sehari-hari           ║
║                                                                ║
║  ┌──────────────────────────────────────────────────────────┐  ║
║  │  🔍  "kos di Cengkareng wifi kenceng parkir luas"       │  ║
║  │                                              [ 🔍 Cari ] │  ║
║  └──────────────────────────────────────────────────────────┘  ║
║                                                                ║
║  Area populer:                                                 ║
║  [🏙️ Cengkareng] [🏙️ Jakarta Barat] [🏙️ Bandung]               ║
║  [🏙️ Surabaya] [🏙️ Yogyakarta] [🏙️ Tangerang]                 ║
║                                                                ║
║                                                                ║
║  ┌──────────┐  ┌──────────┐  ┌──────────┐                    ║
║  │   152    │  │  1,416  │  │    8     │                    ║
║  │ Kos      │  │ Reviews  │  │  Areas   │                    ║
║  │ tersedia │  │ terindex │  │ scraped  │                    ║
║  └──────────┘  └──────────┘  └──────────┘                    ║
║                                                                ║
╚══════════════════════════════════════════════════════════════════╝
```

**Behavior:**
- Click area chip → `navigate('/search?area=Cengkareng')`
- Type + Enter → `navigate('/search?q=wifi kenceng di Cengkareng')`
- Stats refresh on mount via `GET /health`

---

## 3. Screen 2 — Dashboard 3-Panel (`/search`)

### Initial State (No Query Yet)

```
╔══════════╦══════════════════════════════════╦═══════════════════╗
║ 📋 Saved ║  💬 Kos AI                       ║                     ║
║ Searches ║                                  ║                     ║
║          ║                                  ║   Mulai pencarian   ║
║ ──────── ║          🔍                      ║   untuk melihat     ║
║          ║                                  ║   hasil kos di      ║
║ wifi ken ║   Ketik query atau pilih area    ║   panel ini         ║
║ ceng     ║   untuk memulai pencarian        ║                     ║
║ ──────── ║                                  ║                     ║
║ kos mura ║                                  ║                     ║
║ h        ║  ┌────────────────────────────┐  ║                     ║
║ ──────── ║  │ "cari kos di Cengkareng.." │  ║                     ║
║          ║  │                    [ 🔍 ]   │  ║                     ║
║ [+ New]  ║  └────────────────────────────┘  ║                     ║
║          ║                                  ║                     ║
╚══════════╩══════════════════════════════════╩═══════════════════╝
```

---

### After Query (Results Loaded)

```
╔══════════╦══════════════════════════════════╦═══════════════════╗
║ 📋 Saved ║  💬 Chat                         ║ [📋 List] [🗺️ Map]║
║ Searches ║                                  ╠═══════════════════╣
║          ║ ┌──────────────────────────────┐ ║ ┌───────────────┐ ║
║ ● wifi   ║ │ 🤖 Rekomendasi kos di       │ ║ │ Kost A  4.5★  │ ║
║   kenceng║ │ Cengkareng dengan wifi      │ ║ │ wifi ac parkir │ ║
║          ║ │ kenceng:                    │ ║ │ 📍 1.2 km      │ ║
║ kos mura ║ │                              │ ║ │ ⭐ 35 reviews  │ ║
║ h        ║ │ 1. **Kost A** (4.5★)        │ ║ ├────────────────┤ ║
║          ║ │    wifi lancar 100mbps,     │ ║ │ Kost B  4.2★  │ ║
║ kos putri║ │    parkir luas...           │ ║ │ wifi dapur     │ ║
║          ║ │                              │ ║ │ 📍 2.5 km      │ ║
║          ║ │ 2. **Kost D** (4.2★)        │ ║ │ ⭐ 12 reviews  │ ║
║ [+ New]  ║ │    wifi kencang, AC dingin  │ ║ ├────────────────┤ ║
║          ║ │                              │ ║ │ Kost C  3.9★  │ ║
║          ║ └──────────────────────────────┘ ║ │ wifi ac        │ ║
║          ║                                  ║ │ 📍 0.8 km      │ ║
║          ║ [wifi] [ac] [parkir] [km dlm]    ║ │ ⭐ 8 reviews   │ ║
║          ║                                  ║ └───────────────┘ ║
║          ║ ┌──────────────────────────────┐ ║                     ║
║          ║ │ "yang di bawah 2 juta aja"  │ ║                     ║
║          ║ │                    [ 🔍 ]   │ ║                     ║
║          ║ └──────────────────────────────┘ ║                     ║
╚══════════╩══════════════════════════════════╩═══════════════════╝
```

**Behavior:**
- **Left panel:** Saved searches with active indicator. Click → reload that search. Delete on hover.
- **Center top:** Chat messages. User bubble (right, blue), Assistant bubble (left, gray) with markdown. Streaming token-by-token with blinking cursor.
- **Center bottom:** Filter chips between chat and input. Toggle in-memory, instant results update in right panel.
- **Right panel:** Switchable List/Map. List = vertical scroll of KosCard. Map = Leaflet with draggable pins.

---

### KosCard States

```
Compact (list view):              Expanded (click):
┌──────────────────────┐          ┌──────────────────────┐
│ Kost A         4.5★  │          │ Kost A         4.5★  │
│ Cengkareng Barat     │          │ Cengkareng Barat     │
│ [wifi] [ac] [parkir] │          │ 📞 +6281234567890    │
│ 📍 1.2 km • ⭐ 35     │          │                      │
└──────────────────────┘          │ Fasilitas:           │
                                  │ [wifi] [ac] [parkir]  │
                                  │ [km dalam] [dapur]   │
                                  │                      │
                                  │ 📊 Rating: 4.5/5     │
                                  │ 📝 35 reviews        │
                                  │ 👥 Campur            │
                                  │                      │
                                  │ Review tamu:         │
                                  │ [5★] Wifi lancar,   │
                                  │ kamar nyaman...      │
                                  │ [4★] Lokasi dekat    │
                                  │ jalan raya...        │
                                  │ [1★] Listrik sering  │
                                  │ mati...              │
                                  │                      │
                                  │ 🗺️ [Lihat di Maps]   │
                                  │ 📱 [Hubungi]         │
                                  └──────────────────────┘
```

---

### Map View Toggle

```
╔══════════╦══════════════════════════════════╦═══════════════════╗
║          ║                                  ║ [📋 List] [🗺️ Map]║
║ (same as ║         (same as above)          ╠═══════════════════╣
║  above)  ║                                  ║                     ║
║          ║                                  ║    ┌───────────┐   ║
║          ║                                  ║    │           │   ║
║          ║                                  ║    │ 📍A  📍B  │   ║
║          ║                                  ║    │           │   ║
║          ║                                  ║    │   📍C     │   ║
║          ║                                  ║    │     📍D   │   ║
║          ║                                  ║    │           │   ║
║          ║                                  ║    │   Cengkareng  ║
║          ║                                  ║    │           │   ║
║          ║                                  ║    └───────────┘   ║
║          ║                                  ║                     ║
║          ║                                  ║  Kost A  4.5★      ║
║          ║                                  ║  (selected pin)    ║
║          ║                                  ║  [Lihat detail]    ║
╚══════════╩══════════════════════════════════╩═══════════════════╝
```

**Behavior:**
- Marker clusters for dense areas (50+ kos)
- Click marker → shows popup (name + rating) + highlights card below
- Drag map → doesn't re-query (all markers already loaded)

---

## 2a. Regency → Kecamatan Picker (In-Chat)

When user queries a regency-level area (Jakarta Barat, Bandung, Surabaya) instead of a specific kecamatan, the AI responds with a picker instead of search results.

### User Queries Regency

```
╔══════════╦══════════════════════════════════╦═══════════════════╗
║          ║  💬 Chat                         ║                     ║
║          ║                                  ║                     ║
║          ║ ┌────────────────────────────┐   ║                     ║
║          ║ │ 👤 kos di Jakarta Barat    │   ║                     ║
║          ║ │    wifi kenceng            │   ║                     ║
║          ║ └────────────────────────────┘   ║                     ║
║          ║                                  ║                     ║
║          ║ ┌────────────────────────────┐   ║      Pilih dulu    ║
║          ║ │                            │   ║      kecamatan     ║
║          ║ │ 🤖 Jakarta Barat memiliki  │   ║      di Jakarta    ║
║          ║ │ 8 kecamatan. Pilih salah   │   ║      Barat dulu    ║
║          ║ │ satu:                      │   ║                     ║
║          ║ │                            │   ║                     ║
║          ║ │ ┌──────────────────────┐   │   ║                     ║
║          ║ │ │ 🏙️ Cengkareng        │   │   ║                     ║
║          ║ │ │    5 kode pos        │   │   ║                     ║
║          ║ │ └──────────────────────┘   │   ║                     ║
║          ║ │ ┌──────────────────────┐   │   ║                     ║
║          ║ │ │ 🏙️ Grogol Petamburan │   │   ║                     ║
║          ║ │ │    4 kode pos        │   │   ║                     ║
║          ║ │ └──────────────────────┘   │   ║                     ║
║          ║ │ ┌──────────────────────┐   │   ║                     ║
║          ║ │ │ 🏙️ Kalideres         │   │   ║                     ║
║          ║ │ │    5 kode pos        │   │   ║                     ║
║          ║ │ └──────────────────────┘   │   ║                     ║
║          ║ │ ... (scroll)               │   ║                     ║
║          ║ │                            │   ║                     ║
║          ║ │ Atau: [🔍 Cari di SEMUA]   │   ║                     ║
║          ║ └────────────────────────────┘   ║                     ║
║          ║                                  ║                     ║
║          ║ ┌────────────────────────────┐   ║                     ║
║          ║ │ "atau ketik nama kecamatan"│   ║                     ║
║          ║ └────────────────────────────┘   ║                     ║
╚══════════╩══════════════════════════════════╩═══════════════════╝
```

### User Clicks Kecamatan → Search Proceeds

```
╔══════════╦══════════════════════════════════╦═══════════════════╗
║          ║  💬 Chat                         ║ [📋 List]         ║
║          ║                                  ╠═══════════════════╣
║          ║ ┌────────────────────────────┐   ║ ┌───────────────┐ ║
║          ║ │ 👤 kos di Jakarta Barat    │   ║ │ Kost A  4.5★  │ ║
║          ║ │    wifi kenceng            │   ║ │ wifi ac parkir │ ║
║          ║ └────────────────────────────┘   ║ └───────────────┘ ║
║          ║ ┌────────────────────────────┐   ║ ┌───────────────┐ ║
║          ║ │ 👤 [Cengkareng]             │   ║ │ Kost B  4.2★  │ ║
║          ║ │   (user clicked chip)      │   ║ │ wifi dapur     │ ║
║          ║ └────────────────────────────┘   ║ └───────────────┘ ║
║          ║ ┌────────────────────────────┐   ║ ┌───────────────┐ ║
║          ║ │ 🤖 Mencari kos di          │   ║ │ Kost C  3.9★  │ ║
║          ║ │ Cengkareng dengan wifi     │   ║ │ wifi ac        │ ║
║          ║ │ kenceng...                 │   ║ └───────────────┘ ║
║          ║ │                            │   ║                     ║
║          ║ │ 1. Kost A (4.5★) — wifi    │   ║                     ║
║          ║ │    lancar, parkir luas...  │   ║                     ║
║          ║ │ ...                        │   ║                     ║
║          ║ └────────────────────────────┘   ║                     ║
╚══════════╩══════════════════════════════════╩═══════════════════╝
```

**Behavior:**
- AI message shows regency + kecamatan list fetched from `GET /locations/expand?q=...`
- Each kecamatan chip: name + postal code count
- Click chip → inserts as user message, re-runs search with area=selected kecamatan
- "Cari di SEMUA" option: auto-grid-expand, scrape all kecamatan (power user, slower)
- User can also free-type in MessageInput: "Cengkareng" → triggers same flow
- Picker message is NOT saved to history — only the final search is saved

---

## 4. Screen 3 — Settings (`/settings`)

```
╔══════════════════════════════════════════════════════════════════╗
║  ⚙️ Settings                                                     ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │  🤖 LLM Provider                                           │  ║
║  │                                                            │  ║
║  │  Provider  [Z.AI ▼]                                        │  ║
║  │  Model     [glm-air ▼]                                     │  ║
║  │             glm-4.7                                         │  ║
║  │             glm-5.1                                         │  ║
║  │  API Key   [••••••••••••••••••]    [🔍 Test Connection]     │  ║
║  │                                                            │  ║
║  │  Base URL  https://api.z.ai/api/paas/v4/                   │  ║
║  └────────────────────────────────────────────────────────────┘  ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │  💾 Data                                                    │  ║
║  │                                                            │  ║
║  │  ChromaDB path    data/chroma_db/          152 documents   │  ║
║  │  Raw data         data/raw/cengkareng/     5 JSONL files   │  ║
║  │  Cleaned data     data/cleaned/            2 JSON files    │  ║
║  └────────────────────────────────────────────────────────────┘  ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```

**Behavior:**
- "Test Connection" → calls Z.AI with "hi" → shows ✅ Connected or ❌ Failed
- Settings saved to server via `PUT /api/settings`
- Data paths are read-only display

---

## 5. Mobile / Responsive

```
Desktop (3 panels):           Mobile (single panel, swipe):
┌───┬──────────┬───┐          ┌─────────────────────┐
│ L │  Center  │ R │          │ [☰] Kos AI   [◫]    │
│   │          │   │          │                     │
│   │          │   │          │  Current Panel      │
│   │          │   │          │  (swipe to switch)  │
│   │          │   │          │                     │
│   │          │   │          │  ◄ L | C | R ►      │
└───┴──────────┴───┘          └─────────────────────┘
```

- Hamburger (☰) opens left panel as drawer
- Map toggle (◫) opens right panel as drawer
- Swipe gesture to switch panels (optional)
- Filter chips scroll horizontally
- KosCard stack vertically, full width

---

## 6. Interaction Flow (Complete)

```
1. Landing Page
   - User types "kos di Cengkareng wifi kenceng"
   - Clicks search or hits Enter

2. Navigate to /search
   - Left panel: empty or shows "wifi kenceng" saved
   - Center: loading skeleton "Mencari kos di Cengkareng..."
   
3. Pipeline Progress (SSE)
   - "🔍 Resolving area Cengkareng..."
   - "📦 Loading 5 cached data files..."
   - "🔎 Searching 152 kos..."
   
4. LLM Starts Streaming
   - Token-by-token appears in chat bubble
   - "Berikut rekomendasi kos di Cengkareng dengan wifi kenceng:"
   
5. Results Populate
   - Right panel fills with KosCard list
   - Filter chips appear between chat and input
   
6. User Interacts
   - Clicks [parkir] filter → list filters in-memory
   - Clicks Kost A card → expands to full detail
   - Toggles map → sees all kos on Leaflet
   - Types follow-up: "yang di bawah 2 juta" → new search
   
7. Session Saved
   - Search auto-saved to left panel
   - Next visit: click saved search → re-run
```
