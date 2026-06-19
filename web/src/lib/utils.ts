import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Baru saja";
  if (diffMins < 60) return `${diffMins}m lalu`;
  if (diffHours < 24) return `${diffHours}j lalu`;
  if (diffDays < 7) return `${diffDays}h lalu`;

  return date.toLocaleDateString("id-ID", { month: "short", day: "numeric" });
}

export function formatClock(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

export function formatDistance(latA: number, lonA: number, latB: number, lonB: number): string {
  const R = 6371;
  const dLat = toRad(latB - latA);
  const dLon = toRad(lonB - lonA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = R * c;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

const KNOWN_AREAS = [
  "cengkareng",
  "jakarta barat",
  "jakarta selatan",
  "jakarta timur",
  "jakarta pusat",
  "jakarta utara",
  "jakarta timur",
  "bandung",
  "surabaya",
  "yogyakarta",
  "tangerang",
  "bekasi",
  "depok",
  "bogor",
  "semarang",
];

export function extractArea(query: string): string | null {
  const lower = query.toLowerCase();
  for (const a of KNOWN_AREAS) {
    if (lower.includes(a)) return a;
  }
  return null;
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
