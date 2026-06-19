import type {
  SearchRequest,
  SearchResponse,
  ResolveLocationResponse,
  ExpandLocationResponse,
  HealthResponse,
  SavedSearch,
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

// === Saved Searches ===
// Phase 5 will add a SQLite-backed `/searches` endpoint. Until then we use
// localStorage exclusively — the HTTP path is gated behind this flag so we
// don't spam 404s against a route that doesn't exist yet. Flip to true once
// the Phase 5 backend ships; the full HTTP code path is already in place.
const SAVED_SEARCHES_API_ENABLED = false;

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
    model: "glm-air",
    api_key: "",
    base_url: "https://api.z.ai/api/paas/v4/",
  };
}

export { API_URL };
