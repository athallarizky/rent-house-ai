import { useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft, PanelRight, Bot, AlertCircle } from "lucide-react";
import type {
  ChatMode,
  Filters,
  KosResult,
  Message,
  RightPanelMode,
  SavedSearch,
  District,
  SearchPipeline,
} from "../lib/types";
import {
  resolveLocation,
  streamSearch,
  loadArea,
  listSavedSearches,
  saveSavedSearch,
  deleteSavedSearch,
  deleteAllSavedSearches,
  extractIntent,
  resolvePoi,
} from "../lib/api";
import { extractArea, uuid, cn, friendlyError } from "../lib/utils";
import ChatWindow from "./ChatWindow";
import MessageInput from "./MessageInput";
import FilterChips from "./FilterChips";
import KosCardList from "./KosCardList";
import SavedSearches from "./SavedSearches";
import DistrictSwitcher from "./DistrictSwitcher";
import ThemeToggle from "./ThemeToggle";
import MobileNav from "./MobileNav";
import ConfirmModal from "./ConfirmModal";

const GENDER_KEYS = ["putra", "putri", "campur"];
const DEFAULT_AREA = "Cengkareng";

const EMPTY_FILTERS: Filters = {
  wifi: false,
  ac: false,
  parkir: false,
  dapur: false,
  kamar_mandi_dalam: false,
  gender: null,
  budget: null,
};

function activeFilterCount(filters: Filters): number {
  let n = 0;
  for (const key of ["wifi", "ac", "parkir", "dapur", "kamar_mandi_dalam"]) {
    if (filters[key]) n++;
  }
  if (filters.gender) n++;
  if (filters.budget) n++;
  return n;
}

export default function ChatInterface() {
  // Session state (Rev-001)
  const [dataset, setDataset] = useState<KosResult[]>([]);
  const [relevantIds, setRelevantIds] = useState<Set<string>>(new Set());
  const [currentDistrict, setCurrentDistrict] = useState<string | null>(null);
  const [currentRegency, setCurrentRegency] = useState<string | null>(null);
  const [siblingDistricts, setSiblingDistricts] = useState<District[]>([]);
  const [scrapePipeline, setScrapePipeline] = useState<SearchPipeline | null>(null);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [relevantOnly, setRelevantOnly] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [pendingArea, setPendingArea] =
    useState<{ query: string; regency: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("list");
  const [selectedKos, setSelectedKos] = useState<KosResult | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showLeft, setShowLeft] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 768
  );
  const [showRight, setShowRight] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 768
  );

  // Chat mode: "rag" = results only (no LLM), "ai" = full pipeline
  const [chatMode, setChatMode] = useState<ChatMode>(() => {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("kos-ai.chat-mode");
      if (stored === "rag" || stored === "ai") return stored;
    }
    return "ai";
  });
  const toggleChatMode = (mode: ChatMode) => {
    setChatMode(mode);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("kos-ai.chat-mode", mode);
    }
  };

  const bootstrapped = useRef(false);

  useEffect(() => {
    listSavedSearches().then(setSavedSearches).catch(() => {});
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const area = params.get("area");
    if (q) {
      void handleSendMessage(q, area || extractArea(q) || undefined);
    } else if (area) {
      void loadDistrict(area, undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Panel content = dataset filtered by chips in-memory
  const filteredDataset = useMemo(() => {
    return dataset.filter((r) => {
      const tags = r.tags || [];
      if (filters.wifi && !tags.includes("wifi")) return false;
      if (filters.ac && !tags.includes("ac")) return false;
      if (filters.parkir && !tags.includes("parkir")) return false;
      if (filters.dapur && !tags.includes("dapur")) return false;
      if (filters.kamar_mandi_dalam && !tags.includes("kamar_mandi_dalam"))
        return false;
      if (filters.gender && (r.gender || "").toLowerCase() !== filters.gender)
        return false;
      if (filters.budget) {
        const budgetMax = r.price_max;
        if (budgetMax == null) return false;
        const maxPrice = budgetMax;
        if (filters.budget === "<500rb" && maxPrice >= 500_000) return false;
        if (filters.budget === "500rb-1jt" && (maxPrice < 500_000 || maxPrice >= 1_000_000)) return false;
        if (filters.budget === "1jt-2jt" && (maxPrice < 1_000_000 || maxPrice >= 2_000_000)) return false;
        if (filters.budget === ">2jt" && maxPrice < 2_000_000) return false;
      }
      return true;
    });
  }, [dataset, filters]);

  const budgetCounts = useMemo(() => {
    const counts: Record<string, number> = { "<500rb": 0, "500rb-1jt": 0, "1jt-2jt": 0, ">2jt": 0 };
    for (const r of dataset) {
      const pm = r.price_max;
      if (pm == null) continue;
      if (pm < 500_000) counts["<500rb"]++;
      else if (pm < 1_000_000) counts["500rb-1jt"]++;
      else if (pm < 2_000_000) counts["1jt-2jt"]++;
      else counts[">2jt"]++;
    }
    return counts;
  }, [dataset]);

  const handleToggleFilter = (key: string) => {
    setFilters((prev) => {
      if (GENDER_KEYS.includes(key)) {
        return {
          ...prev,
          gender: prev.gender === key ? null : (key as Filters["gender"]),
        };
      }
      if (key === "budget") return prev; // budget handled via specific keys
      if (key.startsWith("budget:")) {
        const val = key.slice(7);
        return { ...prev, budget: prev.budget === val ? null : val };
      }
      return { ...prev, [key]: !prev[key as keyof Filters] };
    });
  };

  const resetFilters = () => setFilters(EMPTY_FILTERS);

  // --- Flow: handle a chat message (detect load vs refine vs picker) ---
  async function handleSendMessage(text: string, areaHint?: string) {
    setError(null);
    const userMsg: Message = {
      id: uuid(),
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    // Build chat history for context (last 3 pairs, including this message)
    const chatHistory: Array<{ role: string; content: string }> = [];
    for (let i = messages.length - 1; i >= 0 && chatHistory.length < 6; i--) {
      const m = messages[i];
      if (m.isPicker) continue;
      chatHistory.unshift({ role: m.role, content: m.content });
      if (m.role === "assistant") break;
    }
    chatHistory.push({ role: "user", content: text });

    // Extract intent via LLM (area, tags, gender, keywords, poi).
    // In RAG mode: only extract area when no district is loaded (need location).
    // In AI mode: always extract full intent.
    let intentArea: string | null = null;
    let intentPoi: string | null = null;
    let intentTags: string[] = [];
    let intentGender: string | null = null;
    if (chatMode === "ai" || !currentDistrict) {
      try {
        const intent = await extractIntent(text);
        intentArea = intent.area;
        intentPoi = intent.poi;
        intentTags = intent.tags || [];
        intentGender = intent.gender || null;
      } catch {
        // LLM intent unavailable — area extraction below handles it
      }
    }

    // POI-based search: geocode the POI → find regency → auto-load or show picker
    if (intentPoi && !intentArea) {
      try {
        const poiResult = await resolvePoi(intentPoi);
        if (poiResult && poiResult.districts.length > 0) {
          const districtName = poiResult.district || poiResult.districts[0]?.name;
          const locationLabel = poiResult.display_name?.split(",")[0]?.trim() || intentPoi;

          setMessages((prev) => [
            ...prev,
            {
              id: uuid(),
              role: "assistant",
              content: `📍 **${locationLabel}** di ${districtName || ""}, ${poiResult.regency || poiResult.province}. Mencari kos di sekitar lokasi ini…`,
              timestamp: new Date().toISOString(),
            },
          ]);

          if (districtName) {
            // Auto-load the specific district containing the POI
            void loadDistrict(districtName, poiResult.regency || poiResult.province, text);
            return;
          }

          // Fallback: show regency picker
          setMessages((prev) => [
            ...prev,
            {
              id: uuid(),
              role: "assistant",
              content: `${poiResult.regency} memiliki ${poiResult.districts.length} kecamatan. Pilih salah satu untuk memuat data:`,
              timestamp: new Date().toISOString(),
              isPicker: true,
              districts: poiResult.districts.map((d: District) => ({
                name: d.name,
                postalCodes: d.postalCodes,
              })),
            },
          ]);
          setPendingArea({ query: text, regency: poiResult.regency || poiResult.province });
          return;
        }
      } catch {
        // Geocoding failed — fall through to area resolution
      }
    }
    // Only pre-fill filters in AI mode
    if (chatMode === "ai" && (intentTags.length > 0 || intentGender)) {
      setFilters((prev) => {
        const next: Filters = { ...prev };
        for (const t of intentTags) {
          if (t in next) (next as Record<string, boolean>)[t] = true;
        }
        if (intentGender && ["putri", "putra", "campur"].includes(intentGender)) {
          next.gender = intentGender as Filters["gender"];
        }
        return next;
      });
    }

    // LLM-extracted area wins over areaHint, falls back to hardcoded regex
    const area =
      intentArea || areaHint || currentDistrict || DEFAULT_AREA;

    try {
      const resolved = await resolveLocation(area);
      const districts = resolved?.data?.districts || [];

      // Regency → kecamatan picker
      if (resolved?.success && districts.length > 1) {
        const regency = resolved.data.regency || area;
        setMessages((prev) => [
          ...prev,
          {
            id: uuid(),
            role: "assistant",
            content: `${regency} memiliki ${districts.length} kecamatan. Pilih salah satu untuk memuat data:`,
            timestamp: new Date().toISOString(),
            isPicker: true,
            districts,
          },
        ]);
        setPendingArea({ query: text, regency });
        return;
      }

      const districtName =
        resolved?.success && districts.length === 1
          ? districts[0].name
          : area;
      const regency = resolved?.success ? resolved.data.regency || "" : "";

      // Same district as current session → refine
      if (
        currentDistrict &&
        districtName.toLowerCase() === currentDistrict.toLowerCase()
      ) {
        await queryDataset(text, currentDistrict, { chatHistory });
        return;
      }

      // New district → load dataset (+ run the query as initial refinement)
      await loadDistrict(districtName, regency || undefined, text);
    } catch (e) {
      console.error("handleSendMessage failed", e);
      const msg = friendlyError(e, "Gagal memproses pencarian.");
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: uuid(),
          role: "assistant",
          content: `Maaf, terjadi kesalahan saat memproses **${text}**: ${msg}`,
          timestamp: new Date().toISOString(),
        },
      ]);
      setIsLoading(false);
    }
  }

  // --- Load the full dataset for a district (session browse set) ---
  async function loadDistrict(
    district: string,
    regency?: string,
    initialQuery?: string,
    loadAll = false
  ) {
    setDatasetLoading(true);
    setError(null);
    setRelevantIds(new Set());
    setSelectedKos(null);
    setFilters(EMPTY_FILTERS);
    setRelevantOnly(false);

    try {
      const res = await loadArea(district, regency, loadAll);
      setDataset(res.dataset || []);
      setCurrentDistrict(res.district);
      setCurrentRegency(res.regency || null);
      setSiblingDistricts(res.siblings || []);
      setScrapePipeline(res.pipeline || null);

      const params = new URLSearchParams(window.location.search);
      params.set("area", res.district);
      params.delete("q");
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}?${params.toString()}`
      );
      setDatasetLoading(false);

      // Always produce an initial recommendation for the loaded district.
      // If the caller supplied an explicit query (picker pick / direct search /
      // ?q= bootstrap), use it AND persist it to history. Otherwise fall back to
      // a browse query ("kos di <district>") which is auto-generated → not saved
      // (avoids spamming history with "kos di X" on every switch).
      const explicit = initialQuery && initialQuery.trim();
      const initialQ = explicit ? initialQuery!.trim() : `kos di ${res.district}`;
      await queryDataset(initialQ, res.district, {
        saveSearch: !!explicit,
        regency: res.regency,
      });
    } catch (e) {
      console.error("loadDistrict failed", e);
      const msg = friendlyError(e, "Gagal memuat district.");
      setError(msg);
      setDatasetLoading(false);
    }
  }

  // --- Refine: RAG query over the current district (no dataset reload) ---
  async function queryDataset(
    query: string,
    district: string,
    opts: { saveSearch?: boolean; regency?: string | null; chatHistory?: Array<{ role: string; content: string }> } = {}
  ) {
    const saveSearch = opts.saveSearch !== false;
    setIsLoading(true);
    setStreamingContent("");
    setRelevantIds(new Set());
    setRelevantOnly(false);
    setError(null);

    let collected = "";
    let relItems: KosResult[] = [];

    try {
      for await (const event of streamSearch({
        query,
        area: district,
        regency: opts.regency ?? currentRegency ?? undefined,
        top_k: 10,
        chat_history: opts.chatHistory,
        mode: chatMode,
      })) {
        const t = event.type as string;
        if (t === "results") {
          relItems = (event.results as KosResult[]) || [];
          setRelevantIds(new Set(relItems.map((r) => r.place_id)));
          if (relItems.length) {
            const scoreMap = new Map(
              relItems.map((r) => [r.place_id, r.score || 0])
            );
            setDataset((prev) =>
              prev.map((k) =>
                scoreMap.has(k.place_id)
                  ? { ...k, score: scoreMap.get(k.place_id) || 0 }
                  : { ...k, score: 0 }
              )
            );
          }
        } else if (t === "token") {
          collected += event.token as string;
          setStreamingContent(collected);
        } else if (t === "done") {
          if (chatMode === "rag" && relItems.length > 0) {
            // Filter to truly relevant results (score > 0) so the chat body
            // reflects what the user actually asked for, not just top-rated kos.
            const relevant = relItems.filter((r) => (r.score || 0) > 0);
            const shown = relevant.length > 0 ? relevant : relItems.slice(0, 5);
            const lines = [
              relevant.length > 0
                ? `Menampilkan **${shown.length} kos** di ${district} yang cocok dengan *"${query}"*:`
                : `Tidak ada kos yang persis cocok di ${district}. Menampilkan **${shown.length} kos** teratas:`,
              "",
            ];
            for (let i = 0; i < Math.min(shown.length, 10); i++) {
              const r = shown[i];
              const stars = typeof r.rating === "number" ? r.rating.toFixed(1) : r.rating;
              const tags = (r.tags || []).slice(0, 4).join(", ");
              const pmn = r.price_min;
              const pmx = r.price_max;
              const price = (pmn != null && pmx != null)
                ? pmn === pmx
                  ? `Rp${(pmn / 1_000_000).toFixed(1)}jt`
                  : `Rp${(pmn / 1_000_000).toFixed(1)}-${(pmx / 1_000_000).toFixed(1)}jt`
                : "";
              lines.push(`${i + 1}. **${r.name}** — ${stars}★ ${price ? "· " + price : ""}${tags ? " — " + tags : ""}`);
            }
            collected = lines.join("\n");
          } else if (chatMode === "rag") {
            collected = `Tidak ada kos di ${district} yang cocok dengan *"${query}"*. Coba ubah filter atau kata kunci.`;
          }
        }
      }

      if (collected.trim()) {
        setMessages((prev) => [
          ...prev,
          {
            id: uuid(),
            role: "assistant",
            content: collected.trim(),
            timestamp: new Date().toISOString(),
          },
        ]);
      }
      setStreamingContent("");
      setIsLoading(false);

      const saved: SavedSearch = {
        id: uuid(),
        query_text: query,
        area: district,
        result_count: relItems.length,
        created_at: new Date().toISOString(),
      };
      if (saveSearch) {
        saveSavedSearch(saved)
          .then(() => listSavedSearches().then(setSavedSearches))
          .catch(() => {});
      }
      setActiveSearchId(null);
    } catch (e) {
      console.error("queryDataset failed", e);
      const msg = friendlyError(e, "Pencarian gagal.");
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
    const { query, regency } = pendingArea;
    setPendingArea(null);
    void loadDistrict(name, regency, query);
  };

  // Rev-001: "Cari di SEMUA kecamatan" loads all districts in the regency
  const onPickAllKecamatan = () => {
    if (!pendingArea) return;
    const { query, regency } = pendingArea;
    setPendingArea(null);
    setMessages((prev) => [
      ...prev,
      {
        id: uuid(),
        role: "user",
        content: `[SEMUA kecamatan di ${regency}]`,
        timestamp: new Date().toISOString(),
      },
    ]);
    void loadDistrict(regency, regency, query, true);
  };

  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  const onSwitchDistrict = (name: string) => {
    if (
      currentDistrict &&
      name.toLowerCase() === currentDistrict.toLowerCase()
    )
      return;
    // If a dataset is loaded, confirm before discarding the current session.
    if (dataset.length > 0) {
      setPendingSwitch(name);
      return;
    }
    void loadDistrict(name, currentRegency || undefined);
  };

  const confirmSwitch = () => {
    const name = pendingSwitch;
    setPendingSwitch(null);
    if (name) void loadDistrict(name, currentRegency || undefined);
  };

  const handleNewSearch = () => {
    setMessages([]);
    setDataset([]);
    setRelevantIds(new Set());
    setSelectedKos(null);
    setStreamingContent("");
    setFilters(EMPTY_FILTERS);
    setRelevantOnly(false);
    setActiveSearchId(null);
    setError(null);
    setPendingArea(null);
    setCurrentDistrict(null);
    setCurrentRegency(null);
    setSiblingDistricts([]);
    window.history.replaceState({}, "", window.location.pathname);
  };

  const handleSelectSaved = (s: SavedSearch) => {
    setActiveSearchId(s.id);
    // Re-run through handleSendMessage so the query's intent is re-detected:
    // a regency-level query ("kos di bandung") re-triggers the district picker,
    // while a refine query ("wifi kenceng") restores the saved district context.
    const hint = extractArea(s.query_text) ? undefined : s.area;
    void handleSendMessage(s.query_text, hint);
  };

  const handleDeleteSaved = (id: string) => {
    deleteSavedSearch(id)
      .then(() => listSavedSearches().then(setSavedSearches))
      .catch(() => {});
  };

  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const handleClearAllSaved = () => {
    setShowClearAllConfirm(true);
  };
  const confirmClearAll = () => {
    deleteAllSavedSearches()
      .then(() => listSavedSearches().then(setSavedSearches))
      .catch(() => {})
      .finally(() => setShowClearAllConfirm(false));
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
              onClearAll={handleClearAllSaved}
            />
          </div>
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div className="w-64 h-full bg-card border-r border-border shadow-xl">
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
                onClearAll={handleClearAllSaved}
              />
            </div>
            <div className="flex-1 bg-black/30" onClick={() => setShowLeft(false)} />
          </div>
        </>
      )}

      {/* Center panel — chat */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-2.5">
          <MobileNav currentPath="/search" />
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
              <DistrictSwitcher
                regency={currentRegency}
                currentDistrict={currentDistrict}
                siblings={siblingDistricts}
                onSwitch={onSwitchDistrict}
                disabled={datasetLoading || isLoading}
              />
              {scrapePipeline?.scrape_age_days !== undefined && scrapePipeline.scrape_age_days > 0 && (
                <span className="text-[10px] text-muted-foreground/70 ml-1">
                  Data {scrapePipeline.scrape_age_days >= 1
                    ? `${Math.round(scrapePipeline.scrape_age_days)} hari lalu`
                    : "baru saja"}
                </span>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle compact />
            <button
              type="button"
              onClick={() => setShowRight((v) => !v)}
              className={cn(
                "p-1.5 rounded-md hover:bg-accent transition-colors",
                !showRight && "text-muted-foreground"
              )}
              aria-label="Toggle panel kanan"
            >
              <PanelRight className="w-4 h-4" />
            </button>
          </div>
        </header>

        {error && (
          <div className="flex items-center gap-2 bg-destructive/10 text-destructive px-3 py-2 text-xs border-b border-destructive/20">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{error}</span>
          </div>
        )}

        <ChatWindow
          messages={messages}
          isLoading={isLoading || datasetLoading}
          streamingContent={streamingContent}
          onPickKecamatan={onPickKecamatan}
          onPickAllKecamatan={onPickAllKecamatan}
        />

        <FilterChips
          results={dataset}
          filters={filters}
          onToggle={handleToggleFilter}
          onReset={resetFilters}
          activeCount={activeFilterCount(filters)}
          budgetCounts={budgetCounts}
        />

        <MessageInput
          onSend={(t) => handleSendMessage(t)}
          disabled={isLoading || datasetLoading}
          chatMode={chatMode}
          onToggleMode={toggleChatMode}
        />
      </div>

      {/* Right panel — dataset + relevance */}
      {showRight && (
        <>
          {/* Desktop column */}
          <div className="w-[440px] shrink-0 h-full border-l border-border bg-card hidden md:block overflow-hidden">
            <KosCardList
              results={filteredDataset}
              selectedKos={selectedKos}
              mode={rightPanelMode}
              onModeChange={setRightPanelMode}
              onSelectKos={setSelectedKos}
              isLoading={datasetLoading}
              relevantIds={relevantIds}
              relevantOnly={relevantOnly}
              onToggleRelevantOnly={() => setRelevantOnly((v) => !v)}
            />
          </div>
          {/* Mobile drawer */}
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div
              className="w-80 h-full bg-card border-l border-border shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <KosCardList
                results={filteredDataset}
                selectedKos={selectedKos}
                mode={rightPanelMode}
                onModeChange={setRightPanelMode}
                onSelectKos={(k) => {
                  setSelectedKos(k);
                  setShowRight(false);
                }}
                isLoading={datasetLoading}
                relevantIds={relevantIds}
                relevantOnly={relevantOnly}
                onToggleRelevantOnly={() => setRelevantOnly((v) => !v)}
              />
            </div>
            <div className="flex-1 bg-black/30" onClick={() => setShowRight(false)} />
          </div>
        </>
      )}

      {/* Confirm: switch district (discards current session relevance) */}
      <ConfirmModal
        open={pendingSwitch !== null}
        title={`Pindah ke ${pendingSwitch ?? ""}?`}
        message="Relevansi chat akan direset. Dataset district baru akan dimuat."
        confirmLabel="Pindah"
        onConfirm={confirmSwitch}
        onClose={() => setPendingSwitch(null)}
      />

      {/* Confirm: clear-all search history */}
      <ConfirmModal
        open={showClearAllConfirm}
        title="Hapus semua histori pencarian?"
        message={`${savedSearches.length} pencarian tersimpan akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Hapus Semua"
        cancelLabel="Batal"
        variant="danger"
        onConfirm={confirmClearAll}
        onClose={() => setShowClearAllConfirm(false)}
      />
    </div>
  );
}
