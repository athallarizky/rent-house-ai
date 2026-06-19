import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { Star } from "lucide-react";
import type { KosResult } from "../lib/types";
import { tagLabel } from "../lib/types";

// Fix default marker icon under bundlers (Vite/React).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface MapViewProps {
  markers: KosResult[];
  selected?: KosResult | null;
  onMarkerClick?: (kos: KosResult) => void;
  center?: [number, number];
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
}: MapViewProps) {
  const valid = markers.filter(
    (m) => typeof m.lat === "number" && typeof m.lon === "number"
  );

  const defaultCenter: [number, number] =
    center ||
    (valid[0] ? [valid[0].lat, valid[0].lon] : [-6.147, 106.727]);

  return (
    <div className="h-full w-full">
      <MapContainer
        center={defaultCenter}
        zoom={14}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <Recenter center={selected ? [selected.lat, selected.lon] : center} />
        {valid.map((m) => (
          <Marker
            key={m.place_id || m.name}
            position={[m.lat, m.lon]}
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
        ))}
      </MapContainer>
    </div>
  );
}
