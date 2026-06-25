/**
 * Fuse search worker.
 *
 * The Fuse index over ~84k kodepos entries (with a large `fulltext` field) is
 * expensive to search — a single fuzzy query can take 1-2s, and because Fuse
 * runs synchronously it would block the Fastify event loop, starving every
 * other request (the root cause of "Geo-router unavailable: timed out").
 *
 * This worker owns the Fuse index and runs searches on its OWN thread. The main
 * server keeps the cheap exact-match path on the event loop; only fuzzy queries
 * round-trip through here, so /health and exact resolves stay instantly
 * responsive even while a heavy search is running.
 */
import { parentPort } from "node:worker_threads";
import Fuse from "fuse.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { KodeposEntry } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "..", "kodepos", "data", "kodepos.json");
const rawData: KodeposEntry[] = JSON.parse(readFileSync(dataPath, "utf-8"));

function createFullText(entry: KodeposEntry): string {
  const keys = [String(entry.code), entry.village, entry.district, entry.regency, entry.province];
  const parts: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = 0; j < keys.length; j++) {
      if (i !== j) {
        parts.push(`${keys[i]} ${keys[j]}`);
      }
    }
  }
  return parts.join(" ");
}

const entries = rawData.map((e) => ({
  ...e,
  fulltext: createFullText(e),
  searchText: `${e.regency} ${e.district} ${e.village} ${e.province} ${e.code}`,
}));

const fuse = new Fuse(entries, {
  keys: [
    { name: "searchText", weight: 0.6 },
    { name: "fulltext", weight: 0.4 },
  ],
  includeScore: true,
  threshold: 0.3,
  shouldSort: true,
  ignoreLocation: true,
});

type FuzzyItem = { regency: string; district: string; province: string };

parentPort?.postMessage({ ready: true });

parentPort?.on("message", (req: { id: number; q: string; limit?: number }) => {
  const results = fuse.search(req.q, { limit: req.limit ?? 20 });
  // Only the fields resolveFuzzy() needs — keep the message tiny.
  const items: FuzzyItem[] = results.map((r) => ({
    regency: r.item.regency,
    district: r.item.district,
    province: r.item.province,
  }));
  parentPort?.postMessage({ id: req.id, items });
});
