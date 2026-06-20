import { useCallback, useEffect, useRef, useState } from "react";
import {
  MapPin,
  Pickaxe,
  Cog,
  Database,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  getPipelineData,
  type PipelineDataResponse,
  type PipelineArea,
} from "../lib/api";

const LIVE_POLL_MS = 5000;

export default function PipelineDashboard() {
  const [data, setData] = useState<PipelineDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) {
      setRefreshing(true);
    }
    try {
      const result = await getPipelineData();
      setData(result);
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data pipeline");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  // Auto-refresh while a pipeline is running (5s); stop when idle.
  useEffect(() => {
    const running = data?.pipeline?.running != null;
    if (running && !intervalRef.current) {
      intervalRef.current = setInterval(() => fetchData(true), LIVE_POLL_MS);
    } else if (!running && intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (!running && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [data?.pipeline?.running, fetchData]);

  const refresh = () => fetchData();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        Memuat data pipeline…
      </div>
    );
  }

  const totals = data?.totals;
  const pipeline = data?.pipeline;
  const areas = data?.areas ?? [];

  const cards = [
    {
      icon: MapPin,
      label: "Area",
      value: totals?.areas ?? 0,
      accent: "text-blue-600",
    },
    {
      icon: Pickaxe,
      label: "Scraped",
      value: totals?.scraped ?? 0,
      accent: "text-amber-500",
    },
    {
      icon: Cog,
      label: "Processed",
      value: totals?.processed ?? 0,
      accent: "text-purple-500",
    },
    {
      icon: Database,
      label: "Indexed",
      value: totals?.indexed ?? 0,
      accent: "text-green-600",
    },
  ];

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div
              key={i}
              className="rounded-xl border border-border bg-card p-3 sm:p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <Icon className={`w-4 h-4 ${card.accent}`} />
              </div>
              <div className="text-xl sm:text-2xl font-bold tracking-tight mt-2">
                {card.value}
              </div>
              <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">
                {card.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* Live pipeline banner */}
      {pipeline && pipeline.running != null && (
        <div className="flex items-center gap-2 px-4 py-2.5 text-sm border border-blue-800 bg-blue-950/50 text-blue-300 rounded-lg">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span className="truncate">
            <strong>{pipeline.running}</strong>: {pipeline.progress || pipeline.status}
          </span>
          {pipeline.elapsed_seconds != null && (
            <span className="text-xs opacity-60 ml-auto shrink-0">
              {Math.floor(pipeline.elapsed_seconds)}s
            </span>
          )}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 text-sm border border-red-800 bg-red-950/50 text-red-300 rounded-lg">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      {/* Area table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Area</h2>
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                Diperbarui {new Date(lastUpdated).toLocaleTimeString("id-ID")}
              </span>
            )}
            <button
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="font-medium px-4 py-2.5">Area</th>
                <th className="font-medium px-3 py-2.5 text-center">Scraped</th>
                <th className="font-medium px-3 py-2.5 text-center">Processed</th>
                <th className="font-medium px-3 py-2.5 text-center">Indexed</th>
                <th className="font-medium px-4 py-2.5 text-right">Kos</th>
              </tr>
            </thead>
            <tbody>
              {areas.length === 0 && !error && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    Belum ada area. Jalankan pipeline dari halaman pencarian.
                  </td>
                </tr>
              )}
              {areas.map((area) => (
                <AreaRow key={area.area} area={area} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AreaRow({ area }: { area: PipelineArea }) {
  // Kos count: prefer indexed → docs → scraped (raw) fallback. Raw-scrape-derived
  // counts render muted since they include unprocessed records.
  const count = area.indexed_count || area.docs_count || area.scraped_count || 0;
  const isRawFallback =
    area.indexed_count === 0 && area.docs_count == null && area.scraped_count > 0;

  return (
    <tr className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors">
      <td className="px-4 py-2.5 font-medium">
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span>{area.area}</span>
        </div>
      </td>
      <td className="px-3 py-2.5 text-center">
        <StatusBadge on={area.scraped} />
      </td>
      <td className="px-3 py-2.5 text-center">
        <StatusBadge on={area.processed} />
      </td>
      <td className="px-3 py-2.5 text-center">
        <StatusBadge on={area.indexed} />
      </td>
      <td className={`px-4 py-2.5 text-right tabular-nums ${isRawFallback ? "text-muted-foreground italic" : ""}`}>
        {count > 0 ? count.toLocaleString("id-ID") : "—"}
      </td>
    </tr>
  );
}

function StatusBadge({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex items-center justify-center text-green-600">
      <CheckCircle2 className="w-4 h-4" />
    </span>
  ) : (
    <span className="inline-flex items-center justify-center text-muted-foreground/40">
      ✗
    </span>
  );
}
