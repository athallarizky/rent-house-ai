import { useMemo } from "react";
import { List, Map as MapIcon, Sparkles, Clock, ArrowRight } from "lucide-react";
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
        <div className="flex-1 flex items-center justify-center px-6 py-8">
          {/* Tips: fetching data baru butuh waktu lama (satu-satunya konten
              saat list kosong — dibuat cukup besar agar panel tidak kosong) */}
          <div className="w-full max-w-md rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 p-6">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/60 flex items-center justify-center">
                <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="text-sm leading-relaxed text-blue-900 dark:text-blue-200">
                <p className="font-semibold mb-1.5">Baru pertama kali cari di area ini?</p>
                <p className="text-blue-700/90 dark:text-blue-300/80 text-[13px]">
                  Kalau datanya belum ada, sistem lagi ngumpulin kos dari Google Maps.
                  Prosesnya jalan di <strong>background</strong> dan bisa lumayan lama —
                  biasanya beberapa menit, tergantung luas area. Kamu boleh tetap
                  membuka halaman lain, data akan otomatis muncul begitu siap.
                </p>
                <a
                  href="/pipeline"
                  className="inline-flex items-center gap-1.5 mt-4 text-[13px] font-semibold text-blue-700 dark:text-blue-300 hover:underline"
                >
                  Cek status Pipeline <ArrowRight className="w-3.5 h-3.5" />
                </a>
                <p className="text-[11px] text-blue-600/70 dark:text-blue-400/60 mt-2">
                  Tip: area yg sudah pernah dicari akan dimuat dalam hitungan detik.
                </p>
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
            relevantIds={relevantIds}
          />
        </div>
      )}
    </div>
  );
}
