import type {
  SearchRequest,
  SearchResponse,
  ResolveLocationResponse,
  ExpandLocationResponse,
  HealthResponse,
  SavedSearch,
  AreaLoadResponse,
} from "./types";

const API_URL =
  (import.meta.env.PUBLIC_API_URL as string | undefined) || "http://localhost:8080";

/**
 * Non-streaming kos search.
 */
export async function searchKos(req: SearchRequest): Promise<SearchResponse> {
  const resp = await fetch(`${API_URL}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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
  if (!resp.ok) throw new Error(`resolveLocation failed (${resp.status})`);
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
  regency?: string
): Promise<AreaLoadResponse> {
  const resp = await fetch(`${API_URL}/area/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ district, regency }),
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (resp.ok) return resp.json();
  } catch {
    // fall through to empty
  }
  return { area: null, tags: [], gender: null, budget_min: null, budget_max: null, keywords: [] };
}

// === Saved Searches ===
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
      const resp = await fetch(`${API_URL}/searches`);
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
        headers: { "Content-Type": "application/json" },
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
  const resp = await fetch(`${API_URL}/settings`);
  if (!resp.ok) throw new Error(`getSettings failed (${resp.status})`);
  return resp.json();
}

export async function saveSettings(
  s: ProviderSettings
): Promise<{ ok: boolean }> {
  const resp = await fetch(`${API_URL}/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
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

export { API_URL };
