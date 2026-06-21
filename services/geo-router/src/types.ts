export interface KodeposEntry {
  code: number;
  village: string;
  district: string;
  regency: string;
  province: string;
  latitude: number;
  longitude: number;
  elevation: number;
  timezone: string;
}

export interface Village {
  name: string;
  code: number;
  lat: number;
  lon: number;
}

export interface District {
  name: string;
  postalCodes: number[];
  villages: Village[];
}

export interface ResolveResult {
  type: "AREA";
  query: string;
  matchedAs: string;
  province: string;
  regency: string;
  districts: District[];
}

export interface PoiResult {
  type: "POI";
  query: string;
}

export type LocationResult = ResolveResult | PoiResult;

export interface ExpandResult {
  regency: string;
  province: string;
  districts: string[];
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}
