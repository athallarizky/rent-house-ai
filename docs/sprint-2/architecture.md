# Sprint 2 — Architecture

> Tech stack, component tree, and design decisions for the Dashboard UI.

---

## 1. Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Framework** | Astro 6 (SSR) | Same as slack-rag, island architecture for minimal JS |
| **UI** | React 19 islands | Same as slack-rag, reuses patterns |
| **Styling** | Tailwind CSS 4 + shadcn tokens | Same as slack-rag, consistent look |
| **Map** | Leaflet + OpenStreetMap | Free, no API key, pins from lat/lon |
| **Markdown** | react-markdown + remark-gfm | LLM responses rendered as markdown |
| **Icons** | lucide-react | Same as slack-rag |
| **Streaming** | SSE (Server-Sent Events) | Same as slack-rag, token-by-token |

### Why Astro + React (Not SPA)

- Astro SSR sends zero JS for static content (landing page, settings)
- React islands only hydrate interactive components (chat, search)
- Lower RAM than Next.js — no full client-side router
- Same stack as slack-rag — faster to clone patterns

---

## 2. Project Structure

```
rent-house-ai/
└── web/                              # NEW
    ├── astro.config.mjs
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── layouts/
    │   │   └── DashboardLayout.astro  # Sidebar + content slot
    │   ├── pages/
    │   │   ├── index.astro            # Landing page (/)
    │   │   ├── search.astro           # Dashboard (/search)
    │   │   └── settings.astro         # Settings (/settings)
    │   ├── components/
    │   │   ├── ChatInterface.tsx       # Root orchestrator (state owner)
    │   │   ├── ChatWindow.tsx          # Message list + streaming bubble
    │   │   ├── MessageInput.tsx        # Text input + send
    │   │   ├── SavedSearches.tsx       # Left panel sidebar
    │   │   ├── KosCardList.tsx         # Right panel kos list
    │   │   ├── KosCard.tsx             # Individual kos card
    │   │   ├── KosDetail.tsx           # Expanded kos detail
    │   │   ├── MapView.tsx             # Leaflet map toggle
    │   │   ├── FilterChips.tsx         # wifi, AC, parkir, gender
    │   │   ├── SearchBar.tsx           # Landing page search
    │   │   ├── AreaChips.tsx           # Popular area quick-select
    │   │   └── ProviderSettings.tsx    # Settings page
    │   ├── lib/
    │   │   ├── api.ts                  # API client (FastAPI + SSE)
    │   │   ├── utils.ts                # cn() helper, formatters
    │   │   └── types.ts                # TypeScript interfaces
    │   └── styles/
    │       └── globals.css             # Tailwind + shadcn tokens
    └── public/
        └── favicon.svg
```

---

## 3. Component Tree

```
search.astro
└── DashboardLayout
    └── ChatInterface (client:load) ← ROOT STATE OWNER
        │
        ├── [Left Panel: w-64]
        │   └── SavedSearches
        │       props: searches, currentId, onSelect, onDelete, onNew
        │
        ├── [Center: flex-1]
        │   ├── Header bar
        │   │   ├── Toggle left panel ☰
        │   │   └── Toggle right panel ◫
        │   │
        │   ├── ChatWindow
        │   │   props: messages, isLoading, streamingContent
        │   │
        │   ├── FilterChips
        │   │   props: activeFilters, onToggle
        │   │   (wifi, ac, parkir, dapur, km_dalam, putri/putra/campur)
        │   │
        │   └── MessageInput
        │       props: onSend, disabled
        │
        └── [Right Panel: w-80]
            ├── Tab: [📋 List] [🗺️ Map]
            │
            ├── List mode:
            │   └── KosCardList
            │       ├── KosCard × N
            │       │   props: name, rating, tags, distance, price
            │       │   onClick → expand to KosDetail
            │       │
            │       └── KosDetail (expanded)
            │           props: full kos data, all reviews, phone, maps link
            │
            └── Map mode:
                └── MapView
                    props: kos markers, onMarkerClick
```

---

## 4. State Management

No external state library. All state in `ChatInterface` via `useState`:

```typescript
// ChatInterface state
const [messages, setMessages] = useState<Message[]>([]);
const [isLoading, setIsLoading] = useState(false);
const [streamingContent, setStreamingContent] = useState("");
const [results, setResults] = useState<KosResult[]>([]);
const [savedSearches, setSavedSearches] = useState<Search[]>([]);
const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
const [rightPanelMode, setRightPanelMode] = useState<"list" | "map">("list");
const [selectedKos, setSelectedKos] = useState<KosResult | null>(null);
const [filters, setFilters] = useState<FilterState>({});
const [showLeft, setShowLeft] = useState(true);
const [showRight, setShowRight] = useState(true);
```

---

## 5. Data Flow

```
User types "wifi kenceng di Cengkareng"
    │
    ▼
handleSendMessage(message)
    │
    ├── 1. Add user message to state
    ├── 2. POST /search { query, area, stream: true }
    ├── 3. SSE stream:
    │       ├── event: 'pipeline' → show progress
    │       ├── event: 'token' → append to streamingContent
    │       ├── event: 'results' → update results array + KosCardList
    │       └── event: 'done' → finalize message, save search
    │
    ▼
Filters (in-memory):
    User clicks [wifi] chip
    → setFilters({ ...filters, wifi: true })
    → useMemo filters results[] array
    → KosCardList re-renders instantly
    → NO API call
```

---

## 6. Streaming Protocol

### Client → Server (SSE Request)

```json
POST /search
{
  "query": "wifi kenceng di Cengkareng",
  "area": "Cengkareng",
  "top_k": 5,
  "stream": true
}
```

### Server → Client (SSE Events)

```
event: progress
data: {"stage": "resolve", "message": "Resolving area Cengkareng..."}

event: progress
data: {"stage": "scrape", "message": "Loading cached data (5 files)..."}

event: progress
data: {"stage": "search", "message": "Searching 152 kos..."}

event: token
data: {"token": "Berikut"}

event: token
data: {"token": " rekomendasi"}

event: token
data: {"token": " kos"}

event: token
data: {"token": " di Cengkareng..."}

event: results
data: {"results": [{"name": "Kost A", ...}, ...]}

event: done
data: {"conversation_id": "uuid-123"}
```

### SSE Client (reused from slack-rag)

```typescript
async function* streamSearch(query: string, area: string) {
  const response = await fetch(`${API_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, area, stream: true }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        yield JSON.parse(line.slice(6));
      }
    }
  }
}
```

---

## 7. Maps: Leaflet Integration

```typescript
// MapView.tsx
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";

function MapView({ markers, onMarkerClick }: Props) {
  return (
    <MapContainer center={[-6.147, 106.727]} zoom={14} style={{ height: "100%" }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap"
      />
      {markers.map((m) => (
        <Marker key={m.place_id} position={[m.lat, m.lon]}
                eventHandlers={{ click: () => onMarkerClick(m) }}>
          <Popup>{m.name} ({m.rating}★)</Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
```

Tiles are cached by browser, no server-side caching needed.

---

## 8. Search History: SQLite Schema

```sql
CREATE TABLE saved_searches (
  id TEXT PRIMARY KEY,
  query_text TEXT NOT NULL,
  area TEXT NOT NULL,
  result_count INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/searches` | List all saved searches |
| POST | `/api/searches` | Save a new search |
| DELETE | `/api/searches/{id}` | Delete a saved search |

Data stored in `data/search_history.db`.

---

## 9. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Astro islands, not SPA | Only chat + map need JS; landing page is pure static |
| State in ChatInterface | Single owner, no prop drilling confusion |
| In-memory filters | 152 kos max — no need for server round-trip |
| Leaflet over Google Maps | Free, no API key, same functionality for pins |
| SQLite for saved searches | Same pattern as slack-rag chat.db, zero config |
| No auth for MVP | Single user, local-only; auth is backlog in `/ideas` |
| SSE streaming (not WebSocket) | Simpler, same pattern as slack-rag, HTTP/1.1 |
| Right panel dual-mode | List/map toggle shares same 320px slot, no layout shift |
