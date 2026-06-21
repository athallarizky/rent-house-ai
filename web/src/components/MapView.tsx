import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Star } from "lucide-react";
import type { KosResult } from "../lib/types";
import { tagLabel } from "../lib/types";

const RED = "#ef4444";
const GREY = "#94a3b8";

/** Custom SVG teardrop pin as a Leaflet divIcon. Color distinguishes
 *  relevant/recommended kos (red) from the rest (grey). */
function makePinIcon(color: string, selected: boolean = false) {
  const w = selected ? 28 : 22;
  const h = Math.round(w * 1.33);
  const ring = selected
    ? `<circle cx="12" cy="12" r="9" fill="none" stroke="#3b82f6" stroke-width="3" opacity="0.8"/>`
    : "";
  const html = `<svg width="${w}" height="${h}" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z"
          fill="${color}" stroke="white" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="4.5" fill="white"/>
    ${ring}
  </svg>`;
  return L.divIcon({ html, className: "", iconSize: [w, h], iconAnchor: [w / 2, h], popupAnchor: [0, -h + 4] });
}

interface MapViewProps {
  markers: KosResult[];
  selected?: KosResult | null;
  onMarkerClick?: (kos: KosResult) => void;
  center?: [number, number];
  relevantIds?: Set<string>;
}

/** Keep the map sized to its container (handles mount + panel resize/toggle). */
function AutoResize() {
  const map = useMap();
  useEffect(() => {
    const r = () => map.invalidateSize();
    r();
    const t = setTimeout(r, 100);
    const ro = new ResizeObserver(r);
    ro.observe(map.getContainer());
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [map]);
  return null;
}

function Recenter({ center }: { center?: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, Math.max(map.getZoom(), 14));
  }, [center, map]);
  return null;
}

export default function MapView({
  markers,
  selected,
  onMarkerClick,
  center,
  relevantIds,
}: MapViewProps) {
  const valid = markers.filter(
    (m) => typeof m.lat === "number" && typeof m.lon === "number"
  );

  // Pre-build the 3 icon variants (relevant=red, non-relevant=grey, selected=red+ring).
  const icons = useMemo(() => ({
    relevant: makePinIcon(RED, false),
    relevantSel: makePinIcon(RED, true),
    normal: makePinIcon(GREY, false),
    normalSel: makePinIcon(GREY, true),
  }), []);

  const defaultCenter: [number, number] =
    center ||
    (valid[0] ? [valid[0].lat, valid[0].lon] : [-6.147, 106.727]);

  return (
    <MapContainer
      center={defaultCenter}
      zoom={14}
      scrollWheelZoom={false}
      style={{ height: "100%", width: "100%" }}
    >
      <AutoResize />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <Recenter center={selected ? [selected.lat, selected.lon] : center} />
      {valid.map((m) => {
        const isRelevant = !relevantIds || relevantIds.has(m.place_id);
        const isSelected = selected?.place_id === m.place_id;
        const icon = isRelevant
          ? (isSelected ? icons.relevantSel : icons.relevant)
          : (isSelected ? icons.normalSel : icons.normal);
        return (
        <Marker
          key={m.place_id || m.name}
          position={[m.lat, m.lon]}
          icon={icon}
          eventHandlers={{ click: () => onMarkerClick?.(m) }}
        >
          <Popup>
            <div className="min-w-[160px]">
              <div className="font-semibold text-sm flex items-center gap-1">
                {m.name}
                <span className="text-amber-500 flex items-center gap-0.5">
                  <Star className="w-3 h-3 fill-amber-500" />
                  {typeof m.rating === "number" ? m.rating.toFixed(1) : m.rating}
                </span>
              </div>
              {m.kecamatan && (
                <div className="text-xs text-slate-500">{m.kecamatan}</div>
              )}
              {m.tags?.length > 0 && (
                <div className="text-xs text-slate-600 mt-1">
                  {m.tags.slice(0, 5).map(tagLabel).join(" · ")}
                </div>
              )}
            </div>
          </Popup>
        </Marker>
        );
      })}
    </MapContainer>
  );
}
