import Fuse from "fuse.js";
import type { KodeposEntry } from "./types.js";

const POI_INDICATORS = [
  "stasiun", "terminal", "bandara", "pelabuhan",
  "mall", "plaza", "pasar", "taman",
  "universitas", "kampus", "sekolah", "rumah sakit",
  "hotel", "apartemen", "gedung", "monumen",
  "museum", "masjid", "gereja", "candi",
  "pom bensin", "spbu", "restoran",
];

export function isPoi(query: string): boolean {
  const lower = query.toLowerCase().trim();
  return POI_INDICATORS.some((indicator) => lower.includes(indicator));
}

export function isArea(fuse: Fuse<KodeposEntry>, query: string): boolean {
  const result = fuse.search(query, { limit: 1 });
  return result.length > 0 && (result[0].score ?? 1) < 0.6;
}
