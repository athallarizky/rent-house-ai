import type { KodeposEntry, ExpandResult } from "./types.js";

export function expand(data: KodeposEntry[], regencyQuery: string): ExpandResult | null {
  const entries = data.filter(
    (e) => e.regency.toLowerCase() === regencyQuery.toLowerCase()
  );

  if (entries.length === 0) return null;

  const province = entries[0].province;
  const regency = entries[0].regency;
  const districts = [...new Set(entries.map((e) => e.district))].sort();

  return {
    regency,
    province,
    districts,
  };
}
