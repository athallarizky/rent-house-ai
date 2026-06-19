import Fuse from "fuse.js";
import type { KodeposEntry, ResolveResult, District } from "./types.js";
import { resolveAlias } from "./alias.js";
import { isPoi } from "./classify.js";

export function resolve(
  fuse: Fuse<KodeposEntry>,
  data: KodeposEntry[],
  query: string,
  regencyNames?: Set<string>
): ResolveResult | null {
  const aliased = resolveAlias(query);

  if (isPoi(aliased)) return null;

  if (regencyNames?.has(aliased.toLowerCase())) {
    const regencyEntries = data.filter((e) => e.regency.toLowerCase() === aliased.toLowerCase());
    if (regencyEntries.length > 0) {
      return buildRegencyResult(data, query, regencyEntries[0].regency, regencyEntries[0].province);
    }
  }

  const results = fuse.search(aliased, { limit: 20 });
  if (results.length === 0) return null;

  const entries = results.map((r) => r.item);

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

function buildRegencyResult(
  data: KodeposEntry[],
  query: string,
  regency: string,
  province: string
): ResolveResult {
  const districtMap = new Map<string, District>();
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

function findBestMatch(entries: KodeposEntry[], field: "regency" | "district"): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const value = e[field];
    counts.set(value, (counts.get(value) ?? 0) + 1);
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
