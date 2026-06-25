import type {
  SearchRequest,
  SearchResponse,
  ResolveLocationResponse,
  ExpandLocationResponse,
  HealthResponse,
  SavedSearch,
  AreaLoadResponse,
} from "./types";
import { getAuthHeaders } from "./auth";

const API_URL =
  (import.meta.env.PUBLIC_API_URL as string | undefined) || "/api";

/**
 * Non-streaming kos search.
 */
export async function searchKos(req: SearchRequest): Promise<SearchResponse> {
  const resp = await fetch(`${API_URL}/search`, {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Search failed (${resp.status}): ${detail}`);
  }

  return resp.json();
}

/**
 * Streaming kos search via SSE. Yields normalized events.
 *
 * Backend event shapes (see api/src/search.py):
 *   { type: "progress", stage, message }
 *   { type: "token",    token }
 *   { type: "results",  results }
 *   { type: "pipeline", pipeline }
 *   { type: "done" }
 */
export async function* streamSearch(
  req: SearchRequest
): AsyncGenerator<{ type: string; [key: string]: unknown }> {
  const resp = await fetch(`${API_URL}/search`, {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ ...req, stream: true }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Search stream failed (${resp.status}): ${detail}`);
  }

  if (!resp.body) throw new Error("No response body for stream");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        if (payload === "[DONE]") yield { type: "done" };
        continue;
      }
      try {
        yield JSON.parse(payload);
      } catch {
        // ignore malformed lines
      }
    }
  }
}

export async function resolveLocation(q: string): Promise<ResolveLocationResponse> {
  const resp = await fetch(`${API_URL}/locations/resolve?q=${encodeURIComponent(q)}`);
  if (!resp.ok) {
    // Surface the API's detail (e.g. "Geo-router unavailable: ...") so the UI
    // can tell a real geo-router outage apart from the backend being down.
    const detail = await resp.text().catch(() => "");
    throw new Error(`resolveLocation failed (${resp.status}): ${detail.slice(0, 160)}`);
  }
  return resp.json();
}

export async function expandLocation(q: string): Promise<ExpandLocationResponse> {
  const resp = await fetch(`${API_URL}/locations/expand?q=${encodeURIComponent(q)}`);
  if (!resp.ok) throw new Error(`expandLocation failed (${resp.status})`);
  return resp.json();
}

export async function getHealth(): Promise<HealthResponse> {
  const resp = await fetch(`${API_URL}/health`);
  if (!resp.ok) throw new Error(`getHealth failed (${resp.status})`);
  return resp.json();
}

/**
 * Load the full kos dataset for a district (the session browse set) + sibling
 * districts for the switcher. Runs the pipeline (cached after first run).
 * Rev-001: replaces the old per-message full search.
 */
export async function loadArea(
  district: string,
  regency?: string,
  loadAll = false
): Promise<AreaLoadResponse> {
  const resp = await fetch(`${API_URL}/area/load`, {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ district, regency, load_all: loadAll }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`loadArea failed (${resp.status}): ${detail}`);
  }
  return resp.json();
}

// === Intent Extraction ===

export interface IntentResult {
  area: string | null;
  poi: string | null;
  tags: string[];
  gender: string | null;
  budget_min: number | null;
  budget_max: number | null;
  keywords: string[];
}

export async function extractIntent(query: string): Promise<IntentResult> {
  try {
    const resp = await fetch(`${API_URL}/intent`, {
      method: "POST",
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (resp.ok) return resp.json();
  } catch {
    // fall through to empty
  }
  return { area: null, poi: null, tags: [], gender: null, budget_min: null, budget_max: null, keywords: [] };
}

// === POI Resolution ===

export interface PoiResolveResult {
  lat: number;
  lon: number;
  display_name: string;
  regency: string;
  province: string;
  district: string | null;
  districts: Array<{ name: string; postalCodes?: number[] }>;
  // Province/regency drill-down (broad-region POI like "sekitar Papua Barat")
  broad_region?: boolean;
  region_type?: "province" | "regency";
  region?: string;
  regions?: string[];
  message?: string;
}

export async function resolvePoi(query: string): Promise<PoiResolveResult | null> {
  try {
    const resp = await fetch(`${API_URL}/poi/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (resp.ok) return resp.json();
  } catch {
    // fall through
  }
  return null;
}

// === Area Switcher ===

export interface AreaEntry {
  regency: string;
  province: string;
}

export async function listAreas(query = ""): Promise<AreaEntry[]> {
  try {
    const resp = await fetch(`${API_URL}/locations/areas?q=${encodeURIComponent(query)}`);
    if (resp.ok) {
      const data = await resp.json();
      return data.areas || [];
    }
  } catch {
    // fall through
  }
  return [];
}
// Phase 5 wires the SQLite-backed `/searches` endpoint. The HTTP path is now
// enabled; localStorage remains as a fallback if the backend is unreachable.
const SAVED_SEARCHES_API_ENABLED = true;

const SAVED_SEARCHES_KEY = "kos-ai.saved-searches";

function readLocal(): SavedSearch[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(SAVED_SEARCHES_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeLocal(items: SavedSearch[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(items));
}

export async function listSavedSearches(): Promise<SavedSearch[]> {
  if (SAVED_SEARCHES_API_ENABLED) {
    try {
      const resp = await fetch(`${API_URL}/searches`, {
        headers: getAuthHeaders(),
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.searches || [];
      }
    } catch {
      // fall through to localStorage
    }
  }
  return readLocal();
}

export async function saveSavedSearch(
  search: SavedSearch
): Promise<SavedSearch> {
  if (SAVED_SEARCHES_API_ENABLED) {
    try {
      const resp = await fetch(`${API_URL}/searches`, {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(search),
      });
      if (resp.ok) return resp.json();
    } catch {
      // fall through
    }
  }

  const items = readLocal();
  items.unshift(search);
  writeLocal(items);
  return search;
}

export async function deleteSavedSearch(id: string): Promise<void> {
  if (SAVED_SEARCHES_API_ENABLED) {
    try {
      const resp = await fetch(`${API_URL}/searches/${id}`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (resp.ok) return;
    } catch {
      // fall through
    }
  }

  const items = readLocal().filter((s) => s.id !== id);
  writeLocal(items);
}

export async function deleteAllSavedSearches(): Promise<number> {
  if (SAVED_SEARCHES_API_ENABLED) {
    try {
      const resp = await fetch(`${API_URL}/searches`, {
        method: "DELETE",
        headers: getAuthHeaders(),
      });
      if (resp.ok) {
        const data = await resp.json();
        return data.deleted_count || 0;
      }
    } catch {
      // fall through
    }
  }

  const items = readLocal();
  writeLocal([]);
  return items.length;
}

// === Settings ===

export interface ProviderSettings {
  provider: string;
  model: string;
  api_key: string;
  base_url: string;
}

const SETTINGS_KEY = "kos-ai.provider-settings";

export function loadSettings(): ProviderSettings {
  if (typeof localStorage === "undefined") return defaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return defaultSettings();
}

export function persistSettings(settings: ProviderSettings): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function defaultSettings(): ProviderSettings {
  return {
    provider: "Z.AI",
    model: "glm-4.5-air",
    api_key: "",
    base_url: "https://api.z.ai/api/coding/paas/v4/",
  };
}

// === Settings (backend-persisted, Phase 4) ===
// Stored in data/settings.json server-side; the RAG engine reads the key/model
// from there. GET returns a masked hint (never the raw key) so the form's
// api_key field starts empty and the user re-types or leaves blank to keep.

export interface BackendSettings {
  provider: string;
  model: string;
  base_url: string;
  api_key_set: boolean;
  api_key_hint: string;
}

export async function getSettings(): Promise<BackendSettings> {
  const resp = await fetch(`${API_URL}/settings`, {
    headers: getAuthHeaders(),
  });
  if (!resp.ok) throw new Error(`getSettings failed (${resp.status})`);
  return resp.json();
}

export async function saveSettings(
  s: ProviderSettings
): Promise<{ ok: boolean }> {
  const resp = await fetch(`${API_URL}/settings`, {
    method: "PUT",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(s),
  });
  if (!resp.ok) throw new Error(`saveSettings failed (${resp.status})`);
  return resp.json();
}

export interface ConnectionTestResult {
  ok: boolean;
  reply?: string;
  error?: string;
}

export async function testConnection(req: {
  api_key: string;
  model: string;
  base_url: string;
}): Promise<ConnectionTestResult> {
  const resp = await fetch(`${API_URL}/settings/test`, {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!resp.ok) throw new Error(`testConnection failed (${resp.status})`);
  return resp.json();
}

export async function listModels(apiKey: string, baseUrl?: string): Promise<string[]> {
  const resp = await fetch(`${API_URL}/settings/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, base_url: baseUrl }),
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.models || [];
}

export interface ServiceStatus {
  ok: boolean;
  url?: string;
  entries?: number;
}
export interface ServicesHealth {
  fastapi: ServiceStatus;
  geo_router: ServiceStatus;
  rag: ServiceStatus;
  all_ok: boolean;
}

export async function getServicesHealth(): Promise<ServicesHealth> {
  const resp = await fetch(`${API_URL}/health/services`);
  if (!resp.ok) throw new Error(`getServicesHealth failed (${resp.status})`);
  return resp.json();
}

/**
 * Pipeline status — check if scrape/process/index is running.
 */
export interface PipelineStatus {
  running: string | null;
  status: "idle" | "scraping" | "processing" | "indexing" | "completed";
  queued: string | null;
  progress: string | null;
  elapsed_seconds: number | null;
}

export async function getPipelineStatus(): Promise<PipelineStatus> {
  const resp = await fetch(`${API_URL}/pipeline/status`, {
    headers: getAuthHeaders(),
  });
  if (!resp.ok) throw new Error(`Status check failed (${resp.status})`);
  return resp.json();
}

// === Query Resolution (backend single-source-of-truth) ===

export interface ResolveSearchArea {
  kind: "area";
  name: string;
}
export interface ResolveSearchRegion {
  kind: "region";
  region_type: "province" | "regency";
  region: string;
  province?: string;
  regions: string[];
}
export type ResolveSearchResult = ResolveSearchArea | ResolveSearchRegion | { kind: "none" };

/**
 * Resolve a natural-language query to a specific area or a broad-region
 * drill-down via the backend `_resolve_query` (handles ~38 provinces,
 * abbreviations, kabupaten, arbitrary kecamatan). Used by the frontend when
 * its lightweight extractArea regex misses.
 */
export async function resolveSearchQuery(query: string): Promise<ResolveSearchResult> {
  const resp = await fetch(`${API_URL}/search/resolve`, {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!resp.ok) return { kind: "none" };
  return resp.json();
}

// === Pipeline Data (per-area inventory) ===

export type ScrapeCodeStatus = "waiting" | "running" | "completed" | "failed";

export interface ScrapeCode {
  code: number;
  status: ScrapeCodeStatus;
  count?: number;
  error?: string | null;
  updated_at?: number;
}

export type ScrapeAreaStatus = "scraping" | "completed" | "partial" | "failed";

export interface PipelineArea {
  area: string;
  scraped: boolean;
  processed: boolean;
  indexed: boolean;
  postal_codes: number;
  scraped_count: number;
  docs_count: number | null;
  indexed_count: number;
  scrape_date: number | null;
  scrape_status?: ScrapeAreaStatus | null;
  codes?: ScrapeCode[];
}

export interface PipelineTotals {
  areas: number;
  scraped: number;
  processed: number;
  indexed: number;
  total_kos: number;
}

export interface PipelineDataResponse {
  areas: PipelineArea[];
  pipeline: PipelineStatus;
  totals: PipelineTotals;
}

/**
 * Per-area pipeline inventory: what's been scraped / processed / indexed.
 * Admin-only endpoint (see api/src/pipeline_data.py).
 */
export async function getPipelineData(): Promise<PipelineDataResponse> {
  const resp = await fetch(`${API_URL}/pipeline/data`, {
    headers: getAuthHeaders(),
  });
  if (!resp.ok) throw new Error(`getPipelineData failed (${resp.status})`);
  return resp.json();
}

// === Pipeline Actions (Sprint 9 — admin-only) ===

export interface PipelineActionResponse {
  success: boolean;
  pipeline_started?: boolean;
  pipeline_queued?: boolean;
  pipeline_blocked?: boolean;
  message?: string;
  pipeline?: PipelineStatus;
  removed_from_index?: number;
  docs_deleted?: boolean;
  raw_deleted?: boolean;
}

async function pipelineAction(path: string, area: string, extra: Record<string, unknown> = {}): Promise<PipelineActionResponse> {
  const resp = await fetch(`${API_URL}/pipeline/${path}`, {
    method: "POST",
    headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ area, ...extra }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Pipeline ${path} failed (${resp.status}): ${detail}`);
  }
  return resp.json();
}

/** Process + index an already-scraped area (skip scrape). */
export const indexArea = (area: string) => pipelineAction("index", area);
/** Reprocess + reingest — fix data quality without re-scraping. */
export const rebuildArea = (area: string) => pipelineAction("rebuild", area);
/** Full re-scrape → process → index. Expensive (Google Maps). */
export const rescrapeArea = (area: string) => pipelineAction("rescrape", area);
/** Resume/retry — re-scrape only missing/failed postal codes (or one `code`),
 * then process + index. Safe to repeat. */
export const resumeArea = (area: string, code?: number) =>
  pipelineAction("resume", area, code != null ? { code } : {});
/** Delete an area's index + docs. wipe_raw=true also removes raw data. */
export const deleteArea = (area: string, wipe_raw = false) =>
  pipelineAction("delete", area, { wipe_raw });

export { API_URL };
