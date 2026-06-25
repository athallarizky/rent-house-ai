import Fuse from "fuse.js";
import type { KodeposEntry, ResolveResult } from "./types.js";
import { resolveAlias } from "./alias.js";
import { isPoi } from "./classify.js";

/** Minimal slice of an entry needed to finish a fuzzy resolution. */
export type FuzzyEntry = Pick<KodeposEntry, "regency" | "district" | "province">;

/**
 * Outcome of the exact (cheap, no-Fuse) resolution stage.
 *  - `{ done: true, result }`  : resolved definitively (a hit, or `null` = not found / POI)
 *  - `{ done: false, aliased }`: nothing exact matched — caller should run Fuse with `aliased`.
 */
export type ResolveStep =
  | { done: true; result: ResolveResult | null }
  | { done: false; aliased: string };

/**
 * Cheap exact resolution — regency-exact, then district-exact, then POI guard.
 * Everything here is O(n) scanning (fast) and never touches Fuse, so it is safe
 * to run on the event loop. Returns `done:false` when a fuzzy search is needed.
 */
export function resolveExact(
  data: KodeposEntry[],
  query: string,
  regencyNames?: Set<string>
): ResolveStep {
  const aliased = resolveAlias(query);

  // Known regency wins first — a regency-level query like "Bandung" must yield
  // the multi-district picker, not some unrelated district that happens to share
  // the name (there IS a district "Bandung" in Tulungagung).
  if (regencyNames?.has(aliased.toLowerCase())) {
    const regencyEntries = data.filter((e) => e.regency.toLowerCase() === aliased.toLowerCase());
    if (regencyEntries.length > 0) {
      return {
        done: true,
        result: buildRegencyResult(data, query, regencyEntries[0].regency, regencyEntries[0].province),
      };
    }
  }

  // Exact district-name match next. Avoids two classes of geo-router bugs:
  //  - fuzzy mis-resolve across provinces: "Buahbatu" (Bandung) -> "Blahbatuh" (Gianyar)
  //  - real district names containing POI words: "Kebon Jeruk"
  const exactDistrict = data.find((e) => e.district.toLowerCase() === aliased.toLowerCase());
  if (exactDistrict) {
    return {
      done: true,
      result: buildDistrictResult(data, query, exactDistrict.district, exactDistrict.regency, exactDistrict.province),
    };
  }

  if (isPoi(aliased)) return { done: true, result: null };

  return { done: false, aliased };
}

/**
 * Finish a fuzzy resolution from Fuse result entries (already computed, e.g. in
 * a worker thread). Pure + synchronous — safe on the event loop.
 */
export function resolveFuzzy(
  data: KodeposEntry[],
  query: string,
  aliased: string,
  entries: FuzzyEntry[],
  regencyNames?: Set<string>
): ResolveResult | null {
  if (entries.length === 0) return null;

  const bestRegency = findBestMatch(entries, "regency");
  const bestDistrict = findBestMatch(entries, "district");
  const province = entries[0].province;

  const isExactRegency = regencyNames?.has(aliased.toLowerCase()) ?? false;
  const regencyCount = entries.filter((e) => e.regency === bestRegency).length;
  const districtCount = entries.filter((e) => e.district === bestDistrict).length;

  const isRegencyQuery =
    isExactRegency ||
    aliased.toLowerCase().startsWith("administrasi") ||
    /^(jakarta|jakbar|jaksel|jaktim|jakpus|jakut)\b/i.test(aliased) ||
    (regencyCount > districtCount * 1.5);

  if (isRegencyQuery) {
    return buildRegencyResult(data, query, bestRegency, province);
  }

  return buildDistrictResult(data, query, bestDistrict, bestRegency, province);
}

/**
 * Synchronous resolve using an in-process Fuse — kept for tests and as a
 * fallback. The server uses the worker-thread path (`resolveExact` +
 * `resolveFuzzy`) so Fuse never blocks the event loop.
 */
export function resolve(
  fuse: Fuse<KodeposEntry>,
  data: KodeposEntry[],
  query: string,
  regencyNames?: Set<string>
): ResolveResult | null {
  const step = resolveExact(data, query, regencyNames);
  if (step.done) return step.result;
  const results = fuse.search(step.aliased, { limit: 20 });
  const entries: FuzzyEntry[] = results.map((r) => r.item);
  return resolveFuzzy(data, query, step.aliased, entries, regencyNames);
}

function buildRegencyResult(
  data: KodeposEntry[],
  query: string,
  regency: string,
  province: string
): ResolveResult {
  const districtMap = new Map<string, ResolveResult["districts"][number]>();
  const regencyEntries = data.filter((e) => e.regency === regency);

  for (const entry of regencyEntries) {
    if (!districtMap.has(entry.district)) {
      districtMap.set(entry.district, { name: entry.district, postalCodes: [], villages: [] });
    }
    const d = districtMap.get(entry.district)!;
    if (!d.postalCodes.includes(entry.code)) d.postalCodes.push(entry.code);
    d.villages.push({ name: entry.village, code: entry.code, lat: entry.latitude, lon: entry.longitude });
  }

  return {
    type: "AREA",
    query,
    matchedAs: regency,
    province,
    regency,
    districts: Array.from(districtMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function buildDistrictResult(
  data: KodeposEntry[],
  query: string,
  district: string,
  regency: string,
  province: string
): ResolveResult {
  const districtEntries = data.filter((e) => e.district === district && e.regency === regency);
  const villages = districtEntries.map((e) => ({
    name: e.village,
    code: e.code,
    lat: e.latitude,
    lon: e.longitude,
  }));
  const postalCodes = [...new Set(districtEntries.map((e) => e.code))].sort();

  return {
    type: "AREA",
    query,
    matchedAs: district,
    province,
    regency,
    districts: [{ name: district, postalCodes, villages }],
  };
}

function findBestMatch(entries: FuzzyEntry[], field: "regency" | "district"): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    counts.set(e[field], (counts.get(e[field]) ?? 0) + 1);
  }
  let best = entries[0][field];
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = value;
    }
  }
  return best;
}
