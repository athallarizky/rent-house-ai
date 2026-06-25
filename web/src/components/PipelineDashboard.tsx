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
  RotateCw,
  ChevronRight,
  ChevronDown,
  Clock,
  XCircle,
} from "lucide-react";
import {
  getPipelineData,
  indexArea,
  rebuildArea,
  rescrapeArea,
  resumeArea,
  deleteArea,
  type PipelineDataResponse,
  type PipelineArea,
  type ScrapeCode,
} from "../lib/api";
import ConfirmModal from "./ConfirmModal";
import { cn } from "../lib/utils";

const LIVE_POLL_MS = 5000;
const STALE_DAYS = 60;

type ConfirmState =
  | { kind: "rescrape"; area: string }
  | { kind: "delete"; area: string }
  | null;

/** Lightweight CSS tooltip — works on hover (instant, no browser delay) and,
 *  unlike native `title`, on disabled buttons too (the wrapper is not disabled). */
function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="relative inline-flex group/tab cursor-help">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded-md bg-zinc-900 dark:bg-zinc-100 px-2 py-1 text-[10px] font-medium text-white dark:text-zinc-900 opacity-0 scale-95 group-hover/tab:opacity-100 group-hover/tab:scale-100 transition duration-150 z-50 shadow-md"
      >
        {label}
      </span>
    </span>
  );
}

/** Detect likely-broken / action-needed data and suggest the right action.
 *  Every suggestion MUST map to a button that is actually shown:
 *    - "index"   → Index button shows when scraped && !indexed
 *    - "rebuild" → Rebuild button shows when scraped
 *    - "rescrape"→ always shown
 *  So "index" rules require !indexed; inconsistent-but-indexed states point to
 *  "rebuild" (which clears stale leftovers). */
function warnFor(area: PipelineArea): { msg: string; action: string } | null {
  // Index path: scraped but not yet indexed (Index button is shown)
  if (area.scraped && !area.processed && !area.indexed)
    return { msg: "Belum diproses — butuh **Index**", action: "index" };
  if (area.scraped && area.processed && !area.indexed)
    return { msg: "Sudah diproses, belum di-index — butuh **Index**", action: "index" };
  // Inconsistent: indexed but docs missing/empty → stale leftover, needs Rebuild
  if (area.scraped && area.indexed && !area.processed)
    return { msg: "Indexed tapi docs hilang (inkonsisten) — butuh **Rebuild**", action: "rebuild" };
  if (area.processed && (area.docs_count ?? 0) === 0)
    return { msg: "Docs kosong (data rusak) — butuh **Rebuild**", action: "rebuild" };
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
  const [wipeRaw, setWipeRaw] = useState(false);
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
    else if (kind === "delete") runAction((a) => deleteArea(a, wipeRaw), area);
    setWipeRaw(false);
  }, [confirm, runAction, wipeRaw]);

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
                <th className="font-medium px-3 py-2.5 text-center w-8">#</th>
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
                  <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                    Belum ada area. Jalankan pipeline dari halaman pencarian.
                  </td>
                </tr>
              )}
              {areas.map((area, i) => (
                <AreaRow
                  key={area.area}
                  number={i + 1}
                  area={area}
                  busy={pipelineRunning}
                  running={pipeline?.running === area.area}
                  onIndex={(a) => runAction(indexArea, a)}
                  onRebuild={(a) => runAction(rebuildArea, a)}
                  onRescrape={(a) => setConfirm({ kind: "rescrape", area: a })}
                  onResume={(a) => runAction((x) => resumeArea(x), a)}
                  onResumeCode={(a, code) => runAction((x) => resumeArea(x, code), a)}
                  onDelete={(a) => {
                    setWipeRaw(false);
                    setConfirm({ kind: "delete", area: a });
                  }}
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
            ? wipeRaw
              ? "Menghapus dari index + cleaned docs + raw data. Area akan hilang dari dashboard dan tidak bisa di-Rebuild tanpa scrape ulang."
              : "Menghapus dari index + cleaned docs. Raw data dipertahankan (bisa Rebuild/Index ulang)."
            : undefined
        }
        confirmLabel={confirm?.kind === "delete" ? "Hapus" : "Re-scrape"}
        onConfirm={onConfirm}
        onClose={() => {
          setConfirm(null);
          setWipeRaw(false);
        }}
      >
        {confirm?.kind === "delete" && (
          <label className="flex items-start gap-2 cursor-pointer select-none rounded-lg border border-border bg-background/50 p-2.5">
            <input
              type="checkbox"
              checked={wipeRaw}
              onChange={(e) => setWipeRaw(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-destructive"
            />
            <span className="text-xs leading-relaxed text-muted-foreground">
              Hapus <strong className="text-foreground">raw data</strong> juga
              (scrape Google Maps). Area hilang permanen dari dashboard.
            </span>
          </label>
        )}
      </ConfirmModal>
    </div>
  );
}

interface AreaRowProps {
  number: number;
  area: PipelineArea;
  busy: boolean;
  running: boolean;
  onIndex: (area: string) => void;
  onRebuild: (area: string) => void;
  onRescrape: (area: string) => void;
  onResume: (area: string) => void;
  onResumeCode: (area: string, code: number) => void;
  onDelete: (area: string) => void;
}

function AreaRow({
  number,
  area,
  busy,
  running,
  onIndex,
  onRebuild,
  onRescrape,
  onResume,
  onResumeCode,
  onDelete,
}: AreaRowProps) {
  const count = area.indexed_count || area.docs_count || area.scraped_count || 0;
  const isRawFallback =
    area.indexed_count === 0 && area.docs_count == null && area.scraped_count > 0;
  const warn = warnFor(area);

  const codes = area.codes ?? [];
  const hasCodes = codes.length > 0;
  const failedCodes = codes.filter((c) => c.status === "failed");

  const [expanded, setExpanded] = useState(false);
  // Auto-(un)fold following the live pipeline: open the running area, and any
  // area that ended with failures so the retry controls are visible.
  useEffect(() => {
    if (running) setExpanded(true);
  }, [running]);

  const toggleable = hasCodes;
  const chevron = expanded ? (
    <ChevronDown className="w-3.5 h-3.5" />
  ) : (
    <ChevronRight className="w-3.5 h-3.5" />
  );

  return (
    <>
      <tr className="border-b border-border last:border-0 hover:bg-accent/40 transition-colors">
        <td className="px-3 py-2.5 text-center text-xs text-muted-foreground tabular-nums">
          {number}
        </td>
        <td className="px-4 py-2.5 font-medium">
          <div className="flex items-center gap-2">
            {toggleable ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label={expanded ? "Sembunyikan kodepos" : "Tampilkan kodepos"}
              >
                {chevron}
              </button>
            ) : (
              <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            )}
            <span>{area.area}</span>
            {running && (
              <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
            )}
            {warn && (
              <Tooltip label={warn.msg.replace(/\*\*/g, "")}>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              </Tooltip>
            )}
            {failedCodes.length > 0 && (
              <Tooltip label={`${failedCodes.length} kodepos gagal — bisa di-retry`}>
                <span className="inline-flex items-center gap-1 rounded-full border border-red-300 dark:border-red-900 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                  <XCircle className="w-3 h-3" />
                  {failedCodes.length} gagal
                </span>
              </Tooltip>
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
            {failedCodes.length > 0 && (
              <ActionBtn
                icon={RotateCw}
                label="Retry"
                title="Retry: scrape ulang hanya kodepos yang gagal, lalu process + index"
                disabled={busy}
                onClick={() => onResume(area.area)}
              />
            )}
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

      {expanded && hasCodes && (
        <tr className="border-b border-border last:border-0 bg-muted/30">
          <td colSpan={7} className="px-4 py-2.5">
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {codes.map((c) => (
                <CodeStatusBadge
                  key={c.code}
                  code={c}
                  busy={busy}
                  onRetry={() => onResumeCode(area.area, c.code)}
                />
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function CodeStatusBadge({
  code,
  busy,
  onRetry,
}: {
  code: ScrapeCode;
  busy: boolean;
  onRetry: () => void;
}) {
  const failed = code.status === "failed";
  const tooltip =
    code.status === "completed"
      ? `Selesai — ${code.count ?? 0} kos`
      : code.status === "running"
      ? "Sedang di-scrape…"
      : code.status === "waiting"
      ? "Menunggu giliran"
      : `Gagal — ${code.error || "error tidak diketahui"}`;

  return (
    <Tooltip label={tooltip}>
      <span className="inline-flex items-center gap-1.5 text-xs tabular-nums">
        <span className="text-muted-foreground">{code.code}</span>
        {code.status === "completed" && <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />}
        {code.status === "running" && <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />}
        {code.status === "waiting" && <Clock className="w-3.5 h-3.5 text-muted-foreground/50" />}
        {failed && <XCircle className="w-3.5 h-3.5 text-red-500" />}
        {code.status === "completed" && (
          <span className="text-muted-foreground">{(code.count ?? 0).toLocaleString("id-ID")}</span>
        )}
        {failed && (
          <button
            type="button"
            disabled={busy}
            onClick={onRetry}
            title="Retry kodepos ini"
            className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RotateCw className="w-3 h-3" />
            retry
          </button>
        )}
      </span>
    </Tooltip>
  );
}

function StatusBadge({ on, count, label }: { on: boolean; count?: number; label: string }) {
  const text = on && count != null ? `${label}: ${count.toLocaleString("id-ID")}` : label;
  return (
    <Tooltip label={text}>
      {on ? (
        <CheckCircle2 className="w-4 h-4 text-green-600" />
      ) : (
        <span className="inline-flex items-center justify-center text-muted-foreground/40">✗</span>
      )}
    </Tooltip>
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
  // Tooltip wraps the (possibly disabled) button — works on hover even when
  // the button itself is disabled (native `title` would not fire on Chrome).
  return (
    <Tooltip label={disabled ? "Pipeline aktif — tunggu selesai" : title}>
      <button
        type="button"
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
    </Tooltip>
  );
}
