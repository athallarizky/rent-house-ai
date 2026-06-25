import Fastify from "fastify";
import { Worker } from "node:worker_threads";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { KodeposEntry } from "./types.js";
import { resolveExact, resolveFuzzy, type FuzzyEntry } from "./resolve.js";
import { expand } from "./expand.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadData(): KodeposEntry[] {
  const dataPath = join(__dirname, "..", "kodepos", "data", "kodepos.json");
  const raw = readFileSync(dataPath, "utf-8");
  return JSON.parse(raw) as KodeposEntry[];
}

// ============================================================
// Fuse search worker — keeps the expensive fuzzy search off the
// event loop so a heavy query can't stall /health or other resolves.
// ============================================================
type FuzzyItem = { regency: string; district: string; province: string };

const searchWorker = new Worker(new URL("./search-worker.ts", import.meta.url));
let nextReqId = 1;
const pending = new Map<number, (items: FuzzyItem[]) => void>();
let readyResolve: (() => void) | undefined;
const workerReady = new Promise<void>((resolve) => {
  readyResolve = resolve;
});

searchWorker.on("message", (msg: { ready?: boolean; id?: number; items?: FuzzyItem[] }) => {
  if (msg.ready) {
    readyResolve?.();
    return;
  }
  if (msg.id !== undefined) {
    const cb = pending.get(msg.id);
    if (cb) {
      pending.delete(msg.id);
      cb(msg.items ?? []);
    }
  }
});
// If the worker dies before signalling ready, unblock waiters so fuzzy queries
// degrade to "not found" (via the per-request timeout) instead of hanging the
// whole server. Exact resolves keep working regardless.
searchWorker.on("error", (err) => {
  console.error("search-worker error:", err);
  readyResolve?.();
});

async function searchAsync(q: string, limit = 20): Promise<FuzzyItem[]> {
  await workerReady;
  return new Promise((resolvePromise) => {
    const id = nextReqId++;
    // Hard cap so a dead/slow worker can never wedge a request.
    const timer = setTimeout(() => {
      pending.delete(id);
      resolvePromise([]);
    }, 12000);
    pending.set(id, (items) => {
      clearTimeout(timer);
      resolvePromise(items);
    });
    searchWorker.postMessage({ id, q, limit });
  });
}

// ============================================================
// Tiny LRU cache — the search page resolves the same area on every
// interaction; caching makes those instant and removes load entirely.
// ============================================================
const CACHE_CAP = 512;
const cache = new Map<string, unknown>();

function cacheGet<T>(key: string): T | undefined {
  if (!cache.has(key)) return undefined;
  const v = cache.get(key) as T;
  cache.delete(key);
  cache.set(key, v); // refresh recency
  return v;
}

function cacheSet(key: string, value: unknown): void {
  if (cache.has(key)) cache.delete(key);
  else if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value as string);
  cache.set(key, value);
}

async function main() {
  console.log("Loading kodepos data...");
  const rawData = loadData();
  console.log(`  ${rawData.length} entries loaded`);
  const regencyNames = new Set(rawData.map((e) => e.regency.toLowerCase()));

  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ status: "ok", entries: rawData.length }));

  app.get("/resolve", async (request) => {
    const { q } = request.query as { q?: string };
    if (!q) {
      return { success: false, error: "Missing query parameter: q" };
    }

    const cacheKey = "r:" + q.trim().toLowerCase();
    const cached = cacheGet<unknown>(cacheKey);
    if (cached !== undefined) return cached;

    const step = resolveExact(rawData, q, regencyNames);
    let result;
    if (step.done) {
      result = step.result;
    } else {
      const items = await searchAsync(step.aliased, 20);
      result = resolveFuzzy(rawData, q, step.aliased, items as FuzzyEntry[], regencyNames);
    }

    const resp = result
      ? { success: true, data: result }
      : { success: false, error: `Location not found: "${q}". Try a different spelling or broader area.` };
    cacheSet(cacheKey, resp);
    return resp;
  });

  app.get("/expand", async (request) => {
    const { q } = request.query as { q?: string };
    if (!q) {
      return { success: false, error: "Missing query parameter: q" };
    }

    const cacheKey = "x:" + q.trim().toLowerCase();
    const cached = cacheGet<unknown>(cacheKey);
    if (cached !== undefined) return cached;

    // Resolve first (exact-first, Fuse via worker), then expand the regency.
    const step = resolveExact(rawData, q, regencyNames);
    let resolved;
    if (step.done) {
      resolved = step.result;
    } else {
      const items = await searchAsync(step.aliased, 20);
      resolved = resolveFuzzy(rawData, q, step.aliased, items as FuzzyEntry[], regencyNames);
    }
    if (!resolved) {
      const resp = { success: false, error: `Regency not found: "${q}"` };
      cacheSet(cacheKey, resp);
      return resp;
    }

    const result = expand(rawData, resolved.regency);
    const resp = result
      ? { success: true, data: result }
      : { success: false, error: `Could not expand regency: "${resolved.regency}"` };
    cacheSet(cacheKey, resp);
    return resp;
  });

  const port = parseInt(process.env.PORT ?? "3001");
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Geo-Router running on http://localhost:${port}`);
  console.log(`  GET /resolve?q=Jakarta+Barat`);
  console.log(`  GET /resolve?q=Cengkareng`);
  console.log(`  GET /expand?q=Jakarta+Barat`);
  console.log(`  GET /health`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
