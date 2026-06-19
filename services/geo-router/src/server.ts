import Fastify from "fastify";
import Fuse from "fuse.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { KodeposEntry } from "./types.js";
import { resolve } from "./resolve.js";
import { expand } from "./expand.js";
import { isPoi } from "./classify.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadData(): KodeposEntry[] {
  const dataPath = join(__dirname, "..", "kodepos", "data", "kodepos.json");
  const raw = readFileSync(dataPath, "utf-8");
  return JSON.parse(raw) as KodeposEntry[];
}

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

async function main() {
  console.log("Loading kodepos data...");
  const rawData = loadData();
  console.log(`  ${rawData.length} entries loaded`);

  const entries: (KodeposEntry & { fulltext: string; searchText: string })[] = rawData.map((e) => ({
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

  const regencyNames = new Set(rawData.map((e) => e.regency.toLowerCase()));

  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ status: "ok", entries: entries.length }));

  app.get("/resolve", async (request) => {
    const { q } = request.query as { q?: string };
    if (!q) {
      return { success: false, error: "Missing query parameter: q" };
    }

    if (isPoi(q)) {
      return { success: true, data: { type: "POI", query: q } };
    }

    const result = resolve(fuse, rawData, q, regencyNames);
    if (result) {
      return { success: true, data: result };
    }

    return {
      success: false,
      error: `Location not found: "${q}". Try a different spelling or broader area.`,
    };
  });

  app.get("/expand", async (request) => {
    const { q } = request.query as { q?: string };
    if (!q) {
      return { success: false, error: "Missing query parameter: q" };
    }

    const resolved = resolve(fuse, rawData, q, regencyNames);
    if (!resolved) {
      return { success: false, error: `Regency not found: "${q}"` };
    }

    const result = expand(rawData, resolved.regency);
    if (!result) {
      return { success: false, error: `Could not expand regency: "${resolved.regency}"` };
    }

    return { success: true, data: result };
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
