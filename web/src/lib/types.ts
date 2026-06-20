export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  isPicker?: boolean;
  districts?: District[];
}

export interface District {
  name: string;
  postalCodes?: number[];
  villages?: Array<{ name: string; code: number; lat: number; lon: number }>;
}

export interface SavedSearch {
  id: string;
  query_text: string;
  area: string;
  result_count: number;
  created_at: string;
}

export interface KosResult {
  name: string;
  place_id: string;
  rating: number;
  review_count: number;
  tags: string[];
  gender: string;
  phone: string;
  lat: number;
  lon: number;
  kecamatan: string;
  score: number;
  text: string;
  price_min?: number | null;
  price_max?: number | null;
}

export interface SearchRequest {
  query: string;
  area?: string;
  regency?: string;
  top_k?: number;
  force_scrape?: boolean;
  stream?: boolean;
}

export interface SearchPipeline {
  area?: string;
  regency?: string;
  province?: string;
  scrape?: string;
  scrape_age_days?: number;
  process?: string;
  index?: string;
  [key: string]: string | number | undefined;
}

export interface SearchResponse {
  success: boolean;
  query: string;
  pipeline?: SearchPipeline;
  results: KosResult[];
  summary: string;
}

export interface ResolveLocationResponse {
  success: boolean;
  data: {
    type: "AREA" | "POI";
    query: string;
    matchedAs?: string;
    province?: string;
    regency?: string;
    districts?: District[];
  };
  error?: string;
}

export interface ExpandLocationResponse {
  success: boolean;
  data: {
    regency: string;
    province: string;
    districts: string[];
  };
  error?: string;
}

export interface AreaLoadResponse {
  success: boolean;
  district: string;
  regency: string;
  province: string;
  siblings: District[];
  dataset: KosResult[];
  pipeline?: SearchPipeline;
  error?: string;
}

export interface HealthResponse {
  status: string;
  version?: string;
  entries?: number;
  [key: string]: unknown;
}

export interface Filters {
  wifi: boolean;
  ac: boolean;
  parkir: boolean;
  dapur: boolean;
  kamar_mandi_dalam: boolean;
  gender: "putra" | "putri" | "campur" | null;
  budget: string | null;
  [key: string]: boolean | "putra" | "putri" | "campur" | string | null;
}

export type RightPanelMode = "list" | "map";

export const TAG_LABELS: Record<string, string> = {
  wifi: "WiFi",
  ac: "AC",
  parkir: "Parkir",
  dapur: "Dapur",
  kamar_mandi_dalam: "KM Dalam",
  laundry: "Laundry",
  tv: "TV",
  kasur: "Kasur",
  lemari: "Lemari",
  listrik: "Listrik",
  keamanan: "Keamanan",
  bersama: "Bersama",
};

export const TAG_CHIP_STYLES: Record<string, string> = {
  wifi: "bg-green-100 text-green-700",
  ac: "bg-blue-100 text-blue-700",
  parkir: "bg-amber-100 text-amber-700",
  dapur: "bg-orange-100 text-orange-700",
  kamar_mandi_dalam: "bg-purple-100 text-purple-700",
  laundry: "bg-pink-100 text-pink-700",
};

export function tagChipClass(tag: string): string {
  return TAG_CHIP_STYLES[tag] || "bg-slate-100 text-slate-700";
}

export function tagLabel(tag: string): string {
  return TAG_LABELS[tag] || tag;
}
