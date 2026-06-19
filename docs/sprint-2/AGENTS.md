# AGENTS.md — Sprint 2 Implementation Guide

> **For:** Any LLM agent implementing the Kos AI Dashboard UI.
> **Context:** Sprint 1 is complete. Backend services (geo-router, scraper, processor, RAG engine, FastAPI) are built and working. This sprint builds the web UI.

---

## 0. What Already Exists (Do NOT Rebuild)

```
rent-house-ai/
├── services/
│   ├── geo-router/          # Node.js Fastify :3001 — /resolve, /expand
│   ├── scraper/             # Python + Go binary — data/raw/<area>/
│   ├── data-processor/      # Python — data/cleaned/<area>_docs.json
│   └── rag-engine/          # Python — ChromaDB, search, rank, summarize
├── api/                     # FastAPI :8080 — POST /search, GET /locations/*
├── data/chroma_db/          # 152 kos embedded (Cengkareng)
└── docs/sprint-2/           # Planning docs (read for context)
```

**FastAPI endpoints ready to use:**
```bash
POST /search          # Full pipeline: query → area → scrape → search → summarize
GET  /locations/resolve?q=...   # Proxy to geo-router
GET  /locations/expand?q=...    # Regency → kecamatan list
GET  /health                    # Status + entry count
```

**POST /search response shape:**
```json
{
  "success": true,
  "query": "wifi kenceng",
  "pipeline": {"area": "Cengkareng", "scrape": "cached", "process": "cached", "index": "0 new, 152 skipped"},
  "results": [
    {
      "name": "Kost A",
      "place_id": "ChIJ...",
      "rating": 4.5,
      "review_count": 35,
      "tags": ["wifi", "ac", "parkir"],
      "gender": "campur",
      "phone": "+62812...",
      "lat": -6.135, "lon": 106.723,
      "kecamatan": "Cengkareng",
      "score": 0.618,
      "text": "## Kost A\nAlamat: ...\nRating: 4.5/5...\nReview tamu:\n[5★] ..."
    }
  ],
  "summary": "Pencarian: wifi kenceng\n\n1. Kost A..."
}
```

**SSE mode:** Add `"stream": true` to the request. The server will emit SSE events (NOT YET BUILT). You must build the SSE streaming in the FastAPI backend as part of this sprint.

---

## 1. Tech Stack (EXACT — Do Not Change)

| Layer | Technology | Version Constraint |
|-------|-----------|-------------------|
| Framework | **Astro 6** with SSR | `astro@^6` |
| UI | **React 19** islands | `react@^19` |
| Styling | **Tailwind CSS 4** + shadcn/ui CSS tokens | `tailwindcss@^4` |
| Map | **Leaflet** + OpenStreetMap | `leaflet`, `react-leaflet` |
| Markdown | **react-markdown** + remark-gfm | `react-markdown@^9` |
| Icons | **lucide-react** | latest |
| API Calls | **fetch** (no Axios, no React Query) | native |
| State | **useState** only (no Zustand, Redux, Context) | — |

**Check slack-rag for reference patterns** — same stack, many patterns reusable:
- `/Users/athallarizky/development/slack-rag/web/src/`
- `DashboardLayout.astro` — sidebar layout
- `ChatInterface.tsx` — state management pattern
- `ChatWindow.tsx` — streaming bubble pattern
- `api.ts` — API client structure

---

## 2. Project Scaffold (Phase 1)

Create the Astro project at `web/` from the monorepo root:

```bash
cd /Users/athallarizky/development/personal/rent-house-ai
mkdir web
cd web
# Init project (copy slack-rag's web/package.json as starting point)
```

**Package dependencies (minimum):**
```json
{
  "dependencies": {
    "astro": "^6",
    "@astrojs/react": "^4",
    "@tailwindcss/vite": "^4",
    "tailwindcss": "^4",
    "react": "^19",
    "react-dom": "^19",
    "react-markdown": "^9",
    "remark-gfm": "^4",
    "leaflet": "^1",
    "react-leaflet": "^5",
    "lucide-react": "^0.400",
    "clsx": "^2",
    "tailwind-merge": "^2"
  }
}
```

**File structure to create:**
```
web/
├── astro.config.mjs
├── package.json
├── tsconfig.json
├── src/
│   ├── styles/globals.css          # Tailwind + shadcn CSS tokens (copy from slack-rag)
│   ├── layouts/DashboardLayout.astro  # Sidebar nav + <slot /> (copy from slack-rag)
│   ├── pages/
│   │   ├── index.astro             # Landing page
│   │   ├── search.astro            # 3-panel dashboard
│   │   └── settings.astro          # LLM settings
│   ├── lib/
│   │   ├── api.ts                  # API client
│   │   ├── utils.ts                # cn() helper, formatPrice, formatDistance
│   │   └── types.ts                # TypeScript interfaces
│   └── components/
│       ├── ChatInterface.tsx        # Root orchestrator (client:load)
│       ├── ChatWindow.tsx           # Message list + streaming
│       ├── MessageInput.tsx         # Text input
│       ├── SavedSearches.tsx        # Left panel
│       ├── KosCardList.tsx          # Right panel list
│       ├── KosCard.tsx              # Single kos card
│       ├── KosDetail.tsx            # Expanded kos detail
│       ├── MapView.tsx              # Leaflet map
│       ├── FilterChips.tsx          # In-memory filter toggle
│       ├── SearchBar.tsx            # Landing search
│       ├── AreaChips.tsx            # Popular area quick-select
│       ├── StatsCards.tsx           # Landing page stats
│       └── ProviderSettings.tsx     # Settings page
└── public/favicon.svg
```

---

## 3. CSS / Theme

Copy the shadcn CSS tokens from slack-rag's `globals.css`. Key color scheme:

```
Primary: blue-600 (search action buttons, active states)
Background: white (slate-50 for cards)
Text: slate-900 (headings), slate-600 (body)
Border: slate-200
Card: white with border-2 and rounded-xl
Rating stars: amber-400
Wifi chip: green-100 text-green-700
AC chip: blue-100 text-blue-700
Parkir chip: amber-100 text-amber-700
```

---

## 4. Implementation Order (Follow Exactly)

### Phase 2 — Landing Page (`/`)

Build this FIRST because it's the simplest and proves the scaffold works.

**`index.astro`:**
- No React needed — pure Astro components
- Hero section with centered search bar
- Popular area chips: Cengkareng, Jakarta Barat, Bandung, Surabaya, Yogyakarta, Tangerang
- Stats cards: `StatsCards` island that calls `GET /health` and parses `entries: 83761`
- Search → `navigate('/search?q=' + encodeURIComponent(value))`

**`SearchBar.tsx` (React island):**
- Text input + search button
- On submit: `window.location.href = '/search?q=' + encodeURIComponent(query)`
- Keep it simple — no routing library

**`AreaChips.tsx` (React island):**
- Click chip → `window.location.href = '/search?area=' + area`

**`StatsCards.tsx` (React island):**
- Calls `GET /health` → shows entries count
- Hardcode "152 kos di Cengkareng" until a proper stats endpoint exists

### Phase 3 — 3-Panel Dashboard (`/search`)

This is the core. Build incrementally: center panel first, then left, then right.

**`search.astro`:**
```astro
<DashboardLayout>
  <ChatInterface client:load />
</DashboardLayout>
```

**`ChatInterface.tsx` — STATE OWNER:**
Copy the pattern from slack-rag's ChatInterface exactly:

```typescript
// STATE — all in useState, no external state lib
const [messages, setMessages] = useState<Message[]>([]);
const [isLoading, setIsLoading] = useState(false);
const [streamingContent, setStreamingContent] = useState("");
const [results, setResults] = useState<KosResult[]>([]);
const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
const [rightPanelMode, setRightPanelMode] = useState<"list" | "map">("list");
const [selectedKos, setSelectedKos] = useState<KosResult | null>(null);
const [filters, setFilters] = useState<Filters>({ wifi: false, ac: false, parkir: false, dapur: false, km_dalam: false, gender: null });
const [showLeft, setShowLeft] = useState(true);
const [showRight, setShowRight] = useState(true);
```

**`handleSendMessage`:**
```typescript
async function handleSendMessage(text: string) {
  // 1. Extract area from query or use URL param
  const params = new URLSearchParams(window.location.search);
  const area = params.get("area") || extractArea(text) || "Cengkareng";

  // 2. Add user message
  const userMsg = { role: "user", content: text };
  setMessages(prev => [...prev, userMsg]);
  setIsLoading(true);
  setStreamingContent("");

  // 3. POST /search (non-streaming first, then upgrade to SSE)
  const resp = await fetch("http://localhost:8080/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: text, area, top_k: 5 }),
  });
  const data = await resp.json();

  // 4. Update state
  setResults(data.results || []);
  const assistantMsg = { role: "assistant", content: data.summary || "" };
  setMessages(prev => [...prev, assistantMsg]);
  setIsLoading(false);

  // 5. Save search
  saveSearch(area, text, data.results?.length || 0);
}
```

**Area extraction helper (simple):**
```typescript
function extractArea(query: string): string | null {
  const areas = ["cengkareng", "jakarta barat", "jakarta selatan", "bandung", "surabaya"];
  const lower = query.toLowerCase();
  return areas.find(a => lower.includes(a)) || null;
}
```

**`ChatWindow.tsx` — Message list:**
Copy from slack-rag's ChatWindow. Key adaptations:
- User messages: right-aligned, blue-600 background, white text
- Assistant messages: left-aligned, slate-100 background, rendered as react-markdown
- Streaming state: when `isLoading && streamingContent` → show live markdown + blinking cursor animation
- Loading state: when `isLoading && !streamingContent` → 3 bouncing dots skeleton
- Empty state: centered icon + "Mulai pencarian untuk melihat hasil"

**`MessageInput.tsx`:**
Copy from slack-rag's MessageInput. Textarea, auto-resize, Enter=send, Shift+Enter=newline. Disabled when isLoading.

### Left Panel — `SavedSearches.tsx`

```typescript
interface SavedSearch {
  id: string;
  query_text: string;
  area: string;
  result_count: number;
  created_at: string;
}
```

- "New Chat" button at top → clears chat, starts fresh
- Scrollable list of saved searches
- Click → reload that search (re-fetch from API)
- Hover → delete button with confirmation
- Active search highlighted in blue
- For now, store in localStorage (Phase 5 adds SQLite backend)

### Right Panel — `KosCardList.tsx`

- Tabs: [📋 List] [🗺️ Map]
- List mode: vertical scroll of `KosCard` components
- Uses filtered results (in-memory, via `useMemo`)

**`KosCard.tsx`:**
```tsx
function KosCard({ kos, onClick }: { kos: KosResult; onClick: () => void }) {
  return (
    <div onClick={onClick} className="border rounded-xl p-3 hover:border-blue-400 cursor-pointer">
      <div className="flex justify-between items-start">
        <h3 className="font-semibold text-sm">{kos.name}</h3>
        <span className="text-amber-500 font-bold text-sm">{kos.rating}★</span>
      </div>
      <p className="text-xs text-slate-500 mt-1">{kos.kecamatan}</p>
      <div className="flex gap-1 mt-2 flex-wrap">
        {kos.tags.map(tag => <TagChip key={tag} tag={tag} />)}
      </div>
      <div className="text-xs text-slate-400 mt-1">{kos.review_count} reviews</div>
    </div>
  );
}
```

**`KosDetail.tsx` — Expanded card:**
- Shows when `selectedKos !== null` in right panel
- Full reviews parsed from `kos.text` (sections with `##`, `[N★]` patterns)
- Phone number with click-to-call link
- Google Maps link: `https://www.google.com/maps/place/?q=place_id:${kos.place_id}`
- "Back to list" button

### Map View — `MapView.tsx`

```tsx
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";

function MapView({ markers, onMarkerClick, center }: Props) {
  const defaultCenter: [number, number] = center || [-6.147, 106.727];

  return (
    <div className="h-full w-full">
      <MapContainer center={defaultCenter} zoom={14} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {markers.map(m => (
          <Marker key={m.place_id} position={[m.lat, m.lon]}
                  eventHandlers={{ click: () => onMarkerClick(m) }}>
            <Popup>{m.name}<br/>{m.rating}★ · {m.tags?.join(", ")}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
```

**IMPORTANT:** Leaflet's default marker icon breaks in React. You must import and set it:
```typescript
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});
```

### Filter Chips — `FilterChips.tsx`

- Row of toggleable chips: [wifi] [AC] [parkir] [dapur] [km dalam]
- Gender chips: [Putri] [Putra] [Campur]
- Active chip = filled color, inactive = outline
- Filters results array in-memory using `useMemo`
- Placed BETWEEN ChatWindow and MessageInput

```typescript
function FilterChips({ results, filters, onChange }: Props) {
  // Count available filters
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    results.forEach(r => r.tags?.forEach(t => counts[t] = (counts[t] || 0) + 1));
    return counts;
  }, [results]);

  return (
    <div className="flex gap-2 flex-wrap px-4 py-2 border-t">
      {["wifi", "ac", "parkir", "dapur", "kamar_mandi_dalam"].map(tag => (
        <button key={tag} onClick={() => onChange(tag)}
          className={`px-2 py-1 rounded-full text-xs ${filters[tag] ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}>
          {TAG_LABELS[tag]} ({tagCounts[tag] || 0})
        </button>
      ))}
    </div>
  );
}
```

---

## 5. Streaming (SSE) — Backend + Frontend

### Backend (modify `api/src/search.py`)

Add SSE streaming. When `stream: true`, emit events:

```python
async def _stream_pipeline(query: str, area: str, top_k: int):
    # Emit progress events
    yield f"event: progress\ndata: {json.dumps({'stage': 'scrape', 'message': 'Loading data...'})}\n\n"
    
    # ... run pipeline stages ...
    
    yield f"event: progress\ndata: {json.dumps({'stage': 'search', 'message': 'Searching...'})}\n\n"
    
    # Stream LLM tokens
    for token in llm_stream:
        yield f"event: token\ndata: {json.dumps({'token': token})}\n\n"
    
    # Emit results
    yield f"event: results\ndata: {json.dumps({'results': formatted_results})}\n\n"
    
    # Done
    yield f"event: done\ndata: {json.dumps({})}\n\n"
```

### Frontend (modify `ChatInterface.tsx`)

Use the SSE reader pattern from slack-rag:

```typescript
async function* streamSearch(query: string, area: string) {
  const resp = await fetch("http://localhost:8080/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, area, stream: true }),
  });

  const reader = resp.body!.getReader();
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

In `handleSendMessage`:
```typescript
for await (const event of streamSearch(text, area)) {
  if (event.type === "progress") {
    // Optionally show progress indicators
  } else if (event.type === "token") {
    setStreamingContent(prev => prev + event.token);
  } else if (event.type === "results") {
    setResults(event.results);
  } else if (event.type === "done") {
    setMessages(prev => [...prev, { role: "assistant", content: streamingContent }]);
    setStreamingContent("");
    setIsLoading(false);
  }
}
```

---

## 6. API Client (`web/src/lib/api.ts`)

```typescript
const API_URL = import.meta.env.PUBLIC_API_URL || "http://localhost:8080";

export interface SearchRequest {
  query: string;
  area?: string;
  top_k?: number;
  force_scrape?: boolean;
  stream?: boolean;
}

export interface KosResult {
  name: string;
  place_id: string;
  rating: number;
  review_count: number;
  tags: string[];
  gender: string;
  phone: string;
  lat: number;
  lon: number;
  kecamatan: string;
  score: number;
  text: string;
}

export interface SearchResponse {
  success: boolean;
  query: string;
  pipeline: Record<string, string>;
  results: KosResult[];
  summary: string;
}

export async function searchKos(req: SearchRequest): Promise<SearchResponse> {
  const resp = await fetch(`${API_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return resp.json();
}

export async function resolveLocation(q: string) {
  const resp = await fetch(`${API_URL}/locations/resolve?q=${encodeURIComponent(q)}`);
  return resp.json();
}

export async function getHealth() {
  const resp = await fetch(`${API_URL}/health`);
  return resp.json();
}
```

---

## 7. TypeScript Types (`web/src/lib/types.ts`)

```typescript
export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

export interface SavedSearch {
  id: string;
  query_text: string;
  area: string;
  result_count: number;
  created_at: string;
}

export interface Filters {
  wifi: boolean;
  ac: boolean;
  parkir: boolean;
  dapur: boolean;
  kamar_mandi_dalam: boolean;
  gender: "putra" | "putri" | "campur" | null;
  [key: string]: boolean | string | null;
}

export const TAG_LABELS: Record<string, string> = {
  wifi: "WiFi",
  ac: "AC",
  parkir: "Parkir",
  dapur: "Dapur",
  kamar_mandi_dalam: "KM Dalam",
  laundry: "Laundry",
  tv: "TV",
  kasur: "Kasur",
  lemari: "Lemari",
  listrik: "Listrik",
};
```

---

## 8. Settings Page (`/settings`)

`ProviderSettings.tsx` — simple form:
- Provider name (readonly: "Z.AI")
- Model select dropdown: glm-air, glm-4.7, glm-5.1
- API key input (password type, masked)
- Base URL (readonly: https://api.z.ai/api/paas/v4/)
- [Test Connection] button → sends a "hi" test message
- Save to localStorage for now (future: PUT /api/settings)

---

## 9. Mobile Responsive (Phase 6)

- Left panel: hidden by default on `md:` breakpoint, hamburger toggle
- Right panel: hidden by default, toggle button shows it
- Filter chips: `overflow-x-auto flex-nowrap` for horizontal scroll
- KosCard: full width on mobile, stack vertically
- Map: full screen overlay on mobile instead of inline
- Use Tailwind responsive prefixes: `hidden md:block`, `md:w-64`, `md:w-80`

---

## 10. Implementation Checklist (Build in This Order)

1. [ ] `mkdir web && cd web && npm init` — scaffold Astro project
2. [ ] Copy `globals.css` from slack-rag (Tailwind + shadcn tokens)
3. [ ] Copy `DashboardLayout.astro` from slack-rag → adapt sidebar nav
4. [ ] Build `index.astro` — landing page (pure Astro, no React yet)
5. [ ] Build `api.ts` + `types.ts` in `lib/`
6. [ ] Build `StatsCards.tsx` — test API connection
7. [ ] Build `SearchBar.tsx` + `AreaChips.tsx` — test navigation
8. [ ] Build `search.astro` + `ChatInterface.tsx` — skeleton 3-panel
9. [ ] Build `ChatWindow.tsx` — user/assistant message bubbles + markdown
10. [ ] Build `MessageInput.tsx` — auto-resize textarea
11. [ ] Wire `handleSendMessage` → non-streaming API call
12. [ ] Build `KosCardList.tsx` + `KosCard.tsx` — right panel list
13. [ ] Build `KosDetail.tsx` — expanded card on click
14. [ ] Build `FilterChips.tsx` — in-memory filtering
15. [ ] Build `SavedSearches.tsx` — left panel with localStorage
16. [ ] Build `MapView.tsx` — Leaflet with markers + popups
17. [ ] Add SSE streaming to FastAPI backend (`api/src/search.py`)
18. [ ] Wire SSE streaming in ChatInterface
19. [ ] Build `settings.astro` + `ProviderSettings.tsx`
20. [ ] Mobile responsive polish (all panels)
21. [ ] Loading skeletons + empty states + error states
22. [ ] Dark mode (if time)

---

## 11. Reference Files (Existing Code You Can Copy From)

| Source | Lines | What to Copy |
|--------|-------|-------------|
| `slack-rag/web/src/layouts/DashboardLayout.astro` | full | Sidebar layout structure |
| `slack-rag/web/src/styles/globals.css` | full | Tailwind + shadcn CSS tokens |
| `slack-rag/web/src/components/ChatInterface.tsx` | 1-50 (state), 80-130 (handleSend) | State shape + send pattern |
| `slack-rag/web/src/components/ChatWindow.tsx` | full | Message list + streaming bubble |
| `slack-rag/web/src/components/MessageInput.tsx` | full | Textarea + auto-resize |
| `slack-rag/web/src/components/ConversationSidebar.tsx` | full | Sidebar list pattern (adapt for SavedSearches) |
| `slack-rag/web/src/lib/api.ts` | 1-30 | API client structure + SSE reader |
| `slack-rag/web/src/lib/utils.ts` | full | `cn()` helper |
| `slack-rag/astro.config.mjs` | full | Astro config |
| `slack-rag/web/tsconfig.json` | full | TypeScript config |
| `slack-rag/web/package.json` | dependencies | Package list (remove slack-specific deps) |

---

## 12. Deviations from Slack-RAG (Important Differences)

| Slack-RAG | Rent-House-AI | Why |
|-----------|---------------|-----|
| Provider selector with 5 adapters | Only Z.AI API, model dropdown | Simpler, no CLI/terminal |
| Thread sources in right panel | KosCard list in right panel | Different data type |
| Upload data before chatting | Search immediately (data pre-scraped) | Different pipeline |
| Multi-provider settings page | Single provider + model select | Less complexity |
| Conversation history (SQLite) | Saved searches (localStorage → SQLite) | Different domain |

---

## 13. Environment Variables

Create `web/.env`:
```
PUBLIC_API_URL=http://localhost:8080
```

No other env vars needed on the frontend. LLM key stays on the backend.

---

## 14. How to Run

```bash
# Terminal 1: Geo-router
cd services/geo-router && npm run dev

# Terminal 2: FastAPI
cd api && python3 -m uvicorn src.main:app --port 8080

# Terminal 3: Web UI
cd web && npm run dev
# → http://localhost:4321
```

---

## 15. Done Criteria

- [ ] Landing page renders at `/` with search bar + area chips
- [ ] Search → `/search?q=...` triggers API call, shows results in right panel
- [ ] Chat shows user + assistant messages with markdown rendering
- [ ] Right panel shows KosCard list, click expands detail
- [ ] Map toggle shows Leaflet with all kos as markers
- [ ] Filter chips filter results in-memory (no API re-call)
- [ ] SSE streaming: LLM tokens appear in real-time
- [ ] Left panel saves search history, click re-runs search
- [ ] Settings page configures Z.AI key + model
- [ ] Mobile: panels collapse, swipe-able
- [ ] No TypeScript errors, no console warnings
