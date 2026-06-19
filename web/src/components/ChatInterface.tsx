import { useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft, PanelRight, Bot, AlertCircle } from "lucide-react";
import type {
  Filters,
  KosResult,
  Message,
  RightPanelMode,
  SavedSearch,
} from "../lib/types";
import {
  resolveLocation,
  streamSearch,
  listSavedSearches,
  saveSavedSearch,
  deleteSavedSearch,
} from "../lib/api";
import { extractArea, uuid, cn } from "../lib/utils";
import ChatWindow from "./ChatWindow";
import MessageInput from "./MessageInput";
import FilterChips from "./FilterChips";
import KosCardList from "./KosCardList";
import SavedSearches from "./SavedSearches";

const GENDER_KEYS = ["putra", "putri", "campur"];
const DEFAULT_AREA = "Cengkareng";

const EMPTY_FILTERS: Filters = {
  wifi: false,
  ac: false,
  parkir: false,
  dapur: false,
  kamar_mandi_dalam: false,
  gender: null,
};

function activeFilterCount(filters: Filters): number {
  let n = 0;
  for (const key of ["wifi", "ac", "parkir", "dapur", "kamar_mandi_dalam"]) {
    if (filters[key]) n++;
  }
  if (filters.gender) n++;
  return n;
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [results, setResults] = useState<KosResult[]>([]);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("list");
  const [selectedKos, setSelectedKos] = useState<KosResult | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [pendingArea, setPendingArea] =
    useState<{ query: string; regency: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentArea, setCurrentArea] = useState<string>(DEFAULT_AREA);

  const bootstrapped = useRef(false);

  // Load saved searches on mount
  useEffect(() => {
    listSavedSearches().then(setSavedSearches).catch(() => {});
  }, []);

  // Bootstrap from URL ?q= / ?area= once
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const area = params.get("area");
    if (area) setCurrentArea(area);
    if (q) {
      handleSendMessage(q, area || extractArea(q) || DEFAULT_AREA);
    } else if (area) {
      handleSendMessage(`kos di ${area}`, area);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredResults = useMemo(() => {
    return results.filter((r) => {
      const tags = r.tags || [];
      if (filters.wifi && !tags.includes("wifi")) return false;
      if (filters.ac && !tags.includes("ac")) return false;
      if (filters.parkir && !tags.includes("parkir")) return false;
      if (filters.dapur && !tags.includes("dapur")) return false;
      if (filters.kamar_mandi_dalam && !tags.includes("kamar_mandi_dalam"))
        return false;
      if (filters.gender && (r.gender || "").toLowerCase() !== filters.gender)
        return false;
      return true;
    });
  }, [results, filters]);

  const handleToggleFilter = (key: string) => {
    setFilters((prev) => {
      if (GENDER_KEYS.includes(key)) {
        return {
          ...prev,
          gender: prev.gender === key ? null : (key as Filters["gender"]),
        };
      }
      return { ...prev, [key]: !prev[key as keyof Filters] };
    });
  };

  const resetFilters = () => setFilters(EMPTY_FILTERS);

  // Resolve area; if regency (multi-district), show picker instead of searching
  async function handleSendMessage(text: string, areaHint?: string) {
    const area = areaHint || extractArea(text) || currentArea || DEFAULT_AREA;
    setError(null);

    const userMsg: Message = {
      id: uuid(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setCurrentArea(area);

    try {
      const resolved = await resolveLocation(area);
      const districts = resolved?.data?.districts || [];

      if (resolved?.success && districts.length > 1) {
        const regency = resolved.data.regency || area;
        setMessages((prev) => [
          ...prev,
          {
            id: uuid(),
            role: "assistant",
            content: `${regency} memiliki ${districts.length} kecamatan. Pilih salah satu untuk mencari:`,
            timestamp: new Date().toISOString(),
            isPicker: true,
            districts,
          },
        ]);
        setPendingArea({ query: text, regency });
        return;
      }

      const searchArea =
        resolved?.success && districts.length === 1
          ? districts[0].name
          : area;
      await doSearch(text, searchArea);
    } catch (e) {
      console.error("resolveLocation failed", e);
      // Fall back to searching with the raw area
      await doSearch(text, area);
    }
  }

  async function doSearch(query: string, area: string) {
    setIsLoading(true);
    setStreamingContent("");
    setResults([]);
    setSelectedKos(null);
    setRightPanelMode("list");
    setFilters(EMPTY_FILTERS);
    setCurrentArea(area);
    setError(null);

    let collected = "";
    let resultCount = 0;

    try {
      for await (const event of streamSearch({ query, area, top_k: 5 })) {
        const t = event.type as string;
        if (t === "results") {
          const items = (event.results as KosResult[]) || [];
          resultCount = items.length;
          setResults(items);
        } else if (t === "token") {
          collected += event.token as string;
          setStreamingContent(collected);
        } else if (t === "done") {
          // finalize below
        }
      }

      const summary = collected.trim();
      if (summary) {
        setMessages((prev) => [
          ...prev,
          {
            id: uuid(),
            role: "assistant",
            content: summary,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
      setStreamingContent("");
      setIsLoading(false);

      // persist saved search
      const saved: SavedSearch = {
        id: uuid(),
        query_text: query,
        area,
        result_count: resultCount,
        created_at: new Date().toISOString(),
      };
      saveSavedSearch(saved)
        .then(() => listSavedSearches().then(setSavedSearches))
        .catch(() => {});
      setActiveSearchId(null);
    } catch (e: unknown) {
      console.error("search failed", e);
      const msg = e instanceof Error ? e.message : "Search gagal";
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: uuid(),
          role: "assistant",
          content: `Maaf, terjadi kesalahan: ${msg}`,
          timestamp: new Date().toISOString(),
        },
      ]);
      setIsLoading(false);
      setStreamingContent("");
    }
  }

  const onPickKecamatan = (name: string) => {
    if (!pendingArea) return;
    setMessages((prev) => [
      ...prev,
      {
        id: uuid(),
        role: "user",
        content: `[${name}]`,
        timestamp: new Date().toISOString(),
      },
    ]);
    const query = pendingArea.query;
    setPendingArea(null);
    void doSearch(query, name);
  };

  const onPickAllKecamatan = () => {
    if (!pendingArea) return;
    setMessages((prev) => [
      ...prev,
      {
        id: uuid(),
        role: "user",
        content: `[Cari di semua kecamatan ${pendingArea.regency}]`,
        timestamp: new Date().toISOString(),
      },
    ]);
    const query = pendingArea.query;
    const regency = pendingArea.regency;
    setPendingArea(null);
    void doSearch(query, regency);
  };

  const handleNewSearch = () => {
    setMessages([]);
    setResults([]);
    setSelectedKos(null);
    setStreamingContent("");
    setFilters(EMPTY_FILTERS);
    setActiveSearchId(null);
    setError(null);
    setPendingArea(null);
    const params = new URLSearchParams(window.location.search);
    params.delete("q");
    params.delete("area");
    window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
  };

  const handleSelectSaved = (s: SavedSearch) => {
    setActiveSearchId(s.id);
    handleSendMessage(s.query_text, s.area);
  };

  const handleDeleteSaved = (id: string) => {
    deleteSavedSearch(id)
      .then(() => listSavedSearches().then(setSavedSearches))
      .catch(() => {});
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {/* Left panel — saved searches */}
      {showLeft && (
        <>
          <div
            className="hidden md:block w-64 shrink-0 border-r border-border"
            aria-label="Riwayat pencarian"
          >
            <SavedSearches
              searches={savedSearches}
              activeSearchId={activeSearchId}
              onSelect={handleSelectSaved}
              onNew={handleNewSearch}
              onDelete={handleDeleteSaved}
            />
          </div>
          {/* Mobile drawer */}
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div
              className="w-64 h-full bg-card border-r border-border shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <SavedSearches
                searches={savedSearches}
                activeSearchId={activeSearchId}
                onSelect={(s) => {
                  handleSelectSaved(s);
                  setShowLeft(false);
                }}
                onNew={() => {
                  handleNewSearch();
                  setShowLeft(false);
                }}
                onDelete={handleDeleteSaved}
              />
            </div>
            <div className="flex-1 bg-black/30" onClick={() => setShowLeft(false)} />
          </div>
        </>
      )}

      {/* Center panel — chat */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2.5">
          <button
            type="button"
            onClick={() => setShowLeft((v) => !v)}
            className={cn(
              "p-1.5 rounded-md hover:bg-accent transition-colors",
              !showLeft && "text-muted-foreground"
            )}
            aria-label="Toggle panel kiri"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold leading-tight truncate">Kos AI</h2>
              <p className="text-[11px] text-muted-foreground truncate">
                Area: {currentArea}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowRight((v) => !v)}
            className={cn(
              "ml-auto p-1.5 rounded-md hover:bg-accent transition-colors",
              !showRight && "text-muted-foreground"
            )}
            aria-label="Toggle panel kanan"
          >
            <PanelRight className="w-4 h-4" />
          </button>
        </header>

        {error && (
          <div className="flex items-center gap-2 bg-destructive/10 text-destructive px-3 py-2 text-xs border-b border-destructive/20">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}

        <ChatWindow
          messages={messages}
          isLoading={isLoading}
          streamingContent={streamingContent}
          onPickKecamatan={onPickKecamatan}
          onPickAllKecamatan={onPickAllKecamatan}
        />

        <FilterChips
          results={results}
          filters={filters}
          onToggle={handleToggleFilter}
          onReset={resetFilters}
          activeCount={activeFilterCount(filters)}
        />

        <MessageInput onSend={(t) => handleSendMessage(t)} disabled={isLoading} />
      </div>

      {/* Right panel — results */}
      {showRight && (
        <div className="w-80 shrink-0 border-l border-border bg-card hidden md:block">
          <KosCardList
            results={filteredResults}
            selectedKos={selectedKos}
            mode={rightPanelMode}
            onModeChange={setRightPanelMode}
            onSelectKos={setSelectedKos}
            isLoading={isLoading}
          />
        </div>
      )}
    </div>
  );
}
