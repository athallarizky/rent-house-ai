import { useCallback, useEffect, useRef, useState } from "react";
import {
  MapPin,
  Pickaxe,
  Cog,
  Database,
  RefreshCw,
  Loader2,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Globe,
  Trash2,
} from "lucide-react";
import {
  getPipelineData,
  indexArea,
  rebuildArea,
  rescrapeArea,
  deleteArea,
  type PipelineDataResponse,
  type PipelineArea,
} from "../lib/api";
import ConfirmModal from "./ConfirmModal";
import { cn } from "../lib/utils";

const LIVE_POLL_MS = 5000;
const STALE_DAYS = 60;

type ConfirmState =
  | { kind: "rescrape"; area: string }
  | { kind: "delete"; area: string }
  | null;

/** Detect likely-broken / action-needed data and suggest the right action. */
function warnFor(area: PipelineArea): { msg: string; action: string } | null {
  if (area.scraped && !area.processed)
    return { msg: "Belum diproses — butuh **Index**", action: "index" };
  if (area.processed && (area.docs_count ?? 0) === 0)
    return { msg: "Docs kosong (data rusak) — butuh **Rebuild**", action: "rebuild" };
  if (area.scraped && area.processed && !area.indexed)
    return { msg: "Sudah diproses, belum di-index — butuh **Index**", action: "index" };
  if (area.indexed && area.indexed_count === 0)
    return { msg: "0 terindex padahal ada data — butuh **Rebuild**", action: "rebuild" };
  if (area.scrape_date) {
    const days = (Date.now() / 1000 - area.scrape_date) / 86400;
    if (days > STALE_DAYS)
      return { msg: `Data stale (>${STALE_DAYS} hari) — pertimbangkan **Rescrape**`, action: "rescrape" };
  }
  return null;
}

export default function PipelineDashboard() {
  const [data, setData] = useState<PipelineDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
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

  const pipelineRunning = data?.pipeline?.running != null;

  const runAction = useCallback(
    async (fn: (area: string) => Promise<unknown>, area: string) => {
      setActionError(null);
      try {
        await fn(area);
        // immediately refresh so the UI reflects the new pipeline state
        fetchData(true);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : `Action gagal untuk ${area}`);
      }
    },
    [fetchData]
  );

  const onConfirm = useCallback(() => {
    if (!confirm) return;
    const { kind, area } = confirm;
    setConfirm(null);
    if (kind === "rescrape") runAction(rescrapeArea, area);
    else if (kind === "delete") runAction((a) => deleteArea(a, false), area);
  }, [confirm, runAction]);

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
    { icon: MapPin, label: "Area", value: totals?.areas ?? 0, accent: "text-blue-600" },
    { icon: Pickaxe, label: "Scraped", value: totals?.scraped ?? 0, accent: "text-amber-500" },
    { icon: Cog, label: "Processed", value: totals?.processed ?? 0, accent: "text-purple-500" },
    { icon: Database, label: "Indexed", value: totals?.indexed ?? 0, accent: "text-green-600" },
  ];

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <div key={i} className="rounded-xl border border-border bg-card p-3 sm:p-4 shadow-sm">
              <Icon className={`w-4 h-4 ${card.accent}`} />
              <div className="text-xl sm:text-2xl font-bold tracking-tight mt-2">{card.value}</div>
              <div className="text-[11px] sm:text-xs text-muted-foreground mt-0.5">{card.label}</div>
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

      {pipelineRunning && (
        <p className="text-xs text-muted-foreground -mt-2">
          ⏸ Pipeline sedang aktif — tombol aksi dinonaktifkan sampai selesai (fokus 1 area).
        </p>
      )}

      {(error || actionError) && (
        <div className="flex items-center gap-2 px-4 py-2.5 text-sm border border-red-800 bg-red-950/50 text-red-300 rounded-lg">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="truncate">{actionError || error}</span>
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
              <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="font-medium px-4 py-2.5">Area</th>
                <th className="font-medium px-3 py-2.5 text-center">S</th>
                <th className="font-medium px-3 py-2.5 text-center">P</th>
                <th className="font-medium px-3 py-2.5 text-center">I</th>
                <th className="font-medium px-4 py-2.5 text-right">Kos</th>
                <th className="font-medium px-3 py-2.5 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {areas.length === 0 && !error && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    Belum ada area. Jalankan pipeline dari halaman pencarian.
                  </td>
                </tr>
              )}
              {areas.map((area) => (
                <AreaRow
                  key={area.area}
                  area={area}
                  busy={pipelineRunning}
                  onIndex={(a) => runAction(indexArea, a)}
                  onRebuild={(a) => runAction(rebuildArea, a)}
                  onRescrape={(a) => setConfirm({ kind: "rescrape", area: a })}
                  onDelete={(a) => setConfirm({ kind: "delete", area: a })}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal
        open={confirm !== null}
        variant={confirm?.kind === "delete" ? "danger" : "default"}
        title={
          confirm?.kind === "rescrape"
            ? `Re-scrape ${confirm.area}?`
            : confirm?.kind === "delete"
            ? `Hapus data ${confirm.area}?`
            : ""
        }
        message={
          confirm?.kind === "rescrape"
            ? "Akan mengambil ulang semua data dari Google Maps (butuh beberapa menit, berisiko rate-limit). Data lama ditimpa."
            : confirm?.kind === "delete"
            ? "Menghapus dari index + cleaned docs. Raw data dipertahankan (bisa Rebuild/Index ulang)."
            : undefined
        }
        confirmLabel={confirm?.kind === "delete" ? "Hapus" : "Re-scrape"}
        onConfirm={onConfirm}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

interface AreaRowProps {
  area: PipelineArea;
  busy: boolean;
  onIndex: (area: string) => void;
  onRebuild: (area: string) => void;
  onRescrape: (area: string) => void;
  onDelete: (area: string) => void;
}

function AreaRow({ area, busy, onIndex, onRebuild, onRescrape, onDelete }: AreaRowProps) {
  const count = area.indexed_count || area.docs_count || area.scraped_count || 0;
  const isRawFallback =
    area.indexed_count === 0 && area.docs_count == null && area.scraped_count > 0;
  const warn = warnFor(area);

  return (
    <tr className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors">
      <td className="px-4 py-2.5 font-medium">
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span>{area.area}</span>
          {warn && (
            <span
              title={warn.msg.replace(/\*\*/g, "")}
              className="inline-flex items-center text-amber-500 cursor-help"
            >
              <AlertTriangle className="w-3.5 h-3.5" />
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-center">
        <StatusBadge on={area.scraped} count={area.scraped_count} label="Scraped" />
      </td>
      <td className="px-3 py-2.5 text-center">
        <StatusBadge on={area.processed} count={area.docs_count ?? undefined} label="Processed" />
      </td>
      <td className="px-3 py-2.5 text-center">
        <StatusBadge on={area.indexed} count={area.indexed_count} label="Indexed" />
      </td>
      <td className={cn(
        "px-4 py-2.5 text-right tabular-nums",
        isRawFallback && "text-muted-foreground italic"
      )}>
        {count > 0 ? count.toLocaleString("id-ID") : "—"}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {area.scraped && !area.indexed && (
            <ActionBtn icon={Zap} label="Index" title="Index: process + index raw" disabled={busy} onClick={() => onIndex(area.area)} />
          )}
          {area.scraped && (
            <ActionBtn icon={RefreshCw} label="Rebuild" title="Rebuild: reprocess + reingest (fix data)" disabled={busy} onClick={() => onRebuild(area.area)} />
          )}
          <ActionBtn icon={Globe} label="Rescrape" title="Rescrape: full refresh from Google Maps" disabled={busy} onClick={() => onRescrape(area.area)} />
          <ActionBtn icon={Trash2} label="Delete" title="Delete: remove from index (keep raw)" disabled={busy} danger onClick={() => onDelete(area.area)} />
        </div>
      </td>
    </tr>
  );
}

function StatusBadge({ on, count, label }: { on: boolean; count?: number; label: string }) {
  const title = on && count != null ? `${label}: ${count.toLocaleString("id-ID")}` : label;
  return on ? (
    <span title={title} className="inline-flex items-center justify-center text-green-600 cursor-help">
      <CheckCircle2 className="w-4 h-4" />
    </span>
  ) : (
    <span title={title} className="inline-flex items-center justify-center text-muted-foreground/40">
      ✗
    </span>
  );
}

interface ActionBtnProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

function ActionBtn({ icon: Icon, label, title, disabled, danger, onClick }: ActionBtnProps) {
  return (
    <button
      type="button"
      title={disabled ? "Pipeline aktif — tunggu selesai" : title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        danger
          ? "border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <Icon className="w-3 h-3" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
