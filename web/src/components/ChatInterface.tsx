import { useEffect, useMemo, useRef, useState } from "react";
import {
  PanelLeft,
  PanelRight,
  Bot,
  AlertCircle,
  LogOut,
  Home,
  Settings,
  User,
  Monitor,
  Moon,
  Sun,
} from "lucide-react";
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
import { getAuth, logout } from "../lib/auth";
import { getStoredTheme, storeTheme, applyTheme, type Theme } from "../lib/theme";
import ChatWindow from "./ChatWindow";
import MessageInput from "./MessageInput";
import FilterChips from "./FilterChips";
import KosCardList from "./KosCardList";
import SavedSearches from "./SavedSearches";
import DistrictSwitcher from "./DistrictSwitcher";
import AreaSwitcher from "./AreaSwitcher";
import MobileNav from "./MobileNav";
import ConfirmModal from "./ConfirmModal";
import PipelineBanner from "./PipelineBanner";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Terang", icon: Sun },
  { value: "dark", label: "Gelap", icon: Moon },
  { value: "system", label: "Sistem", icon: Monitor },
];

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

const POI_PATTERN = /sekitar|dekat|sekitaran|deket|mall|stasiun|terminal|universitas|kampus|bandara|pelabuhan|pasar|alun|taman\b/i;

function activeFilterCount(filters: Filters): number {
  let n = 0;
  for (const key of ["wifi", "ac", "parkir", "dapur", "kamar_mandi_dalam"]) {
    if (filters[key]) n++;
  }
  if (filters.gender) n++;
  if (filters.budget) n++;
  return n;
}

function isAuthError(e: unknown): boolean {
  return e instanceof Error && e.message.includes("(401)");
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
  const [pipelineActive, setPipelineActive] = useState(false);
  const [relevantOnly, setRelevantOnly] = useState(false);
  const [authUser, setAuthUser] = useState<{ email: string; role: string } | null>(null);

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

  // Settings menu
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeTheme, setActiveTheme] = useState<Theme>(() => getStoredTheme());

  useEffect(() => {
    if (!showMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showMenu]);

  const handleTheme = (t: Theme) => {
    setActiveTheme(t);
    storeTheme(t);
    applyTheme(t);
  };

  const handleLogout = () => {
    setShowMenu(false);
    logout();
  };

  const bootstrapped = useRef(false);

  useEffect(() => {
    const auth = getAuth();
    if (auth.user) setAuthUser(auth.user);
    listSavedSearches().then(setSavedSearches).catch(() => {});
  }, []);

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const area = params.get("area");
    const validArea = area && area !== "undefined" ? area : undefined;
    // Strip a stale ?area=undefined (or empty) from the URL so it doesn't
    // persist across refreshes and look broken in the address bar.
    if (area && !validArea) {
      params.delete("area");
      window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
    }
    if (q) {
      void handleSendMessage(q, validArea || extractArea(q) || undefined);
    } else if (validArea) {
      void loadDistrict(validArea, undefined);
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

    // Extract intent via LLM only when:
    // 1. No district loaded (initial query — need area detection), OR
    // 2. Query looks like a POI/landmark search (e.g., "sekitar mall X")
    // Follow-up chats within a loaded district skip intent to avoid latency.
    const looksLikePoi = POI_PATTERN.test(text);
    let intentArea: string | null = null;
    let intentPoi: string | null = null;
    let intentTags: string[] = [];
    let intentGender: string | null = null;
    if (!currentDistrict || looksLikePoi) {
      try {
        const intent = await extractIntent(text);
        intentArea = intent.area;
        intentPoi = intent.poi;
        intentTags = intent.tags || [];
        intentGender = intent.gender || null;
      } catch {
        // LLM intent unavailable — fall back to POI pattern detection
      }
    }
    // If intent failed but query looks like POI, try direct geocode
    if (!intentPoi && !intentArea && looksLikePoi) {
      intentPoi = text;
    }

    // POI-based search: geocode the POI → find regency → auto-load or show picker
    // Skip if regex already found a known area (e.g., "Kos di sekitar Jakarta Barat")
    const regexArea = extractArea(text);
    if (intentPoi && !intentArea && !regexArea) {
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
        // POI resolved to a broad region (e.g. "sekitar Papua Barat" -> province).
        // Render the drill-down picker instead of "not found".
        if (poiResult && poiResult.broad_region && poiResult.regions?.length) {
          const regionList = poiResult.regions;
          setMessages((prev) => [
            ...prev,
            {
              id: uuid(),
              role: "assistant" as const,
              content: poiResult.message || `'${poiResult.region}' adalah area luas. Pilih salah satu sub-area:`,
              timestamp: new Date().toISOString(),
              isPicker: true,
              districts: regionList.map((name: string) => ({ name, postalCodes: [] })),
            },
          ]);
          setPendingArea({ query: text, regency: poiResult.region || poiResult.province });
          return;
        }
        // POI geocoding returned no results — try regex area fallback before showing error
        const regexFallback = extractArea(text);
        if (regexFallback) {
          // Don't show error — let area resolution handle it below
          intentArea = regexFallback;
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: uuid(),
              role: "assistant",
              content: `📍 Tidak dapat menemukan lokasi **"${intentPoi}"**. Coba gunakan nama area yang lebih spesifik, misalnya nama kota atau kecamatan.`,
              timestamp: new Date().toISOString(),
            },
          ]);
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

    // LLM-extracted area wins over areaHint.
    // If neither, check query text via regex before falling back to current district.
    let area = intentArea || areaHint;
    if (!area) {
      const regexArea = extractArea(text);
      area = regexArea || currentDistrict || DEFAULT_AREA;
    }

    try {
      const resolved = await resolveLocation(area);
      const districts = resolved?.data?.districts || [];
      const matchedAs = resolved?.data?.matchedAs || area;

      // Guard against geo-router false matches (e.g., "Bali" → "Cibaliung")
      const areaLower = area.toLowerCase();
      const matchedLower = matchedAs.toLowerCase();
      const isBadMatch = (
        districts.length === 1 &&
        districts[0]?.name &&
        matchedLower !== areaLower &&
        !matchedLower.includes(areaLower) &&
        !areaLower.includes(matchedLower) &&
        areaLower.length <= 6
      );
      if (isBadMatch) {
        setMessages((prev) => [
          ...prev,
          {
            id: uuid(),
            role: "assistant",
            content: `Tidak dapat menemukan area **"${area}"**. "${matchedAs}" tidak cocok. Coba gunakan nama kota/kecamatan yang lebih spesifik, atau pilih area dari daftar.`,
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

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
      if (isAuthError(e)) { logout(); return; }
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
    // Guard: never hit the API with an empty/undefined district. On refresh the
    // URL may carry ?area=undefined (stringified null), and other callers may
    // pass undefined when no district is selected — those should no-op, not 400.
    if (!district || district === "undefined" || district.trim() === "") {
      return;
    }
    setDatasetLoading(true);
    setError(null);
    setRelevantIds(new Set());
    setSelectedKos(null);
    setFilters(EMPTY_FILTERS);
    setRelevantOnly(false);

    try {
      const res = await loadArea(district, regency, loadAll);

      // Backend async pipeline: activate polling UI if pipeline started/queued
      const pipelineInfo = (res as { pipeline?: { pipeline_started?: boolean; pipeline_queued?: boolean } }).pipeline;
      if (pipelineInfo?.pipeline_started || pipelineInfo?.pipeline_queued) {
        // Still set district context for UI (switcher, etc.) even though data isn't ready
        setCurrentDistrict(district);
        setCurrentRegency(regency || null);
        setPipelineActive(true);
        setDatasetLoading(false);
        setPendingArea({ query: initialQuery || `kos di ${district}`, regency: regency || district });
        setMessages((prev) => [
          ...prev,
          {
            id: uuid(),
            role: "assistant" as const,
            content: `📋 Pipeline dimulai untuk **${district}**. Scrape → process → index berjalan di background. Hasil akan muncul setelah selesai.`,
            timestamp: new Date().toISOString(),
          },
        ]);
        return; // Don't proceed to queryDataset — will auto-retrigger on completion
      }

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
      if (isAuthError(e)) { logout(); return; }
      const msg = friendlyError(e, "Gagal memuat district.");
      setError(msg);
      setDatasetLoading(false);
    }
  }

  // --- Refine: RAG query over the current district (no dataset reload) ---
  async function queryDataset(
    query: string,
    district: string | undefined,
    opts: { saveSearch?: boolean; regency?: string | null; chatHistory?: Array<{ role: string; content: string }> } = {}
  ) {
    const saveSearch = opts.saveSearch !== false;
    // district may be undefined when the frontend couldn't extract an area
    // (the backend still resolves it via _resolve_query). Use a safe label so
    // messages never render the literal "undefined".
    const districtLabel = district?.trim() || "area ini";
    setIsLoading(true);
    setStreamingContent("");
    setRelevantIds(new Set());
    setRelevantOnly(false);
    setError(null);

    let collected = "";
    let relItems: KosResult[] = [];
    let regionHandled = false;
    const progressId = uuid();

    // Show a progress message if the search takes longer than 5s (first-time district)
    const progressTimer = setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: progressId,
          role: "assistant" as const,
          content: "Mencari data kos... lebih lama untuk daerah yang baru pertama kali dicari.",
          timestamp: new Date().toISOString(),
        },
      ]);
    }, 5000);

    const clearProgress = () => {
      clearTimeout(progressTimer);
      setMessages((prev) => prev.filter((m) => m.id !== progressId));
    };

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
        if (t === "region") {
          // Broad-region drill-down (province/regency): render clickable
          // sub-area chips instead of a text result. Picking one re-runs the
          // search scoped to that area via onPickKecamatan → loadDistrict.
          regionHandled = true;
          const regionName = (event.region as string) || "";
          const regions = (event.regions as string[]) || [];
          clearProgress();
          setMessages((prev) => [
            ...prev,
            {
              id: uuid(),
              role: "assistant" as const,
              content: (event.message as string) || `'${regionName}' adalah area luas. Pilih salah satu sub-area:`,
              timestamp: new Date().toISOString(),
              isPicker: true,
              districts: regions.map((name) => ({ name, postalCodes: [] })),
            },
          ]);
          setPendingArea({ query, regency: regionName });
        } else if (t === "results") {
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
                ? `Menampilkan **${shown.length} kos** di ${districtLabel} yang cocok dengan *"${query}"*:`
                : `Tidak ada kos yang persis cocok di ${districtLabel}. Menampilkan **${shown.length} kos** teratas:`,
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
            collected = `Tidak ada kos di ${districtLabel} yang cocok dengan *"${query}"*. Coba ubah filter atau kata kunci.`;
          }
        }
      }

      if (regionHandled) {
        // Drill-down picker rendered — no text result / saved search to record.
        setStreamingContent("");
        setIsLoading(false);
        clearProgress();
        setActiveSearchId(null);
        return;
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
      clearProgress();

      const saved: SavedSearch = {
        id: uuid(),
        query_text: query,
        area: district || "",
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
      clearProgress();
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

  const handleSelectArea = (regency: string) => {
    void handleSendMessage(regency);
  };

  const handleNewSearch = () => {
    if (isLoading || datasetLoading) return;
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
              disabled={isLoading || datasetLoading}
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
                disabled={isLoading || datasetLoading}
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
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0 flex items-center gap-2 flex-1">
              <AreaSwitcher
                disabled={datasetLoading || isLoading}
                onSelectArea={handleSelectArea}
              />
              <span className="text-muted-foreground/40 shrink-0">·</span>
              <DistrictSwitcher
                regency={currentRegency}
                currentDistrict={currentDistrict}
                siblings={siblingDistricts}
                onSwitch={onSwitchDistrict}
                disabled={datasetLoading || isLoading}
              />
              {scrapePipeline?.scrape_age_days !== undefined && scrapePipeline.scrape_age_days > 0 && (
                <span className="text-[10px] text-muted-foreground/50 shrink-0 select-none">
                  {scrapePipeline.scrape_age_days >= 1
                    ? `${Math.round(scrapePipeline.scrape_age_days)}hr`
                    : "baru"}
                </span>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <a
              href="/"
              className="hidden md:flex p-1.5 rounded-md hover:bg-accent transition-colors text-muted-foreground"
              aria-label="Beranda"
              title="Beranda"
            >
              <Home className="w-4 h-4" />
            </a>
            {/* Settings menu */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setShowMenu((v) => !v)}
                className={cn(
                  "p-1.5 rounded-md hover:bg-accent transition-colors",
                  showMenu ? "bg-accent text-foreground" : "text-muted-foreground"
                )}
                aria-label="Menu pengaturan"
              >
                <Settings className="w-4 h-4" />
              </button>

              {showMenu && (
                <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
                  {/* User info */}
                  {authUser && (
                    <div className="px-3 py-2.5 border-b border-border">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{authUser.email}</p>
                          <p className="text-[11px] text-muted-foreground capitalize">{authUser.role}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Theme toggle */}
                  <div className="px-3 py-2 border-b border-border">
                    <p className="text-[11px] text-muted-foreground mb-1.5">Tema</p>
                    <div className="flex gap-1">
                      {THEME_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        const isActive = activeTheme === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => { handleTheme(opt.value); }}
                            className={cn(
                              "flex-1 flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors",
                              isActive
                                ? "bg-primary/10 text-primary font-medium"
                                : "text-muted-foreground hover:bg-accent"
                            )}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Settings link (admin only) */}
                  {authUser?.role === "admin" && (
                    <a
                      href="/settings"
                      className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                      Pengaturan
                    </a>
                  )}

                  {/* Logout */}
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Keluar
                  </button>
                </div>
              )}
            </div>

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

        <PipelineBanner
          active={pipelineActive}
          onCompleted={(msg) => {
            setPipelineActive(false);
            // Auto-retrigger search if pipeline just completed and user is waiting
            if (currentDistrict && pendingArea) {
              void loadDistrict(currentDistrict, currentRegency ?? undefined, pendingArea.query, true);
            }
          }}
        />

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
