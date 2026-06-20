import { useMemo } from "react";
import { List, Map as MapIcon, SearchX, Sparkles, Clock, ArrowRight } from "lucide-react";
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
  relevantIds?: Set<string>;
  relevantOnly?: boolean;
  onToggleRelevantOnly?: () => void;
}

function kosId(kos: KosResult, i: number): string {
  return kos.place_id || `${kos.name}-${i}`;
}

export default function KosCardList({
  results,
  selectedKos,
  mode,
  onModeChange,
  onSelectKos,
  isLoading = false,
  relevantIds,
  relevantOnly = false,
  onToggleRelevantOnly,
}: KosCardListProps) {
  const hasRelevance = !!relevantIds && relevantIds.size > 0;

  const visible = useMemo<KosResult[]>(() => {
    let list: KosResult[] = results;
    if (relevantOnly && hasRelevance) {
      list = results.filter((r) => relevantIds!.has(r.place_id));
    }
    if (!hasRelevance) return list;
    // relevant first (by score desc), then the rest by rating desc
    return [...list].sort((a: KosResult, b: KosResult) => {
      const ar = relevantIds!.has(a.place_id) ? 1 : 0;
      const br = relevantIds!.has(b.place_id) ? 1 : 0;
      if (ar !== br) return br - ar;
      if (ar && br) return (b.score || 0) - (a.score || 0);
      return (b.rating || 0) - (a.rating || 0);
    });
  }, [results, relevantIds, relevantOnly, hasRelevance]);

  const count = results.length;

  const header = (
    <div className="border-b border-border bg-card">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {count > 0 ? `${count} kos` : "Hasil"}
          {hasRelevance && (
            <span className="text-primary"> · {relevantIds!.size} relevan</span>
          )}
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
      {hasRelevance && onToggleRelevantOnly && (
        <button
          type="button"
          onClick={onToggleRelevantOnly}
          className={cn(
            "w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium border-t transition-colors",
            relevantOnly
              ? "bg-primary/10 text-primary border-primary/20"
              : "text-muted-foreground hover:text-foreground border-border"
          )}
        >
          <Sparkles className="w-3 h-3" />
          {relevantOnly ? "Menampilkan kos relevan saja" : `Fokus ke ${relevantIds.size} kos relevan`}
        </button>
      )}
    </div>
  );

  if (isLoading && count === 0) {
    return (
      <div className="h-full flex flex-col">
        {header}
        <div className="flex-1 overflow-y-auto thin-scroll p-3 space-y-2">
          {[...Array(6)].map((_, i) => (
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
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6 text-muted-foreground gap-4">
          <div className="flex flex-col items-center">
            <SearchX className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">Belum ada kos</p>
            <p className="text-xs mt-1">
              Pilih district atau ubah filter untuk melihat kos.
            </p>
          </div>

          {/* Tips: fetching data baru butuh waktu lama */}
          <div className="w-full max-w-sm rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 p-3 text-left">
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed text-blue-900 dark:text-blue-200">
                <p className="font-medium mb-0.5">Baru pertama kali cari di area ini?</p>
                <p className="text-blue-700/90 dark:text-blue-300/80">
                  Kalau datanya belum ada, sistem lagi ngumpulin kos dari Google Maps.
                  Prosesnya jalan di background dan bisa lumayan lama (beberapa menit).
                  Kamu bisa lihat progress-nya di halaman Pipeline.
                </p>
                <a
                  href="/pipeline"
                  className="inline-flex items-center gap-1 mt-2 font-medium text-blue-700 dark:text-blue-300 hover:underline"
                >
                  Cek status Pipeline <ArrowRight className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
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
            {visible.map((kos, i) => {
              const id = kosId(kos, i);
              return (
                <KosCard
                  key={id}
                  kos={kos}
                  relevant={hasRelevance && relevantIds!.has(kos.place_id)}
                  onClick={() => onSelectKos(kos)}
                />
              );
            })}
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
