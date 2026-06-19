import { List, Map as MapIcon, SearchX } from "lucide-react";
import type { KosResult, RightPanelMode } from "../lib/types";
import KosCard from "./KosCard";
import KosDetail from "./KosDetail";
import MapView from "./MapView";
import { cn } from "../lib/utils";

interface KosCardListProps {
  results: KosResult[];
  selectedKos: KosResult | null;
  mode: RightPanelMode;
  onModeChange: (mode: RightPanelMode) => void;
  onSelectKos: (kos: KosResult | null) => void;
  isLoading?: boolean;
}

export default function KosCardList({
  results,
  selectedKos,
  mode,
  onModeChange,
  onSelectKos,
  isLoading = false,
}: KosCardListProps) {
  const count = results.length;

  const header = (
    <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-card">
      <span className="text-xs font-medium text-muted-foreground">
        {count > 0 ? `${count} kos ditemukan` : "Hasil"}
      </span>
      <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
        <button
          type="button"
          onClick={() => onModeChange("list")}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
            mode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <List className="w-3.5 h-3.5" />
          List
        </button>
        <button
          type="button"
          onClick={() => onModeChange("map")}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
            mode === "map" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <MapIcon className="w-3.5 h-3.5" />
          Map
        </button>
      </div>
    </div>
  );

  if (isLoading && count === 0) {
    return (
      <div className="h-full flex flex-col">
        {header}
        <div className="flex-1 overflow-y-auto thin-scroll p-3 space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-3 animate-pulse">
              <div className="h-3.5 bg-muted rounded w-2/3 mb-2" />
              <div className="h-2.5 bg-muted rounded w-1/3 mb-3" />
              <div className="flex gap-1">
                <div className="h-4 w-10 bg-muted rounded-full" />
                <div className="h-4 w-10 bg-muted rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className="h-full flex flex-col">
        {header}
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 text-muted-foreground">
          <SearchX className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm font-medium">Belum ada hasil</p>
          <p className="text-xs mt-1">
            Mulai pencarian untuk melihat kos di panel ini.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {header}

      {mode === "list" ? (
        selectedKos ? (
          <KosDetail kos={selectedKos} onBack={() => onSelectKos(null)} />
        ) : (
          <div className="flex-1 overflow-y-auto thin-scroll p-3 space-y-2">
            {results.map((kos, i) => (
              <KosCard
                key={kos.place_id || `${kos.name}-${i}`}
                kos={kos}
                onClick={() => onSelectKos(kos)}
              />
            ))}
          </div>
        )
      ) : (
        <div className="flex-1 min-h-0 relative">
          <MapView
            markers={results}
            selected={selectedKos}
            onMarkerClick={(k) => onSelectKos(k)}
          />
        </div>
      )}
    </div>
  );
}
